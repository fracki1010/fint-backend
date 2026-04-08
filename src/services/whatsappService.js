const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");
const { transcribeAudio } = require("./groqService");
const { handleIncomingMessage } = require("../controllers/iaController"); // Importamos el controlador
const Setting = require("../models/setting.model");
const { getNumberContact } = require("../utils/getNumberContact");

// Asegurarnos de que exista una carpeta temporal para los audios
const tempDir = path.join(__dirname, "../../temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

let client = null;
let connectionStatus = "stopped";
let qrCodeDataUrl = null;
let lastQrText = null;
let lastError = null;
let lastEventAt = null;

const normalizeWhatsAppNumber = (value = "") =>
  value
    .toString()
    .trim()
    .replace(/[^\d]/g, "");

const resolveTenantBySender = async (senderId) => {
  const senderNumber = normalizeWhatsAppNumber(senderId);
  if (!senderNumber) {
    return { senderNumber, access: "denied", tenantId: null };
  }

  const matches = await Setting.find({
    whatsappEnabled: true,
    $or: [
      { whatsappAdminNumber: senderNumber },
      { whatsappAuthorizedNumbers: senderNumber },
    ],
  })
    .select("tenant storeName whatsappAdminNumber whatsappAuthorizedNumbers")
    .limit(2)
    .lean();

  if (matches.length === 0) {
    return { senderNumber, access: "denied", tenantId: null };
  }

  if (matches.length > 1) {
    return { senderNumber, access: "ambiguous", tenantId: null };
  }

  return {
    senderNumber,
    access: "allowed",
    tenantId: matches[0].tenant,
  };
};

const updateStatus = (nextStatus, errorMessage = null) => {
  connectionStatus = nextStatus;
  lastEventAt = new Date().toISOString();
  if (errorMessage !== null) {
    lastError = errorMessage;
  }
};

const createClient = () =>
  new Client({
    authStrategy: new LocalAuth(),
    puppeteer: { args: ["--no-sandbox", "--disable-setuid-sandbox"] },
  });

const bindWhatsAppEvents = (instance) => {
  instance.on("qr", async (qr) => {
    try {
      qrCodeDataUrl = await QRCode.toDataURL(qr, {
        width: 320,
        margin: 1,
      });
      lastQrText = qr;
      updateStatus("qr_ready");
    } catch (error) {
      updateStatus("error", `No se pudo generar el QR: ${error.message}`);
    }
  });

  instance.on("ready", () => {
    qrCodeDataUrl = null;
    lastQrText = null;
    updateStatus("ready");
  });

  instance.on("auth_failure", (message) => {
    qrCodeDataUrl = null;
    lastQrText = null;
    updateStatus("auth_failure", message || "Fallo de autenticacion");
  });

  instance.on("disconnected", (reason) => {
    qrCodeDataUrl = null;
    lastQrText = null;
    updateStatus("disconnected", reason || "Cliente desconectado");
    client = null;
  });

  instance.on("message", async (message) => {
    if (message.from === "status@broadcast") return;

    const numberPhoneContact = await getNumberContact(message);

    try {
      const senderAccess = await resolveTenantBySender(numberPhoneContact);

      if (senderAccess.access === "ambiguous") {
        console.error(
          `Configuracion WhatsApp ambigua para el numero ${senderAccess.senderNumber}`,
        );
        await instance.sendMessage(
          message.from,
          "Tu numero aparece en mas de una empresa. Contacta al administrador para corregir la configuracion.",
        );
        return;
      }

      if (senderAccess.access !== "allowed" || !senderAccess.tenantId) {
        console.log(`⛔ Intento de acceso denegado de: ${message.from}`);
        await instance.sendMessage(
          message.from,
          "Hola. Este numero no esta autorizado para usar el asistente de esta empresa.",
        );
        return;
      }

      let messageText = message.body;

      // Detectar si el mensaje es un audio (nota de voz)
      if (
        message.hasMedia &&
        (message.type === "ptt" || message.type === "audio")
      ) {
        console.log(`🎤 Audio recibido de ${message.from}, procesando...`);

        // 1. Descargar el medio
        const media = await message.downloadMedia();

        // 2. Guardarlo temporalmente (WhatsApp usa formato ogg para las notas de voz)
        const filePath = path.join(tempDir, `${Date.now()}_audio.ogg`);
        fs.writeFileSync(filePath, media.data, "base64");

        // 3. Transcribir con Groq (Whisper)
        messageText = await transcribeAudio(filePath);
        console.log(`📝 Transcripción: "${messageText}"`);

        // 4. Limpiar el archivo temporal
        fs.unlinkSync(filePath);
      }

      // Si es texto (o ya fue transcrito), lo pasamos a nuestro Enrutador (Llama 70B)
      if (messageText) {
        // Notificar al usuario que estamos procesando (opcional, útil para audios largos)
        // await client.sendMessage(message.from, '⏳ Procesando...');

        const iaResponse = await handleIncomingMessage(
          message.from,
          messageText,
          {
            tenantId: senderAccess.tenantId,
            sendInvoicePdf: async ({ pdfPath, caption }) => {
              const media = MessageMedia.fromFilePath(pdfPath);
              try {
                await instance.sendMessage(message.from, media, {
                  caption: caption || "Factura PDF",
                });
              } finally {
                if (pdfPath && fs.existsSync(pdfPath)) {
                  fs.unlinkSync(pdfPath);
                }
              }
            },
          },
        );
        await instance.sendMessage(message.from, iaResponse);
      }
    } catch (error) {
      console.error("❌ Error procesando el mensaje:", error);
      await instance.sendMessage(
        message.from,
        "Lo siento, tuve un problema procesando tu mensaje o audio.",
      );
    }
  });
};

const initializeWhatsApp = async () => {
  if (
    connectionStatus === "starting" ||
    connectionStatus === "ready" ||
    connectionStatus === "qr_ready"
  ) {
    return getWhatsAppStatus();
  }

  if (!client) {
    client = createClient();
    bindWhatsAppEvents(client);
  }

  qrCodeDataUrl = null;
  lastQrText = null;
  lastError = null;
  updateStatus("starting");

  try {
    await client.initialize();
  } catch (error) {
    updateStatus("error", error.message);
    client = null;
  }

  return getWhatsAppStatus();
};

const stopWhatsApp = async () => {
  if (!client) {
    updateStatus("stopped");
    return getWhatsAppStatus();
  }

  updateStatus("stopping");
  try {
    await client.destroy();
  } catch (error) {
    updateStatus("error", error.message);
  } finally {
    client = null;
    qrCodeDataUrl = null;
    lastQrText = null;
    updateStatus("stopped");
  }

  return getWhatsAppStatus();
};

const restartWhatsApp = async () => {
  await stopWhatsApp();
  return initializeWhatsApp();
};

const getWhatsAppStatus = () => ({
  status: connectionStatus,
  hasQr: Boolean(lastQrText),
  qrCodeDataUrl,
  lastError,
  lastEventAt,
  isClientActive: Boolean(client),
});

const sendMessage = async (to, body) => {
  if (!client || connectionStatus !== "ready") {
    throw new Error("WhatsApp no esta conectado");
  }
  return client.sendMessage(to, body);
};

module.exports = {
  initializeWhatsApp,
  stopWhatsApp,
  restartWhatsApp,
  getWhatsAppStatus,
  sendMessage,
};
