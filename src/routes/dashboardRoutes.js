const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");

router.get("/summary", dashboardController.getSummary);
router.get("/daily-sales", dashboardController.getDailySales);
router.get("/optional-kpis", dashboardController.getOptionalKpis);
router.post("/snapshots/capture", dashboardController.captureInventorySnapshot);

module.exports = router;
