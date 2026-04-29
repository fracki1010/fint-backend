const express = require("express");

const supplyController = require("../controllers/supplyController");
const validateRequest = require("../middlewares/validateRequest");
const {
  idParam,
  includeInactiveQuery,
  createSupplyBody,
  updateSupplyBody,
  supplyMovementBody,
} = require("../validators/schemas");

const router = express.Router();

router.get("/", validateRequest({ query: includeInactiveQuery }), supplyController.getSupplies);
router.post("/", validateRequest({ body: createSupplyBody }), supplyController.createSupply);
router.patch(
  "/:id",
  validateRequest({ params: idParam, body: updateSupplyBody }),
  supplyController.updateSupply,
);
router.delete("/:id", validateRequest({ params: idParam }), supplyController.deleteSupply);
router.get(
  "/:id/movements",
  validateRequest({ params: idParam }),
  supplyController.getSupplyMovements,
);
router.post(
  "/:id/movements",
  validateRequest({ params: idParam, body: supplyMovementBody }),
  supplyController.createSupplyMovement,
);

module.exports = router;
