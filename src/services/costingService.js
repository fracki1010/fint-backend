const { Product } = require("../models/product.model");
const StockMovement = require("../models/stockMovement.model");

/**
 * Recalcula el costPrice promedio (AVCO) cuando se reciben nuevas unidades.
 * Función pura — no tiene side effects, no modifica el objeto original.
 *
 * @param {Object} product — { stock, costPrice }
 * @param {number} newQty — cantidad recibida
 * @param {number} newUnitCost — costo unitario de la nueva recepción
 * @returns {{ costPrice: number, stock: number }}
 */
function recalculateAVCO(product, newQty, newUnitCost) {
  if (newQty === 0) {
    return { costPrice: product.costPrice ?? 0, stock: product.stock };
  }

  const currentStock = product.stock || 0;
  const currentCostPrice = currentStock === 0 || !product.costPrice
    ? 0
    : product.costPrice;

  if (currentStock === 0 || currentCostPrice === 0) {
    return { costPrice: newUnitCost, stock: currentStock + newQty };
  }

  const currentValue = currentStock * currentCostPrice;
  const newValue = newQty * newUnitCost;
  const totalStock = currentStock + newQty;
  const costPrice = Math.round((currentValue + newValue) / totalStock * 100) / 100;

  return { costPrice, stock: totalStock };
}

/**
 * Procesa la recepción de stock de un producto en el contexto de una compra.
 * Busca el producto, calcula cantidades equivalentes, aplica AVCO,
 * guarda el producto y crea un StockMovement.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.productId
 * @param {number} params.quantity — cantidad recibida en unidades de compra
 * @param {number} params.unitCost — costo unitario de compra
 * @param {string} [params.presentationId] — ID de presentación (opcional)
 * @param {string} [params.purchaseId] — ID de compra asociada
 * @param {string} [params.reason] — motivo del movimiento
 * @param {Object} [params.session] — sesión de Mongoose para transacción
 * @param {boolean} [params.skipStockMovement=false] — si true, no crea StockMovement
 * @returns {Promise<{ product: Object, stockQty: number, unitCostNormalized: number }>}
 */
async function receiveStock({
  tenantId,
  productId,
  quantity,
  unitCost,
  presentationId,
  purchaseId,
  reason,
  session,
  skipStockMovement = false,
}) {
  const filter = { _id: productId, tenant: tenantId, isActive: { $ne: false } };
  const product = session
    ? await Product.findOne(filter).session(session)
    : await Product.findOne(filter);

  if (!product) throw new Error("PRODUCT_NOT_FOUND");
  if (product.type === "finished") throw new Error("PRODUCT_TYPE_NOT_PURCHASABLE");

  // Determine equivalent quantity (how many base units per purchase unit)
  let equivalentQty = product.purchaseEquivalentQty || 1;
  let presentationName;
  let presentationEquivalentQty;
  let presentationUnitCost;

  if (presentationId) {
    const presentation = product.presentations.id(presentationId);
    if (presentation) {
      equivalentQty = presentation.equivalentQty || 1;
      presentationName = presentation.name;
      presentationEquivalentQty = presentation.equivalentQty || 1;
      presentationUnitCost = Number(unitCost);
    }
  }

  const stockQty = Number(quantity) * equivalentQty;
  const unitCostNormalized = equivalentQty !== 1
    ? Number(unitCost) / equivalentQty
    : Number(unitCost);

  const stockBefore = product.stock || 0;
  const result = recalculateAVCO(product, stockQty, unitCostNormalized);

  product.stock = result.stock;
  product.costPrice = result.costPrice;
  product.costLocked = true;

  if (session) {
    await product.save({ session });
  } else {
    await product.save();
  }

  if (!skipStockMovement) {
    const movementData = {
      tenant: tenantId,
      product: product._id,
      type: "ENTRADA",
      quantity: stockQty,
      stockBefore,
      stockAfter: product.stock,
      reason: reason || `Recepción de compra ${purchaseId || ""}`,
      purchase: purchaseId || undefined,
      source: "Sistema",
      presentationName,
      presentationId: presentationId || undefined,
      presentationEquivalentQty,
      presentationUnitCost,
    };

    if (session) {
      await StockMovement.create([movementData], { session });
    } else {
      await StockMovement.create(movementData);
    }
  }

  return {
    product,
    stockQty,
    unitCostNormalized,
  };
}

module.exports = { recalculateAVCO, receiveStock };
