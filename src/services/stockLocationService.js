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

module.exports = { transferStock };
