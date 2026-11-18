const mongoose = require("mongoose");
const Client = require("../models/client.model");
const Order = require("../models/order.model");
const {
  createAndDispatchNotification,
} = require("../services/notificationService");
const { sendError, handleServerError } = require("../utils/http");

const normalizePhone = (value = "") => value.toString().trim();
const normalizeText = (value = "") => value.toString().trim();

const buildClientMetrics = (orders) => {
  const totalSpent = orders.reduce(
    (sum, order) => sum + (order.totalAmount || 0),
    0,
  );
  const pendingOrders = orders.filter(
    (order) => order.salesStatus !== "Cancelada" && order.deliveryStatus !== "Entregada",
  ).length;
  const deliveredOrders = orders.filter(
    (order) => order.deliveryStatus === "Entregada",
  ).length;

  return {
    totalOrders: orders.length,
    totalSpent,
    pendingOrders,
    deliveredOrders,
    lastOrderAt: orders[0]?.createdAt || null,
  };
};

// Metrics over every order of the client, not just the ones returned in the list.
const getClientMetrics = async (tenantId, clientId) => {
  const [agg] = await Order.aggregate([
    { $match: { tenant: new mongoose.Types.ObjectId(tenantId), client: clientId } },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalSpent: { $sum: { $ifNull: ["$totalAmount", 0] } },
        pendingOrders: {
          $sum: {
            $cond: [
              { $and: [{ $ne: ["$salesStatus", "Cancelada"] }, { $ne: ["$deliveryStatus", "Entregada"] }] },
              1,
              0,
            ],
          },
        },
        deliveredOrders: { $sum: { $cond: [{ $eq: ["$deliveryStatus", "Entregada"] }, 1, 0] } },
        lastOrderAt: { $max: "$createdAt" },
      },
    },
  ]);

  return {
    totalOrders: agg?.totalOrders || 0,
    totalSpent: agg?.totalSpent || 0,
    pendingOrders: agg?.pendingOrders || 0,
    deliveredOrders: agg?.deliveredOrders || 0,
    lastOrderAt: agg?.lastOrderAt || null,
  };
};

const GENERIC_CLIENT_NAME = "Consumidor Final";
const GENERIC_CLIENT_PHONE = "0000000000";

exports.getOrCreateGenericClient = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;

    let client = await Client.findOne({
      tenant: tenantId,
      name: GENERIC_CLIENT_NAME,
      isActive: { $ne: false },
    });

    if (!client) {
      client = new Client({
        tenant: tenantId,
        name: GENERIC_CLIENT_NAME,
        phone: GENERIC_CLIENT_PHONE,
        taxId: "",
        isActive: true,
        debt: 0,
      });
      await client.save();
    }

    res.json({ client });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener cliente genérico");
  }
};

// Obtener todos los clientes
exports.getClients = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const includeInactive = req.query.includeInactive === "true";
    const filter = includeInactive
      ? { tenant: tenantId }
      : { tenant: tenantId, isActive: { $ne: false } };
    const hasPagination =
      req.query.page !== undefined || req.query.limit !== undefined;

    if (!hasPagination) {
      const clients = await Client.find(filter).sort({ createdAt: -1 });
      return res.json(clients);
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const [clients, total] = await Promise.all([
      Client.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Client.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return res.json({
      clients,
      totalPages,
      currentPage: page,
      total,
      hasNextPage: page < totalPages,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener clientes");
  }
};

// Obtener un cliente por ID
exports.getClientById = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const includeInactive = req.query.includeInactive === "true";
    const filter = includeInactive
      ? { tenant: tenantId }
      : { tenant: tenantId, isActive: { $ne: false } };
    const client = await Client.findOne({ _id: req.params.id, ...filter });
    if (!client) {
      return sendError(res, {
        status: 404,
        code: "CLIENT_NOT_FOUND",
        message: "Cliente no encontrado",
      });
    }

    const orders = await Order.find({ tenant: tenantId, client: client._id })
      .sort({ createdAt: -1 })
      .limit(25);

    return res.json({
      client,
      orders,
      metrics: await getClientMetrics(tenantId, client._id),
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener el cliente");
  }
};

// Crear un nuevo cliente
exports.createClient = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const phone = normalizePhone(req.body.phone);
    const taxId = normalizeText(req.body.taxId);


    const existingClient = await Client.findOne({ tenant: tenantId, phone });
    if (existingClient) {
      return sendError(res, {
        status: 409,
        code: "CLIENT_PHONE_ALREADY_EXISTS",
        message: "Ya existe un cliente con este número de teléfono",
      });
    }

    const newClient = new Client({
      tenant: tenantId,
      phone,
      name: req.body.name?.trim(),
      taxId,
      email: req.body.email?.trim() || undefined,
      address: req.body.address?.trim() || undefined,
      fiscalAddress:
        req.body.fiscalAddress?.trim() || req.body.address?.trim() || undefined,
      company: req.body.company?.trim() || undefined,
      notes: req.body.notes?.trim() || undefined,
      debt: req.body.debt || 0,
      priceList: req.body.priceList || "retail",
      isActive: true,
      deletedAt: null,
    });
    await newClient.save();
    await createAndDispatchNotification({
      userId: req.user?._id,
      type: "success",
      title: "Cliente creado",
      message: `Se registró el cliente ${newClient.name || newClient.phone}.`,
      metadata: { clientId: newClient._id },
    });
    res.status(201).json(newClient);
  } catch (error) {
    return handleServerError(res, error, "Error al crear el cliente");
  }
};

// Actualizar un cliente
exports.updateClient = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const client = await Client.findOne({
      tenant: tenantId,
      _id: req.params.id,
      isActive: { $ne: false },
    });

    if (!client) {
      return sendError(res, {
        status: 404,
        code: "CLIENT_NOT_FOUND",
        message: "Cliente no encontrado",
      });
    }

    const nextPhone = req.body.phone ? normalizePhone(req.body.phone) : client.phone;
    const nextTaxId =
      req.body.taxId !== undefined ? normalizeText(req.body.taxId) : client.taxId;
    const duplicated = await Client.findOne({
      tenant: tenantId,
      _id: { $ne: req.params.id },
      phone: nextPhone,
    });

    if (duplicated) {
      return sendError(res, {
        status: 409,
        code: "CLIENT_PHONE_ALREADY_EXISTS",
        message: "Ya existe un cliente con este número de teléfono",
      });
    }


    Object.assign(client, {
      name: req.body.name?.trim() ?? client.name,
      phone: nextPhone,
      taxId: nextTaxId,
      email:
        req.body.email !== undefined ? req.body.email?.trim() || undefined : client.email,
      address:
        req.body.address !== undefined
          ? req.body.address?.trim() || undefined
          : client.address,
      fiscalAddress:
        req.body.fiscalAddress !== undefined
          ? req.body.fiscalAddress?.trim() || undefined
          : client.fiscalAddress,
      company:
        req.body.company !== undefined
          ? req.body.company?.trim() || undefined
          : client.company,
      notes:
        req.body.notes !== undefined ? req.body.notes?.trim() || undefined : client.notes,
      debt: req.body.debt ?? client.debt,
      priceList:
        req.body.priceList !== undefined
          ? req.body.priceList || "retail"
          : client.priceList,
    });

    await client.save();
    await createAndDispatchNotification({
      userId: req.user?._id,
      type: "info",
      title: "Cliente actualizado",
      message: `Se actualizó ${client.name || client.phone}.`,
      metadata: { clientId: client._id },
    });
    res.json(client);
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar el cliente");
  }
};

// Eliminar un cliente
exports.deleteClient = async (req, res) => {
  try {
    const client = await Client.findOneAndUpdate(
      { _id: req.params.id, tenant: req.user?.tenant, isActive: { $ne: false } },
      { isActive: false, deletedAt: new Date() },
      { returnDocument: "after" },
    );
    if (!client) {
      return sendError(res, {
        status: 404,
        code: "CLIENT_NOT_FOUND",
        message: "Cliente no encontrado",
      });
    }
    await createAndDispatchNotification({
      userId: req.user?._id,
      type: "warning",
      title: "Cliente desactivado",
      message: `Se desactivó ${client.name || client.phone}.`,
      metadata: { clientId: client._id },
    });
    res.json({ message: "Cliente desactivado correctamente" });
  } catch (error) {
    return handleServerError(res, error, "Error al eliminar el cliente");
  }
};

// Paginated orders of one client, newest first.
exports.getClientOrders = async (req, res) => {
  try {
    const tenantId = req.user?.tenant;
    const clientId = req.params.id;
    const limit = Math.min(Math.max(Number(req.query.limit) || 10, 1), 50);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const filter = { tenant: tenantId, client: clientId };

    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Order.countDocuments(filter),
    ]);

    return res.json({
      orders,
      total,
      page,
      limit,
      totalPages: Math.max(Math.ceil(total / limit), 1),
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener las ventas del cliente");
  }
};
