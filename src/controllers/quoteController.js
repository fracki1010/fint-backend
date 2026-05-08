const Quote = require("../models/quote.model");
const Order = require("../models/order.model");
const Setting = require("../models/setting.model");
const { HttpError, sendError, handleServerError } = require("../utils/http");

// ── Valid status transitions ───────────────────────────────────────────

const VALID_TRANSITIONS = {
  send: { from: ["DRAFT"], to: "SENT" },
  accept: { from: ["SENT"], to: "ACCEPTED" },
  reject: { from: ["DRAFT", "SENT"], to: "REJECTED" },
  convert: { from: ["ACCEPTED"], to: "CONVERTED" },
};

/**
 * Validates that a quote can transition from its current status to the target status.
 * Throws HttpError if the transition is invalid.
 */
const assertValidTransition = (quote, action) => {
  const transition = VALID_TRANSITIONS[action];
  if (!transition) {
    throw new HttpError(400, "INVALID_ACTION", "Acción no válida");
  }
  if (!transition.from.includes(quote.status)) {
    throw new HttpError(
      400,
      "INVALID_STATUS_TRANSITION",
      `No se puede pasar de ${quote.status} a ${transition.to}`,
    );
  }
};

// ── Quote Number Generation ────────────────────────────────────────────

/**
 * Atomically reserves the next quote number using Setting.quoteSequence.
 * Pattern matches reserveOrderNumber in orderController.js.
 */
const reserveQuoteNumber = async (tenantId) => {
  const settings = await Setting.findOneAndUpdate(
    { tenant: tenantId },
    {
      $setOnInsert: {
        tenant: tenantId,
        quotePrefix: "COT",
      },
      $inc: { quoteSequence: 1 },
    },
    {
      returnDocument: "after",
      upsert: true,
    },
  );

  return `${settings.quotePrefix}-${String(settings.quoteSequence).padStart(6, "0")}`;
};

// ── List Quotes ────────────────────────────────────────────────────────

/**
 * GET /api/quotes
 * Supports filtering by status, dateFrom, dateTo, client, and pagination.
 */
exports.listQuotes = async (req, res) => {
  try {
    const { status, dateFrom, dateTo, client, page, limit } = req.query;
    const filter = { tenant: req.user.tenant };

    if (status) {
      filter.status = status;
    }

    if (dateFrom || dateTo) {
      filter.date = {};
      if (dateFrom) filter.date.$gte = dateFrom;
      if (dateTo) filter.date.$lte = dateTo;
    }

    if (client) {
      filter.client = client;
    }

    const hasPagination = page !== undefined || limit !== undefined;

    if (!hasPagination) {
      const quotes = await Quote.find(filter)
        .populate("client")
        .sort({ createdAt: -1 });
      return res.json({ quotes });
    }

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [quotes, total] = await Promise.all([
      Quote.find(filter)
        .populate("client")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Quote.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limitNum) || 1;

    return res.json({
      quotes,
      totalPages,
      currentPage: pageNum,
      total,
      hasNextPage: pageNum < totalPages,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener presupuestos");
  }
};

// ── Get Single Quote ───────────────────────────────────────────────────

/**
 * GET /api/quotes/:id
 */
exports.getQuote = async (req, res) => {
  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      tenant: req.user.tenant,
    }).populate("client createdBy");

    if (!quote) {
      return sendError(res, {
        status: 404,
        code: "QUOTE_NOT_FOUND",
        message: "Presupuesto no encontrado",
      });
    }

    return res.json(quote);
  } catch (error) {
    return handleServerError(res, error, "Error al obtener el presupuesto");
  }
};

// ── Create Quote ───────────────────────────────────────────────────────

/**
 * POST /api/quotes
 */
exports.createQuote = async (req, res) => {
  try {
    const { client, date, expirationDate, items, subtotal, tax, total, notes } = req.body;

    const quoteNumber = await reserveQuoteNumber(req.user.tenant);

    const quote = await Quote.create({
      tenant: req.user.tenant,
      client,
      quoteNumber,
      date,
      expirationDate: expirationDate || "",
      items,
      subtotal,
      tax: tax || 0,
      total,
      notes: notes || "",
      createdBy: req.user._id || null,
    });

    return res.status(201).json(quote);
  } catch (error) {
    return handleServerError(res, error, "Error al crear el presupuesto");
  }
};

// ── Update Quote ───────────────────────────────────────────────────────

/**
 * PUT /api/quotes/:id
 * Only allowed when status is DRAFT.
 */
exports.updateQuote = async (req, res) => {
  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      tenant: req.user.tenant,
    });

    if (!quote) {
      return sendError(res, {
        status: 404,
        code: "QUOTE_NOT_FOUND",
        message: "Presupuesto no encontrado",
      });
    }

    if (quote.status !== "DRAFT") {
      return sendError(res, {
        status: 403,
        code: "QUOTE_NOT_EDITABLE",
        message: "Solo se pueden editar presupuestos en borrador",
      });
    }

    const { client, date, expirationDate, items, subtotal, tax, total, notes } = req.body;

    if (client !== undefined) quote.client = client;
    if (date !== undefined) quote.date = date;
    if (expirationDate !== undefined) quote.expirationDate = expirationDate;
    if (items !== undefined) quote.items = items;
    if (subtotal !== undefined) quote.subtotal = subtotal;
    if (tax !== undefined) quote.tax = tax;
    if (total !== undefined) quote.total = total;
    if (notes !== undefined) quote.notes = notes;

    await quote.save();

    return res.json(quote);
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar el presupuesto");
  }
};

// ── Delete Quote ───────────────────────────────────────────────────────

/**
 * DELETE /api/quotes/:id
 * Only allowed when status is DRAFT.
 */
exports.deleteQuote = async (req, res) => {
  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      tenant: req.user.tenant,
    });

    if (!quote) {
      return sendError(res, {
        status: 404,
        code: "QUOTE_NOT_FOUND",
        message: "Presupuesto no encontrado",
      });
    }

    if (quote.status !== "DRAFT") {
      return sendError(res, {
        status: 403,
        code: "QUOTE_NOT_EDITABLE",
        message: "Solo se pueden eliminar presupuestos en borrador",
      });
    }

    await Quote.deleteOne({ _id: quote._id });

    return res.json({ message: "Presupuesto eliminado correctamente" });
  } catch (error) {
    return handleServerError(res, error, "Error al eliminar el presupuesto");
  }
};

// ── Send Quote (DRAFT → SENT) ──────────────────────────────────────────

/**
 * POST /api/quotes/:id/send
 */
exports.sendQuote = async (req, res) => {
  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      tenant: req.user.tenant,
    });

    if (!quote) {
      return sendError(res, {
        status: 404,
        code: "QUOTE_NOT_FOUND",
        message: "Presupuesto no encontrado",
      });
    }

    assertValidTransition(quote, "send");
    quote.status = "SENT";
    await quote.save();

    return res.json(quote);
  } catch (error) {
    if (error instanceof HttpError) {
      return sendError(res, {
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }
    return handleServerError(res, error, "Error al enviar el presupuesto");
  }
};

// ── Accept Quote (SENT → ACCEPTED) ─────────────────────────────────────

/**
 * POST /api/quotes/:id/accept
 */
exports.acceptQuote = async (req, res) => {
  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      tenant: req.user.tenant,
    });

    if (!quote) {
      return sendError(res, {
        status: 404,
        code: "QUOTE_NOT_FOUND",
        message: "Presupuesto no encontrado",
      });
    }

    assertValidTransition(quote, "accept");
    quote.status = "ACCEPTED";
    await quote.save();

    return res.json(quote);
  } catch (error) {
    if (error instanceof HttpError) {
      return sendError(res, {
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }
    return handleServerError(res, error, "Error al aceptar el presupuesto");
  }
};

// ── Reject Quote (DRAFT/SENT → REJECTED) ───────────────────────────────

/**
 * POST /api/quotes/:id/reject
 */
exports.rejectQuote = async (req, res) => {
  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      tenant: req.user.tenant,
    });

    if (!quote) {
      return sendError(res, {
        status: 404,
        code: "QUOTE_NOT_FOUND",
        message: "Presupuesto no encontrado",
      });
    }

    assertValidTransition(quote, "reject");
    quote.status = "REJECTED";
    await quote.save();

    return res.json(quote);
  } catch (error) {
    if (error instanceof HttpError) {
      return sendError(res, {
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }
    return handleServerError(res, error, "Error al rechazar el presupuesto");
  }
};

// ── Convert to Order (ACCEPTED → CONVERTED) ────────────────────────────

/**
 * POST /api/quotes/:id/convert
 * Creates an Order from the accepted quote and marks the quote as CONVERTED.
 */
exports.convertToOrder = async (req, res) => {
  try {
    const quote = await Quote.findOne({
      _id: req.params.id,
      tenant: req.user.tenant,
    });

    if (!quote) {
      return sendError(res, {
        status: 404,
        code: "QUOTE_NOT_FOUND",
        message: "Presupuesto no encontrado",
      });
    }

    assertValidTransition(quote, "convert");

    const order = await Order.create({
      tenant: quote.tenant,
      client: quote.client,
      items: quote.items.map((item) => ({
        product: item.product,
        productId: item.productId,
        presentationId: item.presentationId,
        quantity: item.quantity,
        price: item.price,
      })),
      totalAmount: quote.total,
      status: "Confirmada",
      salesStatus: "Confirmada",
      paymentStatus: "Pendiente",
      deliveryStatus: "Pendiente",
      source: "Dashboard",
      notes: `Creado desde presupuesto #${quote.quoteNumber}`,
    });

    quote.convertedToOrder = order._id;
    quote.status = "CONVERTED";
    await quote.save();

    // Return the populated quote and the created order
    const populatedQuote = await Quote.findById(quote._id).populate("client createdBy");

    return res.status(201).json({ quote: populatedQuote, order });
  } catch (error) {
    if (error instanceof HttpError) {
      return sendError(res, {
        status: error.status,
        code: error.code,
        message: error.message,
      });
    }
    return handleServerError(res, error, "Error al convertir el presupuesto en orden");
  }
};
