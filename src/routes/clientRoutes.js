const express = require("express");
const router = express.Router();
const clientController = require("../controllers/clientController");
const validateRequest = require("../middlewares/validateRequest");
const {
  idParam,
  createClientBody,
  updateClientBody,
  includeInactiveQuery,
} = require("../validators/schemas");

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

module.exports = router;
