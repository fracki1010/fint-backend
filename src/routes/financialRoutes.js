const express = require("express");

const financialController = require("../controllers/financialController");

const router = express.Router();

router.get("/overview", financialController.getOverview);
router.get("/accounting", financialController.getAccounting);
router.get("/analysis", financialController.getProductAnalysis);
router.get("/projections", financialController.getProjections);
router.post("/projections/apply", financialController.applyProjectionsModel);

module.exports = router;
