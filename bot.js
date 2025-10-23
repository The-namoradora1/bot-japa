const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

let qrCodeDataUrl = null; // aqui vamos guardar o QR code como imagem

const client = new Client({
  authStrategy: new LocalAuth()
});

client.on('qr', async qr => {
  console.log('📲 QR gerado!');

  // transforma QR em DataURL (imagem base64)
  qrCodeDataUrl = await qrcode.toDataURL(qr);
});

client.on('ready', () => {
  console.log('✅ Bot conectado!');
});

client.on('auth_failure', msg => {
  console.error('🔴 Falha na autenticação:', msg);
});

client.on('disconnected', reason => {
  console.warn('⚠️ Desconectado:', reason);
});

client.initialize();

// Rota HTTP principal
app.get('/', (req, res) => {
  if (qrCodeDataUrl) {
    // mostra o QR Code na página
    res.send(`
      <h1>Bot ativo</h1>
      <p>📲 Escaneie o QR Code para conectar o WhatsApp:</p>
      <img src="${qrCodeDataUrl}" />
    `);
  } else {
    res.send('<h1>Bot ativo</h1><p>QR Code ainda não gerado...</p>');
  }
});

app.listen(PORT, () => console.log(`🌐 HTTP server listening on port ${PORT}`));
