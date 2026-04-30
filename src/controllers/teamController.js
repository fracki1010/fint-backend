const bcrypt = require("bcryptjs");

const User = require("../models/user.model");
const { sendError, handleServerError } = require("../utils/http");

const ROLE_LABELS = {
  admin: "Administrador",
  ventas: "Ventas",
  deposito: "Depósito",
  contabilidad: "Contabilidad",
  lectura: "Solo lectura",
};

const toPublicUser = (u) => ({
  _id: u._id,
  fullName: u.fullName,
  email: u.email,
  role: u.role,
  roleLabel: ROLE_LABELS[u.role] || u.role,
  isActive: u.isActive,
  lastLoginAt: u.lastLoginAt,
  createdAt: u.createdAt,
});

exports.getTeam = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const members = await User.find({ tenant: tenantId })
      .select("-passwordHash")
      .sort({ createdAt: 1 });

    return res.json(members.map(toPublicUser));
  } catch (error) {
    return handleServerError(res, error, "Error al obtener equipo");
  }
};

exports.createTeamMember = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const { fullName, email, password, role } = req.body;

    const cleanEmail = email?.toString().trim().toLowerCase();
    const cleanName = fullName?.toString().trim();
    const cleanPassword = password?.toString();

    if (!cleanName || !cleanEmail || !cleanPassword || cleanPassword.length < 6) {
      return sendError(res, {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "Nombre, email y contraseña (mín. 6 caracteres) son requeridos.",
      });
    }

    const validRoles = ["admin", "ventas", "deposito", "contabilidad", "lectura"];
    const cleanRole = validRoles.includes(role) ? role : "lectura";

    const existing = await User.findOne({ email: cleanEmail });
    if (existing) {
      return sendError(res, {
        status: 409,
        code: "EMAIL_ALREADY_EXISTS",
        message: "Ya existe un usuario con ese email.",
      });
    }

    const passwordHash = await bcrypt.hash(cleanPassword, 10);
    const member = await User.create({
      tenant: tenantId,
      fullName: cleanName,
      email: cleanEmail,
      passwordHash,
      role: cleanRole,
      isSuperAdmin: false,
    });

    return res.status(201).json(toPublicUser(member));
  } catch (error) {
    return handleServerError(res, error, "Error al crear miembro del equipo");
  }
};

exports.updateTeamMember = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const member = await User.findOne({ _id: req.params.id, tenant: tenantId });

    if (!member) {
      return sendError(res, { status: 404, code: "USER_NOT_FOUND", message: "Usuario no encontrado" });
    }

    // Prevent editing your own role/status
    if (member._id.toString() === req.user._id.toString()) {
      return sendError(res, {
        status: 400,
        code: "SELF_EDIT",
        message: "No podés editar tu propio rol o estado.",
      });
    }

    const validRoles = ["admin", "ventas", "deposito", "contabilidad", "lectura"];

    if (req.body.fullName) member.fullName = req.body.fullName.trim();
    if (req.body.role && validRoles.includes(req.body.role)) member.role = req.body.role;
    if (typeof req.body.isActive === "boolean") member.isActive = req.body.isActive;
    if (req.body.password && req.body.password.length >= 6) {
      member.passwordHash = await bcrypt.hash(req.body.password, 10);
    }

    await member.save();
    return res.json(toPublicUser(member));
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar miembro del equipo");
  }
};

exports.deleteTeamMember = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const member = await User.findOne({ _id: req.params.id, tenant: tenantId });

    if (!member) {
      return sendError(res, { status: 404, code: "USER_NOT_FOUND", message: "Usuario no encontrado" });
    }

    if (member._id.toString() === req.user._id.toString()) {
      return sendError(res, { status: 400, code: "SELF_DELETE", message: "No podés eliminarte a vos mismo." });
    }

    member.isActive = false;
    await member.save();
    return res.json({ message: "Usuario desactivado", member: toPublicUser(member) });
  } catch (error) {
    return handleServerError(res, error, "Error al desactivar usuario");
  }
};
