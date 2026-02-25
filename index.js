const { default: axios } = require("axios");
const express = require("express");
const QRCode = require("qrcode");
const { Client, LocalAuth } = require("whatsapp-web.js");

const app = express();
const port = 8015;

app.use(express.json());

// =============================
// Variáveis Globais
// =============================
let whatsappReady = false;
let currentQr = null;
let currentQrBase64 = null;
let sseClients = [];

// =============================
// WhatsApp Client
// =============================
const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  },
});

// Quando gerar QR
client.on("qr", async (qr) => {
  console.log("Novo QR gerado");

  whatsappReady = false;
  currentQr = qr;
  currentQrBase64 = await QRCode.toDataURL(qr);

  // Envia para todos conectados no SSE
  sseClients.forEach((res) => {
    res.write(`data: ${JSON.stringify({
      status: "qr",
      qr: currentQrBase64
    })}\n\n`);
  });
});

// Quando autenticar
client.on("authenticated", () => {
  console.log("WhatsApp autenticado!");
});

// Quando conectar
client.on("ready", () => {
  whatsappReady = true;
  console.log("WhatsApp conectado!");

  sseClients.forEach((res) => {
    res.write(`data: ${JSON.stringify({
      status: "connected"
    })}\n\n`);
  });
});

// Quando desconectar
client.on("disconnected", (reason) => {
  whatsappReady = false;
  console.log("WhatsApp desconectado:", reason);
});

// Receber mensagens
client.on("message", async (message) => {
  const chat = await message.getChat();
  if (chat.isGroup) return;

  try {
    await axios.post(
      "https://n8n-production-45eb.up.railway.app/webhook-test/6b90214d-5b7a-4e4c-a25f-225d39742345",
      {
        message_from: message.from,
        message_text: message.body,
      }
    );
  } catch (error) {
    console.log("Erro webhook:", error.message);
  }
});

client.initialize();

// =============================
// ENDPOINT SSE - QR CODE
// =============================
app.get("/qrcode", (req, res) => {

  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
      <title>WhatsApp QR Code</title>
      <style>
          body {
              font-family: Arial;
              text-align: center;
              margin-top: 50px;
          }
          img {
              margin-top: 20px;
              width: 300px;
              height: 300px;
          }
          .connected {
              color: green;
              font-size: 22px;
              font-weight: bold;
          }
      </style>
  </head>
  <body>

      <h2 id="status">Aguardando conexão...</h2>
      <img id="qr" />

      <script>
          const statusEl = document.getElementById("status");
          const qrEl = document.getElementById("qr");

          const eventSource = new EventSource("/qrcode-stream");

          eventSource.onmessage = function(event) {
              const data = JSON.parse(event.data);

              if (data.status === "qr") {
                  qrEl.src = data.qr;
                  qrEl.style.display = "block";
                  statusEl.innerText = "Escaneie o QR Code";
              }

              if (data.status === "connected") {
                  qrEl.style.display = "none";
                  statusEl.innerText = "WhatsApp Conectado!";
                  statusEl.className = "connected";
              }
          };

          eventSource.onerror = function() {
              statusEl.innerText = "Erro na conexão...";
          };
      </script>

  </body>
  </html>
  `);
});

app.get("/qrcode-stream", (req, res) => {

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  res.flushHeaders();

  if (whatsappReady) {
    res.write(`data: ${JSON.stringify({
      status: "connected"
    })}\n\n`);
  } 
  else if (currentQrBase64) {
    res.write(`data: ${JSON.stringify({
      status: "qr",
      qr: currentQrBase64
    })}\n\n`);
  }

  sseClients.push(res);

  req.on("close", () => {
    sseClients = sseClients.filter(client => client !== res);
  });
});

// =============================
// VALIDAR NÚMERO
// =============================
app.post("/validar-numero", async (req, res) => {
  const { numero } = req.body ?? {};

  if (!numero) {
    return res.status(400).json({ error: "Número é obrigatório" });
  }

  const numeroLimpo = numero.replace(/\D/g, "");

  if (numeroLimpo.length < 12) {
    return res.status(400).json({ error: "Número inválido" });
  }

  try {
    const numberId = await client.getNumberId(numeroLimpo);

    if (!numberId) {
      return res.status(400).json({ exists: false });
    }

    return res.status(200).json({ exists: true });
  } catch (error) {
    return res.status(500).json({ error: "Erro interno" });
  }
});

// =============================
// ENVIAR MENSAGEM
// =============================
app.post("/", async (req, res) => {
  try {
    const token = req.headers.token;

    if (token !== "123456") {
      return res.status(401).json({ message: "Token inválido" });
    }

    if (!whatsappReady) {
      return res.status(401).json({ message: "WhatsApp não conectado" });
    }

    const { message, numero } = req.body ?? {};

    if (!message || !numero) {
      return res.status(400).json({
        message: "Campos 'message' e 'numero' são obrigatórios"
      });
    }

    const numeroLimpo = numero.replace(/\D/g, "");
    const chatId = numeroLimpo + "@c.us";

    await client.sendMessage(chatId, message);

    return res.status(200).json({
      message: "Mensagem enviada com sucesso"
    });

  } catch (err) {
    console.error("Erro ao enviar mensagem:", err);
    return res.status(500).json({
      message: "Erro ao enviar mensagem"
    });
  }
});

// =============================
// SERVER
// =============================
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
});