const express = require("express");

const billOfMaterialController = require("../controllers/billOfMaterialController");
const validateRequest = require("../middlewares/validateRequest");
const { idParam } = require("../validators/schemas");

const router = express.Router();

router.get("/", billOfMaterialController.getBillOfMaterials);
router.post("/", billOfMaterialController.createBillOfMaterial);
router.get("/production-logs", billOfMaterialController.getProductionLogs);
router.get("/:id", validateRequest({ params: idParam }), billOfMaterialController.getBillOfMaterialById);
router.patch("/:id", validateRequest({ params: idParam }), billOfMaterialController.updateBillOfMaterial);
router.delete("/:id", validateRequest({ params: idParam }), billOfMaterialController.deleteBillOfMaterial);
router.post("/:id/produce", validateRequest({ params: idParam }), billOfMaterialController.produceBillOfMaterial);
router.get("/:id/production-logs", validateRequest({ params: idParam }), billOfMaterialController.getBillOfMaterialProductionLogs);

module.exports = router;
