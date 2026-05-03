const express = require("express");
const router = express.Router();
const exportController = require("../controllers/exportController");

router.get("/sales", exportController.exportSales);
router.get("/product-analysis", exportController.exportProductAnalysis);
router.get("/accounting", exportController.exportAccounting);
router.get("/clients", exportController.exportClients);
router.get("/purchases", exportController.exportPurchases);

module.exports = router;