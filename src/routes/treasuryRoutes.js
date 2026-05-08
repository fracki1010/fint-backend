const express = require("express");
const treasuryController = require("../controllers/treasuryController");

const router = express.Router();

router.get("/overview", treasuryController.getOverview);
router.get("/cash-flow", treasuryController.getCashFlow);

module.exports = router;
