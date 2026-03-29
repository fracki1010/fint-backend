const express = require("express");

const router = express.Router();
const whatsappController = require("../controllers/whatsappController");

router.get("/status", whatsappController.getStatus);
router.post("/start", whatsappController.start);
router.post("/stop", whatsappController.stop);
router.post("/restart", whatsappController.restart);

module.exports = router;
