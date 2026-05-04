const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const tenantController = require("../controllers/tenantController");

router.get("/plan", authMiddleware, tenantController.getTenantPlan);
router.post("/change-plan", authMiddleware, tenantController.changePlan);

module.exports = router;
