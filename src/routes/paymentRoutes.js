const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const paymentController = require("../controllers/paymentController");

router.post("/create-preference", authMiddleware, paymentController.createPreference);
router.get("/history", authMiddleware, paymentController.getPaymentHistory);

module.exports = router;
