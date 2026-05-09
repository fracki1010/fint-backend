const express = require("express");

const supplierAccountController = require("../controllers/supplierAccountController");
const supplierController = require("../controllers/supplierController");
const validateRequest = require("../middlewares/validateRequest");
const {
  idParam,
  supplierStatementQuery,
  supplierPaymentBody,
  supplierAccountEntryBody,
  supplierAllocateBody,
} = require("../validators/schemas");

const router = express.Router();

// ── Supplier CRUD ──────────────────────────────────────────────────────
router.get("/", supplierController.getSuppliers);
router.post("/", supplierController.createSupplier);
router.get("/:id", validateRequest({ params: idParam }), supplierController.getSupplierById);
router.patch("/:id", validateRequest({ params: idParam }), supplierController.updateSupplier);
router.delete("/:id", validateRequest({ params: idParam }), supplierController.deleteSupplier);

// ── Supplier Account ───────────────────────────────────────────────────
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
router.post(
  "/:id/account/allocate",
  validateRequest({ params: idParam, body: supplierAllocateBody }),
  supplierAccountController.allocatePayment,
);

module.exports = router;
