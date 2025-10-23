// bot.js (colocar inteiro)
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Configs de bloco/delay (ajuste se precisar)
const BLOCK_SIZE = 250;
const DELAY_MS = 1000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function dividirEmBlocos(array, tamanho) {
  const chunk = [];
  for (let i = 0; i < array.length; i += tamanho) chunk.push(array.slice(i, i + tamanho));
  return chunk;
}

const client = new Client({
  authStrategy: new LocalAuth()
});

client.on('qr', qr => {
  console.log('📲 Escaneie o QR com o WhatsApp (Aparelhos conectados)');
  qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
  console.log('✅ Bot conectado!');
});

client.on('auth_failure', (msg) => {
  console.error('🔴 Falha na autenticação:', msg);
});

client.on('disconnected', reason => {
  console.warn('⚠️ Desconectado:', reason);
  // Se quiser, tenta reinicializar: client.initialize(); // o LocalAuth reautentica se sessão válida
});

// Handler de mensagens
client.on('message', async (msg) => {
  try {
    const chat = await msg.getChat();

    // NOVO: Responde mensagens privadas automaticamente
    if (!chat.isGroup) {
      return msg.reply('Olá! Para assuntos relacionados ao bot, por favor, fale diretamente com o criador: wa.me/5511977018088');
    }

    const sender = await msg.getContact();
    const isAdmin = chat.participants.find(p => p.id._serialized === sender.id._serialized)?.isAdmin;
    const body = (msg.body || '').trim();

    // HELP
    if (body === '!help') {
      return msg.reply(
`🧠 Comandos:
* !even -> Marca todos (em blocos de ${BLOCK_SIZE})
* !anuncio Texto -> Anúncio + marcas em blocos
* !anuncio -b Texto -> Envia por DM (broadcast)
* !sorteio -> Sorteia um membro (prefere não-admins)
* !num X a Y -> Sorteia número
(Somente administradores para comandos de marcação)`
      );
    }

    // valida admin
    const mustBeAdmin = body.startsWith('!even') || body.toLowerCase().startsWith('!anuncio') || body === '!sorteio' || body.toLowerCase().startsWith('!num');
    if (mustBeAdmin && !isAdmin) return msg.reply('❌ Apenas administradores podem usar este comando.');

    // !even
    if (body === '!even') {
      // pega participantes invertidos (menos ativos primeiro)
      const participantesInvertidos = [...chat.participants].reverse();
      const mentions = [];
      for (const p of participantesInvertidos) {
        try {
          const contact = await client.getContactById(p.id._serialized);
          mentions.push(contact);
        } catch (e) {
          console.warn('[WARN] falha em obter contato', p.id._serialized, e.message || e);
        }
      }
      if (mentions.length === 0) return msg.reply('⚠️ Não foi possível coletar participantes.');

      // aviso limpo
      await chat.sendMessage('🚨 Atenção, comunicado para todos!');

      // dividir e enviar em blocos
      const blocos = dividirEmBlocos(mentions, BLOCK_SIZE);
      for (let i = 0; i < blocos.length; i++) {
        await chat.sendMessage(blocos[i].map(c => `@${c.number}`).join(' '), { mentions: blocos[i] });
        console.log(`✅ !even bloco ${i+1}/${blocos.length} enviado (${blocos[i].length})`);
        if (i < blocos.length - 1) await sleep(DELAY_MS);
      }
      return;
    }

    // !anuncio (opcional -b)
    if (body.toLowerCase().startsWith('!anuncio')) {
      let texto = body.slice('!anuncio'.length).trim();
      if (!texto) return msg.reply('📝 Use: !anuncio [-b] Seu texto aqui');

      let isBroadcast = false;
      if (texto.startsWith('-b ')) { isBroadcast = true; texto = texto.slice(3).trim(); }

      // coleta participantes
      const participantesInvertidos = [...chat.participants].reverse();
      const mentions = [];
      for (const p of participantesInvertidos) {
        try { mentions.push(await client.getContactById(p.id._serialized)); }
        catch (e) { console.warn('[WARN] contato fail', p.id._serialized); }
      }
      if (mentions.length === 0) return msg.reply('⚠️ Não foi possível coletar participantes.');

      if (isBroadcast) {
        await msg.reply(`📣 Enviando broadcast para ${mentions.length} contatos (DM) ...`);
        for (let i = 0; i < mentions.length; i++) {
          try {
            await client.sendMessage(mentions[i].id._serialized, `📢 *Anúncio:*\n\n${texto}`);
            if ((i+1) % 20 === 0) await sleep(800); else await sleep(200);
          } catch (e) {
            console.warn('[WARN] falha ao enviar DM para', mentions[i].number, e.message || e);
            await sleep(400);
          }
        }
        return msg.reply(`✅ Broadcast concluído: enviado para ${mentions.length} contatos.`);
      } else {
        // anúncio no grupo + menções em blocos
        await chat.sendMessage(`📢 *Anúncio Importante!*\n\n${texto}`);
        const blocos = dividirEmBlocos(mentions, BLOCK_SIZE);
        for (let i = 0; i < blocos.length; i++) {
          await chat.sendMessage(blocos[i].map(c => `@${c.number}`).join(' '), { mentions: blocos[i] });
          console.log(`✅ Anúncio bloco ${i+1}/${blocos.length}`);
          if (i < blocos.length - 1) await sleep(DELAY_MS);
        }
        return msg.reply(`✅ Anúncio enviado para ${mentions.length} participantes.`);
      }
    }

    // !sorteio
    if (body === '!sorteio') {
      const nonAdmins = chat.participants.filter(p => !p.isAdmin);
      const pool = nonAdmins.length ? nonAdmins : chat.participants;
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

  } catch (err) {
    console.error('[ERROR handler message]:', err && (err.stack || err.message) ? (err.stack || err.message) : err);
  }
});

client.initialize();

// --- ROTA HTTP para healthcheck (UptimeRobot ping) ---
app.get('/', (req, res) => {
  res.send('Bot ativo');
});
app.listen(PORT, () => console.log(`🌐 HTTP server listening on port ${PORT}`));