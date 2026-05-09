const express = require("express");

const reportController = require("../controllers/reportController");
const validateRequest = require("../middlewares/validateRequest");
const { ivaReportQuery } = require("../validators/schemas");

const router = express.Router();

router.get(
  "/iva-purchases",
  validateRequest({ query: ivaReportQuery }),
  reportController.getIvaPurchases,
);

router.get(
  "/iva-sales",
  validateRequest({ query: ivaReportQuery }),
  reportController.getIvaSales,
);

module.exports = router;
