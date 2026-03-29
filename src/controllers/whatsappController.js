const {
  initializeWhatsApp,
  stopWhatsApp,
  restartWhatsApp,
  getWhatsAppStatus,
} = require("../services/whatsappService");
const { handleServerError } = require("../utils/http");

exports.getStatus = async (_req, res) => {
  try {
    res.json(getWhatsAppStatus());
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
