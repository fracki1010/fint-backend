const Supplier = require("../models/supplier.model");
const { sendError, handleServerError } = require("../utils/http");

exports.getSuppliers = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const includeInactive = req.query.includeInactive === "true";
    const filter = includeInactive
      ? { tenant: tenantId }
      : { tenant: tenantId, isActive: { $ne: false } };

    const suppliers = await Supplier.find(filter).sort({ name: 1 });
    return res.json(suppliers);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener proveedores");
  }
};

exports.getSupplierById = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const supplier = await Supplier.findOne({
      _id: req.params.id,
      tenant: tenantId,
      isActive: { $ne: false },
    });

    if (!supplier) {
      return sendError(res, {
        status: 404,
        code: "SUPPLIER_NOT_FOUND",
        message: "Proveedor no encontrado",
      });
    }

    return res.json(supplier);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener proveedor");
  }
};

exports.createSupplier = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const name = req.body.name?.toString().trim();

    if (!name) {
      return sendError(res, {
        status: 400,
        code: "VALIDATION_ERROR",
        message: "El nombre es requerido.",
      });
    }

    const created = await Supplier.create({
      tenant: tenantId,
      name,
      company: req.body.company?.trim() || "",
      taxId: req.body.taxId?.trim() || "",
      phone: req.body.phone?.trim() || "",
      email: req.body.email?.trim() || "",
      address: req.body.address?.trim() || "",
      notes: req.body.notes || "",
    });

    return res.status(201).json(created);
  } catch (error) {
    return handleServerError(res, error, "Error al crear proveedor");
  }
};

exports.updateSupplier = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const supplier = await Supplier.findOne({
      _id: req.params.id,
      tenant: tenantId,
      isActive: { $ne: false },
    });

    if (!supplier) {
      return sendError(res, {
        status: 404,
        code: "SUPPLIER_NOT_FOUND",
        message: "Proveedor no encontrado",
      });
    }

    Object.assign(supplier, {
      name: req.body.name?.trim() || supplier.name,
      company: req.body.company?.trim() ?? supplier.company,
      taxId: req.body.taxId?.trim() ?? supplier.taxId,
      phone: req.body.phone?.trim() ?? supplier.phone,
      email: req.body.email?.trim() ?? supplier.email,
      address: req.body.address?.trim() ?? supplier.address,
      notes: req.body.notes ?? supplier.notes,
    });

    await supplier.save();
    return res.json(supplier);
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar proveedor");
  }
};

exports.deleteSupplier = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const supplier = await Supplier.findOneAndUpdate(
      { _id: req.params.id, tenant: tenantId, isActive: { $ne: false } },
      { isActive: false, deletedAt: new Date() },
      { new: true },
    );

    if (!supplier) {
      return sendError(res, {
        status: 404,
        code: "SUPPLIER_NOT_FOUND",
        message: "Proveedor no encontrado",
      });
    }

    return res.json({ message: "Proveedor eliminado", supplier });
  } catch (error) {
    return handleServerError(res, error, "Error al eliminar proveedor");
  }
};
