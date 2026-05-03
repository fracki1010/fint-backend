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

module.exports = router;
