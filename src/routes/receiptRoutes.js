const express = require("express");
const router = express.Router({ mergeParams: true });
const receiptController = require("../controllers/receiptController");
const validateRequest = require("../middlewares/validateRequest");
const { createReceiptBody } = require("../validators/schemas");

// POST /api/purchases/:purchaseId/receipts
router.post(
  "/",
  validateRequest({ body: createReceiptBody }),
  receiptController.createReceipt,
);

// GET /api/purchases/:purchaseId/receipts
router.get("/", receiptController.getReceipts);

module.exports = router;
