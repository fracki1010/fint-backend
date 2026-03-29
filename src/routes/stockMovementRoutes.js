const express = require("express");
const router = express.Router();
const stockMovementController = require("../controllers/stockMovementController");
const validateRequest = require("../middlewares/validateRequest");
const {
  idParam,
  stockMovementBody,
  stockQuerySchema,
} = require("../validators/schemas");

router.get(
  "/",
  validateRequest({ query: stockQuerySchema }),
  stockMovementController.getStockMovements,
);
router.get(
  "/:id",
  validateRequest({ params: idParam }),
  stockMovementController.getStockMovementById,
);
router.post(
  "/",
  validateRequest({ body: stockMovementBody }),
  stockMovementController.createStockMovement,
);

module.exports = router;
