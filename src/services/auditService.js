const AuditLog = require("../models/auditLog.model");

function sanitizeObject(value, depth = 0) {
  if (value == null) return value;
  if (depth > 3) return "[depth-limited]";

  if (Array.isArray(value)) {
    return value.slice(0, 30).map((item) => sanitizeObject(item, depth + 1));
  }

  if (typeof value === "object") {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("token") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("qrcode") ||
        lowerKey.includes("passwordhash")
      ) {
        result[key] = "[redacted]";
      } else {
        result[key] = sanitizeObject(val, depth + 1);
      }
    }

    return result;
  }

  if (typeof value === "string" && value.length > 1200) {
    return `${value.slice(0, 1200)}...[truncated]`;
  }

  return value;
}

async function createAuditLog(payload) {
  try {
    const doc = {
      ...payload,
      metadata: sanitizeObject(payload?.metadata || {}),
    };

    await AuditLog.create(doc);
  } catch (error) {
    // Evita romper flujo principal por falla de auditoría.
    console.error("Audit log error:", error.message);
  }
}

module.exports = {
  createAuditLog,
  sanitizeObject,
};
