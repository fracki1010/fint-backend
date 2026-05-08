const express = require("express");
const router = express.Router();
const costCenterController = require("../controllers/costCenterController");
const validateRequest = require("../middlewares/validateRequest");
const { idParam, createCostCenterBody, updateCostCenterBody } = require("../validators/schemas");

router.get("/", costCenterController.listCostCenters);
router.get("/report", costCenterController.getCostCenterReport);
router.get("/:id", validateRequest({ params: idParam }), costCenterController.getCostCenter);
router.post("/", validateRequest({ body: createCostCenterBody }), costCenterController.createCostCenter);
router.put("/:id", validateRequest({ params: idParam, body: updateCostCenterBody }), costCenterController.updateCostCenter);
router.delete("/:id", validateRequest({ params: idParam }), costCenterController.deleteCostCenter);

module.exports = router;
