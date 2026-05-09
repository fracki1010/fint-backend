const express = require("express");
const router = express.Router();
const { z } = require("zod");
const inventorySnapshotController = require("../controllers/inventorySnapshotController");
const validateRequest = require("../middlewares/validateRequest");
const { idParam } = require("../validators/schemas");

const listSnapshotsQuery = z.object({
  page: z.coerce.number().positive().optional(),
  limit: z.coerce.number().positive().max(50).optional(),
});

// POST /api/inventory-snapshots/trigger
router.post("/trigger", inventorySnapshotController.trigger);

// GET /api/inventory-snapshots
router.get(
  "/",
  validateRequest({ query: listSnapshotsQuery }),
  inventorySnapshotController.list,
);

// GET /api/inventory-snapshots/:id
router.get(
  "/:id",
  validateRequest({ params: idParam }),
  inventorySnapshotController.getById,
);

module.exports = router;
