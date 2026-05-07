const express = require("express");
const router = express.Router();
const clientController = require("../controllers/clientController");
const clientAccountController = require("../controllers/clientAccountController");
const validateRequest = require("../middlewares/validateRequest");
const {
  idParam,
  createClientBody,
  updateClientBody,
  includeInactiveQuery,
} = require("../validators/schemas");

router.get("/generic", clientController.getOrCreateGenericClient);
router.get("/", validateRequest({ query: includeInactiveQuery }), clientController.getClients);
router.get(
  "/:id",
  validateRequest({ params: idParam, query: includeInactiveQuery }),
  clientController.getClientById,
);
router.post("/", validateRequest({ body: createClientBody }), clientController.createClient);
router.put(
  "/:id",
  validateRequest({ params: idParam, body: updateClientBody }),
  clientController.updateClient,
);
router.delete("/:id", validateRequest({ params: idParam }), clientController.deleteClient);

// ── Client Account ─────────────────────────────────────────────────────
router.get("/:id/account", validateRequest({ params: idParam }), clientAccountController.getClientAccount);
router.post("/:id/account/payment", validateRequest({ params: idParam }), clientAccountController.createPayment);
router.post("/:id/account/entry", validateRequest({ params: idParam }), clientAccountController.createEntry);
router.get("/:id/account/statement", validateRequest({ params: idParam }), clientAccountController.getClientStatement);

// ── Payment Allocation (PR 1: Core Reconciliation) ──────────────────────
router.post("/:id/account/allocate", validateRequest({ params: idParam }), clientAccountController.allocatePayment);
router.get("/:id/account/balance", validateRequest({ params: idParam }), clientAccountController.getClientBalance);
router.get("/:id/account/pending-charges", validateRequest({ params: idParam }), clientAccountController.getPendingCharges);

// ── Aging & Credit (PR 2: Aging & Reporting) ─────────────────────────────
router.get("/:id/account/aging", validateRequest({ params: idParam }), clientAccountController.getClientAging);
router.get("/:id/account/credit-status", validateRequest({ params: idParam }), clientAccountController.getClientCreditStatus);
router.get("/account/aging-report", clientAccountController.getAllClientsAging);

module.exports = router;
