const Setting = require("../models/setting.model");

const WORKER_URL = process.env.WORKER_URL || "http://localhost:3001";
const WORKER_INTERNAL_SECRET = process.env.WORKER_INTERNAL_SECRET || "";

const normalizeWhatsAppNumber = (value = "") =>
  value.toString().trim().replace(/[^\d]/g, "");

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

  if (matches.length === 0)
    return { senderNumber, access: "denied", tenantId: null };
  if (matches.length > 1)
    return { senderNumber, access: "ambiguous", tenantId: null };

  return { senderNumber, access: "allowed", tenantId: matches[0].tenant };
};

const workerRequest = async (method, path, body = null) => {
  const url = `${WORKER_URL}${path}`;
  const options = {
    method: method.toUpperCase(),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${WORKER_INTERNAL_SECRET}`,
    },
    signal: AbortSignal.timeout(15000),
  };
  if (body) options.body = JSON.stringify(body);

  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Worker ${response.status}: ${text}`);
    }
    return response.json();
  } catch (err) {
    if (
      err.name === "TimeoutError" ||
      err.code === "ECONNREFUSED" ||
      err.cause?.code === "ECONNREFUSED"
    ) {
      return {
        status: "worker_unavailable",
        hasQr: false,
        qrCodeDataUrl: null,
        lastError: "Worker no disponible. Inicialo con: node whatsapp-worker/server.js",
        isClientActive: false,
      };
    }
    throw err;
  }
};

const initializeWhatsApp = () => workerRequest("post", "/start");
const stopWhatsApp = () => workerRequest("post", "/stop");
const restartWhatsApp = () => workerRequest("post", "/restart");
const getWhatsAppStatus = () => workerRequest("get", "/status");
const sendMessage = (to, body) => workerRequest("post", "/send", { to, body });
const sendMediaMessage = (to, mediaBase64, mimetype, filename, caption) =>
  workerRequest("post", "/send-media", {
    to,
    mediaBase64,
    mimetype,
    filename,
    caption,
  });

module.exports = {
  initializeWhatsApp,
  stopWhatsApp,
  restartWhatsApp,
  getWhatsAppStatus,
  sendMessage,
  sendMediaMessage,
  resolveTenantBySender,
};
