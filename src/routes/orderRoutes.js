const express = require("express");
const router = express.Router();
const orderController = require("../controllers/orderController");
const validateRequest = require("../middlewares/validateRequest");
const {
  idParam,
  createOrderBody,
  updateOrderBody,
  includeInactiveQuery,
} = require("../validators/schemas");

router.get("/", validateRequest({ query: includeInactiveQuery }), orderController.getOrders);
router.get("/:id", validateRequest({ params: idParam }), orderController.getOrderById);
router.post("/", validateRequest({ body: createOrderBody }), orderController.createOrder);
router.put(
  "/:id",
  validateRequest({ params: idParam, body: updateOrderBody }),
  orderController.updateOrder,
);
router.delete("/:id", validateRequest({ params: idParam }), orderController.deleteOrder);

module.exports = router;
