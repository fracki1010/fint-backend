const express = require("express");
const router = express.Router();
const authMiddleware = require("../middlewares/authMiddleware");
const { requireSuperAdmin } = require("../middlewares/superAdminMiddleware");
const tenantController = require("../controllers/tenantController");

router.get("/plan", authMiddleware, tenantController.getTenantPlan);
// Plan changes are a platform decision: tenant owners must not grant themselves paid complements.
router.post(
  "/activate-complements",
  authMiddleware,
  requireSuperAdmin,
  tenantController.activateComplements,
);

module.exports = router;
