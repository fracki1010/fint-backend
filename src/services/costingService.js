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

module.exports = { recalculateAVCO };
