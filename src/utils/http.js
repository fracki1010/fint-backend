const isProduction = () => process.env.NODE_ENV === "production";

class HttpError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status || 500;
    this.code = code || "INTERNAL_ERROR";
    this.details = details;
  }
}

const normalizeValidationDetails = (issues = []) =>
  issues.map((issue) => ({
    path: Array.isArray(issue.path) ? issue.path.join(".") : "",
    message: issue.message,
  }));

const sendError = (res, { status = 500, code, message, details = null }) => {
  const payload = {
    error: {
      code: code || (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR"),
      message:
        message ||
        (status >= 500 ? "Error interno del servidor" : "Solicitud inválida"),
    },
  };

  if (details && (!isProduction() || status < 500)) {
    payload.error.details = details;
  }

  return res.status(status).json(payload);
};

const handleServerError = (res, error, fallbackMessage) => {
  if (error instanceof HttpError) {
    return sendError(res, {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details,
    });
  }

  return sendError(res, {
    status: 500,
    code: "INTERNAL_ERROR",
    message: fallbackMessage || "Error interno del servidor",
    details: isProduction() ? null : { reason: error?.message || "unknown" },
  });
};

module.exports = {
  HttpError,
  normalizeValidationDetails,
  sendError,
  handleServerError,
};
