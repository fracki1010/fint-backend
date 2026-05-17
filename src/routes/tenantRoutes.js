const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const tenantController = require("../controllers/tenantController");

router.get("/plan", authMiddleware, tenantController.getTenantPlan);
router.post("/activate-complements", authMiddleware, tenantController.activateComplements);

module.exports = router;
