const express = require("express");
const router = express.Router();
const dashboardController = require("../controllers/dashboardController");

router.get("/summary", dashboardController.getSummary);
router.get("/daily-sales", dashboardController.getDailySales);
router.get("/optional-kpis", dashboardController.getOptionalKpis);
router.post("/snapshots/capture", dashboardController.captureInventorySnapshot);

// ── Receivables Analytics (PR 2: Aging & Reporting) ──────────────────────
router.get("/receivables", dashboardController.getReceivables);

module.exports = router;
