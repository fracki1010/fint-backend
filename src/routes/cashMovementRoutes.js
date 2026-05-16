const express = require("express");
const router = express.Router();
const cashMovementController = require("../controllers/cashMovementController");
const validateRequest = require("../middlewares/validateRequest");
const { createCashMovementBody } = require("../validators/schemas");

router.get("/", cashMovementController.getCashMovements);
router.post("/", validateRequest({ body: createCashMovementBody }), cashMovementController.createCashMovement);
router.delete("/:id", cashMovementController.deleteCashMovement);

module.exports = router;
