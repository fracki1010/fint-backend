const mongoose = require("mongoose");
const Location = require("../models/location.model");
const LocationStock = require("../models/locationStock.model");
const { Product } = require("../models/product.model");
const StockMovement = require("../models/stockMovement.model");

// Moves stock from a deposit to a point of sale. The tenant total (Product.stock) does not change:
// stock only moves between places. Both writes and the movement share one transaction.
const transferStock = async ({ tenantId, fromLocationId, toLocationId, productId, quantity, reason = "Transferencia" }) => {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw Object.assign(new Error("La cantidad a transferir debe ser mayor a cero."), { code: "INVALID_QUANTITY" });
  }
  if (String(fromLocationId) === String(toLocationId)) {
    throw Object.assign(new Error("El origen y el destino no pueden ser el mismo lugar."), { code: "SAME_LOCATION" });
  }

  const [from, to] = await Promise.all([
    Location.findOne({ _id: fromLocationId, tenant: tenantId, isActive: true }).lean(),
    Location.findOne({ _id: toLocationId, tenant: tenantId, isActive: true }).lean(),
  ]);
  if (!from || !to) {
    throw Object.assign(new Error("Lugar no encontrado."), { code: "LOCATION_NOT_FOUND" });
  }
  if (from.kind !== "deposito") {
    throw Object.assign(new Error("Las transferencias salen de un depósito."), { code: "SOURCE_NOT_DEPOSIT" });
  }
  if (to.kind !== "sucursal") {
    throw Object.assign(new Error("Las transferencias llegan a una sucursal."), { code: "TARGET_NOT_BRANCH" });
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const product = await Product.findOne({ _id: productId, tenant: tenantId }).session(session);
      if (!product) {
        throw Object.assign(new Error("Producto no encontrado."), { code: "PRODUCT_NOT_FOUND" });
      }

      // Conditional decrement: fails atomically when the deposit does not have enough.
      const source = await LocationStock.findOneAndUpdate(
        { tenant: tenantId, location: from._id, product: product._id, stock: { $gte: qty } },
        { $inc: { stock: -qty } },
        { new: true, session },
      );
      if (!source) {
        const current = await LocationStock.findOne({
          tenant: tenantId,
          location: from._id,
          product: product._id,
        }).session(session).lean();
        throw Object.assign(
          new Error(`Stock insuficiente en ${from.name}. Disponible: ${current?.stock || 0}`),
          { code: "INSUFFICIENT_STOCK" },
        );
      }

      const target = await LocationStock.findOneAndUpdate(
        { tenant: tenantId, location: to._id, product: product._id },
        { $inc: { stock: qty } },
        { new: true, upsert: true, session, setDefaultsOnInsert: true },
      );

      await StockMovement.create(
        [
          {
            tenant: tenantId,
            product: product._id,
            type: "TRANSFERENCIA",
            quantity: qty,
            stockBefore: product.stock,
            stockAfter: product.stock,
            fromLocation: from._id,
            toLocation: to._id,
            reason,
            source: "Dashboard",
          },
        ],
        { session },
      );

      result = {
        product: product.name,
        from: { location: from.name, stock: source.stock },
        to: { location: to.name, stock: target.stock },
      };
    });
    return result;
  } finally {
    await session.endSession();
  }
};



// The deposit that holds the tenant's stock when no point of sale is involved (the owner's sales,
// and every sale made before multi-location was enabled). Earliest active deposit wins.
const findCentralDepositId = async (tenantId) => {
  const deposit = await Location.findOne({ tenant: tenantId, kind: "deposito", isActive: true })
    .sort({ createdAt: 1 })
    .select("_id")
    .lean();
  return deposit?._id || null;
};

// The owner loads stock received into a deposit. It is new goods, so the tenant total grows with it.
const loadDepositStock = async ({ tenantId, depositId, productId, quantity, reason = "Carga de stock" }) => {
  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw Object.assign(new Error("La cantidad a cargar debe ser mayor a cero."), { code: "INVALID_QUANTITY" });
  }
  const deposit = await Location.findOne({ _id: depositId, tenant: tenantId, isActive: true }).lean();
  if (!deposit) {
    throw Object.assign(new Error("Lugar no encontrado."), { code: "LOCATION_NOT_FOUND" });
  }
  if (deposit.kind !== "deposito") {
    throw Object.assign(new Error("La carga de stock se hace en un depósito."), { code: "TARGET_NOT_DEPOSIT" });
  }

  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      const product = await Product.findOneAndUpdate(
        { _id: productId, tenant: tenantId },
        { $inc: { stock: qty } },
        { new: false, session },
      );
      if (!product) {
        throw Object.assign(new Error("Producto no encontrado."), { code: "PRODUCT_NOT_FOUND" });
      }
      const stock = await adjustLocationStock({ tenantId, locationId: deposit._id, productId, delta: qty, session });

      await StockMovement.create(
        [
          {
            tenant: tenantId,
            product: product._id,
            type: "ENTRADA",
            quantity: qty,
            stockBefore: product.stock,
            stockAfter: product.stock + qty,
            toLocation: deposit._id,
            reason,
            source: "Dashboard",
          },
        ],
        { session },
      );
      result = { product: product.name, location: deposit.name, stock: stock.stock };
    });
    return result;
  } finally {
    await session.endSession();
  }
};

// Adds (delta > 0) or removes (delta < 0) stock of one product in one place, inside the caller's
// transaction. Removing fails atomically when the place does not have enough.
const adjustLocationStock = async ({ tenantId, locationId, productId, delta, session }) => {
  const filter = { tenant: tenantId, location: locationId, product: productId };
  if (delta < 0) {
    const updated = await LocationStock.findOneAndUpdate(
      { ...filter, stock: { $gte: -delta } },
      { $inc: { stock: delta } },
      { new: true, session },
    );
    if (!updated) {
      throw Object.assign(new Error("Stock insuficiente en el lugar."), { code: "INSUFFICIENT_LOCATION_STOCK" });
    }
    return updated;
  }
  return LocationStock.findOneAndUpdate(
    filter,
    { $inc: { stock: delta } },
    { new: true, upsert: true, session, setDefaultsOnInsert: true },
  );
};

module.exports = { transferStock, loadDepositStock, findCentralDepositId, adjustLocationStock };
