const express = require("express");
const router = express.Router();
const { z } = require("zod");
const cashClosingController = require("../controllers/cashClosingController");
const validateRequest = require("../middlewares/validateRequest");
const { idParam } = require("../validators/schemas");

// Validation schemas
const openClosingBody = z.object({
  notes: z.string().optional(),
});

const closeClosingBody = z.object({
  actualAmounts: z.object({
    cash: z.coerce.number().min(0).default(0),
    card: z.coerce.number().min(0).default(0),
    transfer: z.coerce.number().min(0).default(0),
    check: z.coerce.number().min(0).default(0),
    other: z.coerce.number().min(0).default(0),
  }),
  notes: z.string().optional(),
});

const reopenClosingBody = z.object({
  reason: z.string().min(3, "El motivo debe tener al menos 3 caracteres"),
});

const listClosingsQuery = z.object({
  status: z.enum(["open", "closed", "reopened"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().positive().optional(),
  limit: z.coerce.number().positive().max(100).optional(),
});

// Routes
router.post(
  "/open",
  validateRequest({ body: openClosingBody }),
  cashClosingController.openClosing
);

router.post(
  "/:id/close",
  validateRequest({ params: idParam, body: closeClosingBody }),
  cashClosingController.closeClosing
);

router.post(
  "/:id/reopen",
  validateRequest({ params: idParam, body: reopenClosingBody }),
  cashClosingController.reopenClosing
);

router.get("/current", cashClosingController.getCurrentClosing);

router.get("/preview", cashClosingController.getOpenClosingPreview);

router.get(
  "/",
  validateRequest({ query: listClosingsQuery }),
  cashClosingController.listClosings
);

router.get(
  "/:id",
  validateRequest({ params: idParam }),
  cashClosingController.getClosingById
);

router.get(
  "/:id/report",
  validateRequest({ params: idParam }),
  cashClosingController.getZReport
);

module.exports = router;
