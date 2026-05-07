const express = require("express");
const router = express.Router();
const voucherController = require("../controllers/voucherController");
const validateRequest = require("../middlewares/validateRequest");
const { idParam } = require("../validators/schemas");
const { z } = require("zod");

// Validation schemas
const voucherTypesEnum = z.enum(["invoice", "delivery_note", "receipt"]);

const generateVouchersBody = z.object({
  types: z.array(voucherTypesEnum).min(1, "Debe incluir al menos un tipo"),
  generateOnCreate: z.boolean().optional(),
});

const createVoucherBody = z.object({
  orderId: z.string().regex(/^[0-9a-fA-F]{24}$/, "ID de orden inválido"),
  type: voucherTypesEnum,
});

const voidVoucherBody = z.object({
  reason: z.string().min(3, "El motivo debe tener al menos 3 caracteres"),
});

const listVouchersQuery = z.object({
  type: voucherTypesEnum.optional(),
  status: z.enum(["active", "voided"]).optional(),
  orderId: z.string().regex(/^[0-9a-fA-F]{24}$/, "ID inválido").optional(),
  clientName: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  page: z.coerce.number().positive().optional(),
  limit: z.coerce.number().positive().max(100).optional(),
});

// Routes
router.get(
  "/",
  validateRequest({ query: listVouchersQuery }),
  voucherController.listVouchers,
);

router.post(
  "/",
  validateRequest({ body: createVoucherBody }),
  voucherController.createVoucher,
);

router.get(
  "/next-number/:type",
  validateRequest({ params: z.object({ type: voucherTypesEnum }) }),
  voucherController.previewNextNumber,
);

router.get(
  "/:id",
  validateRequest({ params: idParam }),
  voucherController.getVoucherById,
);

router.get(
  "/:id/download",
  validateRequest({ params: idParam }),
  voucherController.downloadVoucher,
);

router.post(
  "/:id/void",
  validateRequest({ params: idParam, body: voidVoucherBody }),
  voucherController.voidVoucher,
);

module.exports = router;
