const jwt = require("jsonwebtoken");

const User = require("../models/user.model");
const { getRequiredEnv } = require("../config/runtime");

const resolveUserByToken = async (token) => {
  if (!token) return null;

  const jwtSecret = getRequiredEnv("JWT_SECRET");
  const payload = jwt.verify(token, jwtSecret);
  const user = await User.findById(payload.userId).select("-passwordHash");

  if (!user || !user.isActive) return null;
  return user;
};

const authMiddleware = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    if (!token) {
      return res.status(401).json({ message: "No autenticado" });
    }

    const user = await resolveUserByToken(token);
    if (!user) {
      return res.status(401).json({ message: "Sesion invalida" });
    }

    req.user = user;
    return next();
  } catch {
    return res.status(401).json({ message: "Token invalido o expirado" });
  }
};

module.exports = authMiddleware;
module.exports.resolveUserByToken = resolveUserByToken;
