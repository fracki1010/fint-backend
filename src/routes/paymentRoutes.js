const express = require("express");
const router = express.Router();
const paymentController = require("../controllers/paymentController");

router.post("/create-preference", paymentController.createPreference);
router.get("/history", paymentController.getPaymentHistory);

module.exports = router;
