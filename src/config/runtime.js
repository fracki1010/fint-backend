const DEV_DEFAULT_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const isProduction = () => process.env.NODE_ENV === "production";

const getRequiredEnv = (name) => {
  const value = process.env[name];
  if (!value || !value.toString().trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.toString().trim();
};

const parseCorsOrigins = () => {
  const raw = process.env.CORS_ORIGINS || "";
  const configured = raw
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured.length > 0) return configured;
  if (isProduction()) return [];
  return DEV_DEFAULT_ORIGINS;
};

const isBootstrapEnabled = () => {
  const flag = (process.env.AUTH_BOOTSTRAP_ENABLED || "").toLowerCase();
  return flag === "true";
};

const validateRuntimeConfig = () => {
  getRequiredEnv("MONGO_URI");
  getRequiredEnv("JWT_SECRET");

  if (isBootstrapEnabled()) {
    getRequiredEnv("ADMIN_SETUP_KEY");
  }
};

module.exports = {
  isProduction,
  getRequiredEnv,
  parseCorsOrigins,
  isBootstrapEnabled,
  validateRuntimeConfig,
};
