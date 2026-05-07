const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const voucherController = require("../controllers/voucherController");
const validateRequest = require("../middlewares/validateRequest");
const {
  idParam,
  createOrderBody,
  updateOrderBody,
  includeInactiveQuery,
} = require("../validators/schemas");
const { z } = require("zod");

// Validation schema for voucher generation
const voucherTypesEnum = z.enum(["invoice", "delivery_note", "receipt"]);
const generateVouchersBody = z.object({
  types: z.array(voucherTypesEnum).min(1, "Debe incluir al menos un tipo").optional(),
  generateOnCreate: z.boolean().optional(),
});

router.get("/", validateRequest({ query: includeInactiveQuery }), orderController.getOrders);
router.get("/:id", validateRequest({ params: idParam }), orderController.getOrderById);
router.post("/", validateRequest({ body: createOrderBody }), orderController.createOrder);
router.put(
  "/:id",
  validateRequest({ params: idParam, body: updateOrderBody }),
  orderController.updateOrder,
);
router.delete("/:id", validateRequest({ params: idParam }), orderController.deleteOrder);

// Voucher routes for orders
router.get(
  "/:id/vouchers",
  validateRequest({ params: idParam }),
  voucherController.getVouchersByOrder,
);
router.post(
  "/:id/vouchers",
  validateRequest({ params: idParam, body: generateVouchersBody }),
  voucherController.generateVouchersForOrder,
);

module.exports = router;
