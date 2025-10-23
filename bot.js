// bot.js - QR no navegador com atualização automática
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

// Configurações
const BLOCK_SIZE = 250;
const DELAY_MS = 1000;

// Helpers
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

// NEW: remove duplicates preserving order (por id._serialized)
function uniqueContacts(contacts) {
  const seen = new Set();
  const res = [];
  for (const c of contacts) {
    const id = c && c.id && c.id._serialized;
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    res.push(c);
  }
  return res;
}

// Inicializa o client
const client = new Client({
  authStrategy: new LocalAuth()
});

// QR code: envia via socket
client.on('qr', async qr => {
  try {
    const qrDataUrl = await qrcode.toDataURL(qr);
    console.log('📲 QR atualizado!');
    io.emit('qr', qrDataUrl); // envia para todos os clientes conectados
  } catch (e) {
    console.error('[ERROR qr gen]:', e);
  }
});

client.on('ready', () => {
  console.log('✅ Bot conectado e pronto!');
  io.emit('ready'); // avisa ao navegador que o bot está pronto
});

// --- Handler de mensagens ---
client.on('message', async msg => {
  try {
    const chat = await msg.getChat();
    const sender = await msg.getContact();
    const participants = chat.participants || [];
    const isAdmin = participants.find(p => p.id && p.id._serialized === sender.id._serialized)?.isAdmin;
    const body = (msg.body || '').trim();

    if (!chat.isGroup) {
      return msg.reply('Olá! Para assuntos relacionados ao bot, fale diretamente com o criador: wa.me/5511977018088');
    }

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

    const mustBeAdmin = body.startsWith('!even') ||
                         body.toLowerCase().startsWith('!anuncio') ||
                         body === '!sorteio' ||
                         body.toLowerCase().startsWith('!num') ||
                         body.toLowerCase().startsWith('!ban');
    if (mustBeAdmin && !isAdmin) return msg.reply('❌ Apenas administradores podem usar este comando.');

    // !even
    if (body === '!even') {
      const participantesInvertidos = [...participants].reverse();
      const mentionsRaw = [];
      for (const p of participantesInvertidos) {
        try { mentionsRaw.push(await client.getContactById(p.id._serialized)); }
        catch (e) { console.warn('[WARN] falha em obter contato', p.id && p.id._serialized); }
      }
      // remove duplicados mantendo ordem
      const mentions = uniqueContacts(mentionsRaw);
      if (mentions.length === 0) return msg.reply('⚠️ Não foi possível coletar participantes.');
      await chat.sendMessage(`🚨 Atenção, comunicado para todos! Total: ${mentions.length}`);
      const blocos = dividirEmBlocos(mentions, BLOCK_SIZE);
      for (let i = 0; i < blocos.length; i++) {
        const header = blocos.length > 1 ? `(${i + 1}/${blocos.length}) ` : '';
        await chat.sendMessage(header + blocos[i].map(c => `@${c.number}`).join(' '), { mentions: blocos[i] });
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
      const mentionsRaw = [];
      for (const p of participantesInvertidos) {
        try { mentionsRaw.push(await client.getContactById(p.id._serialized)); }
        catch (e) { console.warn('[WARN] contato fail', p.id && p.id._serialized); }
      }
      // remove duplicados mantendo ordem
      const mentions = uniqueContacts(mentionsRaw);
      if (mentions.length === 0) return msg.reply('⚠️ Não foi possível coletar participantes.');

      if (isBroadcast) {
        await msg.reply(`📣 Enviando broadcast para ${mentions.length} contatos (DM) ...`);
        for (let i = 0; i < mentions.length; i++) {
          try {
            await client.sendMessage(mentions[i].id._serialized, `📢 *Anúncio:*\n\n${texto}`);
            if ((i + 1) % 20 === 0) await sleep(800); else await sleep(200);
          } catch (e) {
            await sleep(400);
          }
        }
        return msg.reply(`✅ Broadcast concluído: enviado para ${mentions.length} contatos.`);
      } else {
        await chat.sendMessage(`📢 *Anúncio Importante!*\n\n${texto}\n\nTotal: ${mentions.length}`);
        const blocos = dividirEmBlocos(mentions, BLOCK_SIZE);
        for (let i = 0; i < blocos.length; i++) {
          const header = blocos.length > 1 ? `(${i + 1}/${blocos.length}) ` : '';
          await chat.sendMessage(header + blocos[i].map(c => `@${c.number}`).join(' '), { mentions: blocos[i] });
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

    // !ban
    if (body.toLowerCase().startsWith('!ban')) {
      if (!msg.mentionedIds || msg.mentionedIds.length === 0) return msg.reply('❌ Use: !ban @usuário');
      const alvo = msg.mentionedIds[0];
      try {
        await chat.removeParticipants([alvo]);
        return msg.reply('✅ Usuário removido do grupo.');
      } catch (e) {
        return msg.reply('❌ Não foi possível remover o usuário. Verifique permissões do bot.');
      }
    }

  } catch (err) {
    console.error(err);
  }
});

// Inicializa o client
client.initialize();

// --- Rotas HTTP ---
app.get('/', (req, res) => {
  res.send(`
    <h2>📲 Bot Ativo!</h2>
    <p>Escaneie o QR abaixo (será atualizado automaticamente):</p>
    <img id="qrcode" style="width:250px;height:250px;">
    <script src="/socket.io/socket.io.js"></script>
    <script>
      const socket = io();
      const img = document.getElementById('qrcode');
      socket.on('qr', data => { img.src = data; });
      socket.on('ready', () => {
        document.body.innerHTML = '<h2>✅ Bot conectado e pronto!</h2>';
      });
    </script>
  `);
});

server.listen(PORT, () => console.log(`🌐 Servidor rodando em http://localhost:${PORT}`));
