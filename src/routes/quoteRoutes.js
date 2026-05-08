const express = require("express");
const router = express.Router();
const quoteController = require("../controllers/quoteController");
const validateRequest = require("../middlewares/validateRequest");
const {
  idParam,
  createQuoteBody,
  updateQuoteBody,
} = require("../validators/schemas");

router.get("/", quoteController.listQuotes);
router.get("/:id", validateRequest({ params: idParam }), quoteController.getQuote);
router.post("/", validateRequest({ body: createQuoteBody }), quoteController.createQuote);
router.put(
  "/:id",
  validateRequest({ params: idParam, body: updateQuoteBody }),
  quoteController.updateQuote,
);
router.delete("/:id", validateRequest({ params: idParam }), quoteController.deleteQuote);
router.post("/:id/send", validateRequest({ params: idParam }), quoteController.sendQuote);
router.post("/:id/accept", validateRequest({ params: idParam }), quoteController.acceptQuote);
router.post("/:id/reject", validateRequest({ params: idParam }), quoteController.rejectQuote);
router.post("/:id/convert", validateRequest({ params: idParam }), quoteController.convertToOrder);

module.exports = router;
