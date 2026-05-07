const express = require("express");
const multer = require("multer");
const router = express.Router();
const validateRequest = require("../middlewares/validateRequest");
const bankAccountController = require("../controllers/bankAccountController");
const bankTransactionController = require("../controllers/bankTransactionController");
const reconciliationController = require("../controllers/reconciliationController");
const {
  idParam,
  createBankAccountBody,
  updateBankAccountBody,
  createBankTransactionBody,
  updateBankTransactionBody,
  bankTransactionQuery,
  matchTransactionBody,
  unmatchTransactionBody,
  confirmReconciliationBody,
  reconciliationQuery,
} = require("../validators/schemas");

// File upload configuration (CSV imports)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// ── Bank Account Routes ──

// GET /accounts — list all accounts for the tenant
router.get(
  "/accounts",
  bankAccountController.listAccounts,
);

// GET /accounts/:id — get a single account
router.get(
  "/accounts/:id",
  validateRequest({ params: idParam }),
  bankAccountController.getAccount,
);

// POST /accounts — create a new account
router.post(
  "/accounts",
  validateRequest({ body: createBankAccountBody }),
  bankAccountController.createAccount,
);

// PUT /accounts/:id — update an account
router.put(
  "/accounts/:id",
  validateRequest({ params: idParam, body: updateBankAccountBody }),
  bankAccountController.updateAccount,
);

// PATCH /accounts/:id/toggle — toggle isActive
router.patch(
  "/accounts/:id/toggle",
  validateRequest({ params: idParam }),
  bankAccountController.toggleAccountActive,
);

// ── Bank Transaction Routes ──

// GET /transactions — list transactions with filters
router.get(
  "/transactions",
  validateRequest({ query: bankTransactionQuery }),
  bankTransactionController.listTransactions,
);

// GET /transactions/:id — get a single transaction
router.get(
  "/transactions/:id",
  validateRequest({ params: idParam }),
  bankTransactionController.getTransaction,
);

// POST /transactions — create a manual transaction
router.post(
  "/transactions",
  validateRequest({ body: createBankTransactionBody }),
  bankTransactionController.createTransaction,
);

// PUT /transactions/:id — update a transaction
router.put(
  "/transactions/:id",
  validateRequest({ params: idParam, body: updateBankTransactionBody }),
  bankTransactionController.updateTransaction,
);

// ── CSV Import Routes ──

// POST /accounts/:id/import-preview — parse CSV, return preview (no insert)
router.post(
  "/accounts/:id/import-preview",
  validateRequest({ params: idParam }),
  upload.single("file"),
  bankTransactionController.previewCsv,
);

// POST /accounts/:id/import — parse CSV, bulk insert valid rows
router.post(
  "/accounts/:id/import",
  validateRequest({ params: idParam }),
  upload.single("file"),
  bankTransactionController.importCsv,
);

// ── Reconciliation Routes ──

// GET /accounts/:id/reconciliation — reconciliation data with candidates
router.get(
  "/accounts/:id/reconciliation",
  validateRequest({ params: idParam, query: reconciliationQuery }),
  reconciliationController.getReconciliationData,
);

// PUT /transactions/:id/match — match a transaction to an internal record
router.put(
  "/transactions/:id/match",
  validateRequest({ params: idParam, body: matchTransactionBody }),
  reconciliationController.matchTransaction,
);

// PUT /transactions/:id/unmatch — unmatch a reconciled transaction
router.put(
  "/transactions/:id/unmatch",
  validateRequest({ params: idParam, body: unmatchTransactionBody }),
  reconciliationController.unmatchTransaction,
);

// POST /accounts/:id/confirm-reconciliation — confirm reconciliation period
router.post(
  "/accounts/:id/confirm-reconciliation",
  validateRequest({ params: idParam, body: confirmReconciliationBody }),
  reconciliationController.confirmReconciliation,
);

module.exports = router;
