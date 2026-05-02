const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const QRCode = require("qrcode");

const BACKEND_WEBHOOK_URL =
  process.env.BACKEND_WEBHOOK_URL ||
  "http://localhost:3000/api/whatsapp/webhook/message";
const WORKER_INTERNAL_SECRET = process.env.WORKER_INTERNAL_SECRET || "";

let client = null;
let connectionStatus = "stopped";
let qrCodeDataUrl = null;
let lastQrText = null;
let lastError = null;
let lastEventAt = null;

const updateStatus = (nextStatus, errorMessage = null) => {
  connectionStatus = nextStatus;
  lastEventAt = new Date().toISOString();
  if (errorMessage !== null) lastError = errorMessage;
};

const getStatus = () => ({
  status: connectionStatus,
  hasQr: Boolean(lastQrText),
  qrCodeDataUrl,
  lastError,
  lastEventAt,
  isClientActive: Boolean(client),
});

const createClient = () =>
  new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      ...(process.env.PUPPETEER_EXECUTABLE_PATH && {
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      }),
    },
  });

const forwardToBackend = async (payload) => {
  try {
    const response = await fetch(BACKEND_WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${WORKER_INTERNAL_SECRET}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) {
      console.error(`Backend webhook respondio ${response.status}`);
    }
  } catch (err) {
    console.error("Error al reenviar mensaje al backend:", err.message);
  }
};

const bindEvents = (instance) => {
  instance.on("qr", async (qr) => {
    try {
      qrCodeDataUrl = await QRCode.toDataURL(qr, { width: 320, margin: 1 });
      lastQrText = qr;
      updateStatus("qr_ready");
    } catch (err) {
      updateStatus("error", `No se pudo generar el QR: ${err.message}`);
    }
  });

  instance.on("ready", () => {
    qrCodeDataUrl = null;
    lastQrText = null;
    updateStatus("ready");
    console.log("✅ WhatsApp Worker listo");
  });

  instance.on("auth_failure", (msg) => {
    qrCodeDataUrl = null;
    lastQrText = null;
    updateStatus("auth_failure", msg || "Fallo de autenticacion");
    client = null;
  });

  instance.on("disconnected", (reason) => {
    qrCodeDataUrl = null;
    lastQrText = null;
    updateStatus("disconnected", reason || "Cliente desconectado");
    client = null;
  });

  instance.on("message", async (message) => {
    if (message.from === "status@broadcast") return;

    const contact = await message.getContact();
    const phone = contact.id.user;

    const payload = {
      from: message.from,
      phone,
      body: message.body || "",
      type: message.type,
      hasMedia: message.hasMedia,
    };

    if (
      message.hasMedia &&
      (message.type === "ptt" || message.type === "audio")
    ) {
      try {
        const media = await message.downloadMedia();
        payload.mediaBase64 = media.data;
        payload.mimetype = media.mimetype;
      } catch (err) {
        console.error("Error descargando audio:", err.message);
      }
    }

    await forwardToBackend(payload);
  });
};

const start = async () => {
  if (["starting", "ready", "qr_ready"].includes(connectionStatus)) {
    return getStatus();
  }

  if (!client) {
    client = createClient();
    bindEvents(client);
  }

  qrCodeDataUrl = null;
  lastQrText = null;
  lastError = null;
  updateStatus("starting");

  try {
    await client.initialize();
  } catch (err) {
    updateStatus("error", err.message);
    client = null;
  }

  return getStatus();
};

const stop = async () => {
  if (!client) {
    updateStatus("stopped");
    return getStatus();
  }

  updateStatus("stopping");
  try {
    await client.destroy();
  } catch (err) {
    updateStatus("error", err.message);
  } finally {
    client = null;
    qrCodeDataUrl = null;
    lastQrText = null;
    updateStatus("stopped");
  }

  return getStatus();
};

const restart = async () => {
  await stop();
  return start();
};

const sendText = async (to, body) => {
  if (!client || connectionStatus !== "ready") {
    throw new Error("WhatsApp no esta conectado");
  }
  return client.sendMessage(to, body);
};

const sendMedia = async (to, mediaBase64, mimetype, filename, caption) => {
  if (!client || connectionStatus !== "ready") {
    throw new Error("WhatsApp no esta conectado");
  }
  const media = new MessageMedia(mimetype, mediaBase64, filename || "archivo");
  return client.sendMessage(to, media, { caption: caption || "" });
};

module.exports = { start, stop, restart, getStatus, sendText, sendMedia };
