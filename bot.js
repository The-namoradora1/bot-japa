// bot.js - Versão corrigida (CommonJS)
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Configurações
const BLOCK_SIZE = 250;
const DELAY_MS = 1000;

// Funções auxiliares
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function dividirEmBlocos(array, tamanho) {
  const res = [];
  for (let i = 0; i < array.length; i += tamanho) {
    res.push(array.slice(i, i + tamanho));
  }
  return res;
}

// Inicializa o client
const client = new Client({
  authStrategy: new LocalAuth()
});

// QR no terminal
client.on('qr', qr => {
  qrcode.generate(qr, { small: true });
  console.log('📲 Escaneie o QR acima para conectar o WhatsApp');
});

// Quando o client estiver pronto
client.on('ready', () => {
  console.log('✅ Bot conectado e pronto!');
});

// --- Handler de mensagens ---
client.on('message', async msg => {
  try {
    const chat = await msg.getChat();
    const sender = await msg.getContact();
    const participants = chat.participants || [];
    const isAdmin = participants.find(p => p.id && p.id._serialized === sender.id._serialized)?.isAdmin;
    const body = (msg.body || '').trim();

    // Mensagens privadas
    if (!chat.isGroup) {
      return msg.reply('Olá! Para assuntos relacionados ao bot, fale diretamente com o criador: wa.me/5511977018088');
    }

    // HELP
    if (body === '!help') {
      return msg.reply(
`🧠 Comandos:
* !even -> Marca todos (em blocos de ${BLOCK_SIZE})
* !anuncio Texto -> Anúncio + marcas em blocos
* !anuncio -b Texto -> Envia por DM (broadcast)
* !sorteio -> Sorteia um membro (prefere não-admins)
* !num X a Y -> Sorteia número
* !ban @usuário -> Remove o participante do grupo
(Somente administradores para comandos de marcação)`
      );
    }

    // Valida admin
    const mustBeAdmin = body.startsWith('!even') ||
                         body.toLowerCase().startsWith('!anuncio') ||
                         body === '!sorteio' ||
                         body.toLowerCase().startsWith('!num') ||
                         body.toLowerCase().startsWith('!ban');
    if (mustBeAdmin && !isAdmin) return msg.reply('❌ Apenas administradores podem usar este comando.');

    // !even
    if (body === '!even') {
      const participantesInvertidos = [...participants].reverse();
      const mentions = [];
      for (const p of participantesInvertidos) {
        try {
          const contact = await client.getContactById(p.id._serialized);
          mentions.push(contact);
        } catch (e) {
          console.warn('[WARN] falha em obter contato', p.id && p.id._serialized, e.message || e);
        }
      }
      if (mentions.length === 0) return msg.reply('⚠️ Não foi possível coletar participantes.');
      await chat.sendMessage('🚨 Atenção, comunicado para todos!');
      const blocos = dividirEmBlocos(mentions, BLOCK_SIZE);
      for (let i = 0; i < blocos.length; i++) {
        await chat.sendMessage(blocos[i].map(c => `@${c.number}`).join(' '), { mentions: blocos[i] });
        console.log(`✅ !even bloco ${i + 1}/${blocos.length} enviado (${blocos[i].length})`);
        if (i < blocos.length - 1) await sleep(DELAY_MS);
      }
      return;
    }

    // !anuncio
    if (body.toLowerCase().startsWith('!anuncio')) {
      let texto = body.slice('!anuncio'.length).trim();
      if (!texto) return msg.reply('📝 Use: !anuncio [-b] Seu texto aqui');
      let isBroadcast = false;
      if (texto.startsWith('-b ')) { isBroadcast = true; texto = texto.slice(3).trim(); }

      const participantesInvertidos = [...participants].reverse();
      const mentions = [];
      for (const p of participantesInvertidos) {
        try { mentions.push(await client.getContactById(p.id._serialized)); }
        catch (e) { console.warn('[WARN] contato fail', p.id && p.id._serialized); }
      }
      if (mentions.length === 0) return msg.reply('⚠️ Não foi possível coletar participantes.');

      if (isBroadcast) {
        await msg.reply(`📣 Enviando broadcast para ${mentions.length} contatos (DM) ...`);
        for (let i = 0; i < mentions.length; i++) {
          try {
            await client.sendMessage(mentions[i].id._serialized, `📢 *Anúncio:*\n\n${texto}`);
            if ((i + 1) % 20 === 0) await sleep(800); else await sleep(200);
          } catch (e) {
            console.warn('[WARN] falha ao enviar DM para', mentions[i].number, e.message || e);
            await sleep(400);
          }
        }
        return msg.reply(`✅ Broadcast concluído: enviado para ${mentions.length} contatos.`);
      } else {
        await chat.sendMessage(`📢 *Anúncio Importante!*\n\n${texto}`);
        const blocos = dividirEmBlocos(mentions, BLOCK_SIZE);
        for (let i = 0; i < blocos.length; i++) {
          await chat.sendMessage(blocos[i].map(c => `@${c.number}`).join(' '), { mentions: blocos[i] });
          console.log(`✅ Anúncio bloco ${i + 1}/${blocos.length}`);
          if (i < blocos.length - 1) await sleep(DELAY_MS);
        }
        return msg.reply(`✅ Anúncio enviado para ${mentions.length} participantes.`);
      }
    }

    // !sorteio
    if (body === '!sorteio') {
      const nonAdmins = participants.filter(p => !p.isAdmin);
      const pool = nonAdmins.length ? nonAdmins : participants;
      const sorteado = pool[Math.floor(Math.random() * pool.length)];
      const contato = await client.getContactById(sorteado.id._serialized);
      await chat.sendMessage(`🎉 *SORTEIO!* 🎉\nO vencedor(a) é: @${contato.number}`, { mentions: [contato] });
      return;
    }

    // !num X a Y
    if (body.toLowerCase().startsWith('!num')) {
      const match = body.match(/!num\s+(-?\d+)\s*a\s*(-?\d+)/i);
      if (!match) return msg.reply('❌ Use o formato: !num 1 a 50');
      const min = parseInt(match[1], 10);
      const max = parseInt(match[2], 10);
      if (isNaN(min) || isNaN(max) || min >= max) return msg.reply('⚠️ Números inválidos!');
      const random = Math.floor(Math.random() * (max - min + 1)) + min;
      await chat.sendMessage(`🎲 Número sorteado entre *${min}* e *${max}*: *${random}*`);
      return;
    }

    // !ban @usuário
    if (body.toLowerCase().startsWith('!ban')) {
      if (!msg.mentionedIds || msg.mentionedIds.length === 0) return msg.reply('❌ Use: !ban @usuário');
      const alvo = msg.mentionedIds[0];
      try {
        await chat.removeParticipants([alvo]);
        return msg.reply('✅ Usuário removido do grupo.');
      } catch (e) {
        console.error('[ERROR !ban]:', e);
        return msg.reply('❌ Não foi possível remover o usuário. Verifique permissões do bot.');
      }
    }

  } catch (err) {
    console.error('[ERROR handler message]:', err && (err.stack || err.message) ? (err.stack || err.message) : err);
  }
});

// Inicializa o client
client.initialize();

// --- Rota HTTP para healthcheck ---
app.get('/', (req, res) => res.send('Bot ativo'));
app.listen(PORT, () => console.log(`🌐 HTTP server listening on port ${PORT}`));
