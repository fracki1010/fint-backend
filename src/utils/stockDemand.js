// Pure stock arithmetic for orders. Kept free of Mongoose so it can be unit tested.

// Base-unit quantity an order item takes from stock.
// A presentation (e.g. a box of 12) is converted with its equivalentQty,
// the same way applyStockForOrder deducts it.
const baseQuantityFor = (item, product) => {
  const quantity = Number(item.quantity) || 0;
  if (!item.presentationId || !product) return quantity;

  const presentation = (product.presentations || []).find(
    (p) => String(p._id) === String(item.presentationId),
  );
  return presentation ? quantity * (Number(presentation.equivalentQty) || 0) : quantity;
};

// Units per product id that the given orders will take from stock.
const sumDemandByProduct = (orders, productsById) => {
  const demand = new Map();

  for (const order of orders) {
    for (const item of order.items || []) {
      if (!item.productId) continue;

      const key = String(item.productId);
      const qty = baseQuantityFor(item, productsById.get(key));
      demand.set(key, (demand.get(key) || 0) + qty);
    }
  }

  return demand;
};

// First product whose stock cannot cover the requested order once the
// pending orders are served first. Returns null when everything fits.
const findUncoveredItem = ({ requestedOrder, pendingOrders, productsById }) => {
  const committed = sumDemandByProduct(pendingOrders, productsById);
  const requested = sumDemandByProduct([requestedOrder], productsById);

  for (const [key, qty] of requested) {
    const product = productsById.get(key);
    if (!product) continue;

    const available = (Number(product.stock) || 0) - (committed.get(key) || 0);
    if (qty > available) {
      return { product, requested: qty, available: Math.max(available, 0) };
    }
  }

  return null;
};

module.exports = { baseQuantityFor, sumDemandByProduct, findUncoveredItem };
