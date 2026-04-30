const { createAndDispatchNotification } = require("../services/notificationService");

async function notifyLowStock(userId, supply) {
  if (!userId || !supply) return;
  if (!supply.minStock || supply.minStock <= 0) return;
  if (supply.currentStock > supply.minStock) return;

  await createAndDispatchNotification({
    userId,
    type: "warning",
    title: "Stock bajo de insumo",
    message: `${supply.name}: quedan ${supply.currentStock} ${supply.unit} (mínimo: ${supply.minStock})`,
    metadata: {
      type: "LOW_STOCK",
      supplyId: supply._id?.toString(),
      supplyName: supply.name,
      currentStock: supply.currentStock,
      minStock: supply.minStock,
      unit: supply.unit,
    },
  });
}

module.exports = { notifyLowStock };
