const express = require("express");

const supplierAccountController = require("../controllers/supplierAccountController");
const validateRequest = require("../middlewares/validateRequest");
const {
  idParam,
  supplierStatementQuery,
  supplierPaymentBody,
  supplierAccountEntryBody,
} = require("../validators/schemas");

const router = express.Router();

router.get(
  "/:id/account",
  validateRequest({ params: idParam }),
  supplierAccountController.getSupplierAccount,
);
router.post(
  "/:id/account/payment",
  validateRequest({ params: idParam, body: supplierPaymentBody }),
  supplierAccountController.createPayment,
);
router.post(
  "/:id/account/entry",
  validateRequest({ params: idParam, body: supplierAccountEntryBody }),
  supplierAccountController.createEntry,
);
router.get(
  "/:id/account/statement",
  validateRequest({ params: idParam, query: supplierStatementQuery }),
  supplierAccountController.getSupplierStatement,
);

module.exports = router;
