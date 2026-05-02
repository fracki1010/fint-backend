const fs = require("fs");
const path = require("path");
const {
  initializeWhatsApp,
  stopWhatsApp,
  restartWhatsApp,
  getWhatsAppStatus,
  sendMessage,
  sendMediaMessage,
  resolveTenantBySender,
} = require("../services/whatsappService");
const { transcribeAudio } = require("../services/groqService");
const { handleIncomingMessage } = require("./iaController");
const { handleServerError } = require("../utils/http");

const tempDir = path.join(__dirname, "../../temp");
if (!fs.existsSync(tempDir)) {
  fs.mkdirSync(tempDir, { recursive: true });
}

const WORKER_INTERNAL_SECRET = process.env.WORKER_INTERNAL_SECRET || "";

exports.getStatus = async (_req, res) => {
  try {
    res.json(await getWhatsAppStatus());
  } catch (error) {
    return handleServerError(res, error, "Error al obtener estado de WhatsApp");
  }
};

exports.start = async (_req, res) => {
  try {
    const status = await initializeWhatsApp();
    res.json(status);
  } catch (error) {
    return handleServerError(res, error, "Error al iniciar WhatsApp");
  }
};

exports.stop = async (_req, res) => {
  try {
    const status = await stopWhatsApp();
    res.json(status);
  } catch (error) {
    return handleServerError(res, error, "Error al detener WhatsApp");
  }
};

exports.restart = async (_req, res) => {
  try {
    const status = await restartWhatsApp();
    res.json(status);
  } catch (error) {
    return handleServerError(res, error, "Error al reiniciar WhatsApp");
  }
};

// Llamado por el worker cuando llega un mensaje de WhatsApp
exports.handleWebhook = async (req, res) => {
  if (WORKER_INTERNAL_SECRET && req.headers.authorization !== `Bearer ${WORKER_INTERNAL_SECRET}`) {
    return res.status(401).json({ error: "No autorizado" });
  }

  // Responder inmediatamente para no bloquear al worker
  res.json({ ok: true });

  const { from, phone, body, type, hasMedia, mediaBase64, mimetype } = req.body;

  try {
    const senderAccess = await resolveTenantBySender(phone);

    if (senderAccess.access === "ambiguous") {
      await sendMessage(
        from,
        "Tu numero aparece en mas de una empresa. Contacta al administrador para corregir la configuracion.",
      );
      return;
    }

    if (senderAccess.access !== "allowed" || !senderAccess.tenantId) {
      console.log(`⛔ Acceso denegado: ${from}`);
      await sendMessage(
        from,
        "Hola. Este numero no esta autorizado para usar el asistente de esta empresa.",
      );
      return;
    }

    let messageText = body;

    if (hasMedia && (type === "ptt" || type === "audio") && mediaBase64) {
      console.log(`🎤 Audio recibido de ${from}, transcribiendo...`);
      const filePath = path.join(tempDir, `${Date.now()}_audio.ogg`);
      fs.writeFileSync(filePath, mediaBase64, "base64");
      try {
        messageText = await transcribeAudio(filePath);
        console.log(`📝 Transcripcion: "${messageText}"`);
      } finally {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    }

    if (!messageText) return;

    const iaResponse = await handleIncomingMessage(from, messageText, {
      tenantId: senderAccess.tenantId,
      sendInvoicePdf: async ({ pdfPath, caption }) => {
        try {
          const pdfBase64 = fs.readFileSync(pdfPath).toString("base64");
          await sendMediaMessage(
            from,
            pdfBase64,
            "application/pdf",
            "factura.pdf",
            caption || "Factura PDF",
          );
        } finally {
          if (pdfPath && fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
        }
      },
    });

    if (iaResponse) {
      await sendMessage(from, iaResponse);
    }
  } catch (error) {
    console.error("❌ Error en webhook WhatsApp:", error);
    try {
      await sendMessage(from, "Lo siento, tuve un problema procesando tu mensaje.");
    } catch (_) {}
  }
};
