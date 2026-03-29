const express = require("express");
const router = express.Router();
const settingController = require("../controllers/settingController");
const validateRequest = require("../middlewares/validateRequest");
const { settingUpdateBody } = require("../validators/schemas");

router.get("/", settingController.getSettings);
router.put("/", validateRequest({ body: settingUpdateBody }), settingController.updateSettings);

module.exports = router;
