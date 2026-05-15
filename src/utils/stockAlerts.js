const { createAndDispatchNotification } = require("../services/notificationService");

async function notifyLowStock(userId, product) {
  if (!userId || !product) return;
  if (!product.minStock || product.minStock <= 0) return;
  if (product.stock > product.minStock) return;

  await createAndDispatchNotification({
    userId,
    type: "warning",
    title: "Stock bajo",
    message: `${product.name}: quedan ${product.stock} ${product.unit || "unidades"} (mínimo: ${product.minStock})`,
    metadata: {
      productId: product._id?.toString(),
      productName: product.name,
      currentStock: product.stock,
      minStock: product.minStock,
      unit: product.unit,
    },
  });
}

module.exports = { notifyLowStock };
