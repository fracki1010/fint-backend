const User = require("../models/user.model");
const { createInvitation, acceptInvitation, unusablePasswordHash } = require("../services/invitationService");
const { sendError, handleServerError } = require("../utils/http");

const MIN_PASSWORD_LENGTH = 6;

// Admin action: creates the link for one team member and returns a WhatsApp share URL.
// wa.me without a number lets the admin pick the contact in WhatsApp.
exports.createMemberInvitation = async (req, res) => {
  try {
    const base = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
    if (!base) {
      return sendError(res, {
        status: 500,
        code: "APP_URL_MISSING",
        message: "Falta configurar FRONTEND_URL para generar invitaciones.",
      });
    }

    const member = await User.findOne({ _id: req.params.id, tenant: req.user.tenant });
    if (!member) {
      return sendError(res, { status: 404, code: "USER_NOT_FOUND", message: "Usuario no encontrado" });
    }
    if (String(member._id) === String(req.user._id)) {
      return sendError(res, {
        status: 400,
        code: "SELF_INVITE",
        message: "No podés invitarte a vos mismo.",
      });
    }

    // Activation replaces the random hash, so a fresh invite can always be issued.
    if (!member.passwordHash) member.passwordHash = await unusablePasswordHash();
    if (member.isModified()) await member.save();

    const { token, expiresAt } = await createInvitation({
      tenantId: req.user.tenant,
      userId: member._id,
    });

    const link = `${base}/activar?token=${token}`;
    const message = `Hola ${member.fullName}, te invitamos a usar Fint Guard. Activá tu usuario y elegí tu contraseña acá (vence en 48 horas): ${link}`;

    return res.status(201).json({
      link,
      whatsappUrl: `https://wa.me/?text=${encodeURIComponent(message)}`,
      expiresAt,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al crear la invitación");
  }
};

// Public: the invited person sets their password with the link they received.
exports.activate = async (req, res) => {
  try {
    const { token, password } = req.body || {};
    if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
      return sendError(res, {
        status: 400,
        code: "VALIDATION_ERROR",
        message: `La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
      });
    }

    await acceptInvitation({ token, password });
    return res.json({ success: true, message: "Usuario activado. Ya podés iniciar sesión." });
  } catch (error) {
    if (error.code === "INVALID_INVITATION") {
      return sendError(res, { status: 400, code: error.code, message: error.message });
    }
    return handleServerError(res, error, "Error al activar el usuario");
  }
};
