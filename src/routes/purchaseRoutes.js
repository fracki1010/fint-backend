const express = require("express");

const purchaseController = require("../controllers/purchaseController");
const validateRequest = require("../middlewares/validateRequest");
const {
  idParam,
  createPurchaseBody,
} = require("../validators/schemas");

const router = express.Router();

router.get("/", purchaseController.getPurchases);
router.get("/:id", validateRequest({ params: idParam }), purchaseController.getPurchaseById);
router.post("/", validateRequest({ body: createPurchaseBody }), purchaseController.createPurchase);
router.post("/:id/confirm", validateRequest({ params: idParam }), purchaseController.confirmPurchase);
router.post("/:id/receive", validateRequest({ params: idParam }), purchaseController.receivePurchase);
router.post("/:id/cancel", validateRequest({ params: idParam }), purchaseController.cancelPurchase);

module.exports = router;
