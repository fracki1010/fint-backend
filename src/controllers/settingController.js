const Setting = require("../models/setting.model");
const { handleServerError } = require("../utils/http");

const clampNumber = (value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) return fallback;
  return Math.min(Math.max(numeric, min), max);
};

const sanitizeText = (value, fallback = "") => {
  if (value === undefined || value === null) return fallback;
  return value.toString().trim();
};

const buildAdminPayload = (
  adminInput = {},
  fallback = {},
  institutionalData = {},
) => ({
  fullName: sanitizeText(adminInput.fullName, fallback.fullName || ""),
  role: sanitizeText(adminInput.role, fallback.role || "Administrador"),
  phone: sanitizeText(adminInput.phone, fallback.phone || ""),
  email: sanitizeText(adminInput.email, fallback.email || ""),
  company: {
    name: sanitizeText(
      institutionalData.storeName,
      fallback.company?.name || "",
    ),
    address: sanitizeText(
      institutionalData.address,
      fallback.company?.address || "",
    ),
    phone: sanitizeText(institutionalData.phone, fallback.company?.phone || ""),
    email: sanitizeText(institutionalData.email, fallback.company?.email || ""),
  },
});

// Obtener configuración (solo hay una)
exports.getSettings = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    let settings = await Setting.findOne({ tenant: tenantId });
    if (!settings) {
      settings = new Setting({
        tenant: tenantId,
      });
      await settings.save();
    }

    // Migracion ligera para instalaciones viejas sin bloque admin.
    if (!settings.admin || Object.keys(settings.admin || {}).length === 0) {
      settings.admin = buildAdminPayload(
        {
          fullName: settings.storeName,
          phone: settings.phone,
          email: settings.email,
        },
        {},
        {
          storeName: settings.storeName,
          address: settings.address,
          phone: settings.phone,
          email: settings.email,
        },
      );
      await settings.save();
    }

    res.json(settings);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener configuración");
  }
};

// Actualizar configuración
exports.updateSettings = async (req, res) => {
  try {
    const updateData = req.body;
    const tenantId = req.user?.tenant;
    let settings = await Setting.findOne({ tenant: tenantId });
    const institutionalData = {
      storeName: sanitizeText(updateData.storeName, settings?.storeName || ""),
      taxId: sanitizeText(updateData.taxId, settings?.taxId || ""),
      fiscalCondition: sanitizeText(
        updateData.fiscalCondition,
        settings?.fiscalCondition || "",
      ),
      address: sanitizeText(updateData.address, settings?.address || ""),
      phone: sanitizeText(updateData.phone, settings?.phone || ""),
      email: sanitizeText(updateData.email, settings?.email || ""),
      invoiceTerms: sanitizeText(
        updateData.invoiceTerms,
        settings?.invoiceTerms || "",
      ),
    };

    const sanitizedData = {
      ...updateData,
      storeName: institutionalData.storeName,
      taxId: institutionalData.taxId,
      fiscalCondition: institutionalData.fiscalCondition,
      address: institutionalData.address,
      phone: institutionalData.phone,
      email: institutionalData.email,
      invoiceTerms: institutionalData.invoiceTerms,
      admin:
        updateData.admin !== undefined
          ? buildAdminPayload(updateData.admin, settings?.admin || {}, institutionalData)
          : buildAdminPayload({}, settings?.admin || {}, institutionalData),
      taxRate:
        updateData.taxRate !== undefined
          ? clampNumber(updateData.taxRate, 0, 0, 100)
          : updateData.taxRate,
      lowStockThreshold:
        updateData.lowStockThreshold !== undefined
          ? clampNumber(updateData.lowStockThreshold, 5, 0)
          : updateData.lowStockThreshold,
      orderPrefix:
        updateData.orderPrefix !== undefined
          ? updateData.orderPrefix.toString().trim().toUpperCase() || "VTA"
          : updateData.orderPrefix,
    };

    if (!settings) {
      settings = new Setting({
        ...sanitizedData,
        tenant: tenantId,
      });
    } else {
      Object.assign(settings, sanitizedData);
    }
    await settings.save();
    res.json(settings);
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar configuración");
  }
};
