const express = require("express");

const paymentOrderController = require("../controllers/paymentOrderController");
const validateRequest = require("../middlewares/validateRequest");
const {
  idParam,
  createPaymentOrderBody,
  updatePaymentOrderBody,
} = require("../validators/schemas");

const router = express.Router();

router.get("/", paymentOrderController.listPaymentOrders);
router.get("/:id", validateRequest({ params: idParam }), paymentOrderController.getPaymentOrder);
router.post("/", validateRequest({ body: createPaymentOrderBody }), paymentOrderController.createPaymentOrder);
router.put("/:id", validateRequest({ params: idParam, body: updatePaymentOrderBody }), paymentOrderController.updatePaymentOrder);
router.delete("/:id", validateRequest({ params: idParam }), paymentOrderController.deletePaymentOrder);
router.post("/:id/apply", validateRequest({ params: idParam }), paymentOrderController.applyPaymentOrder);

module.exports = router;
