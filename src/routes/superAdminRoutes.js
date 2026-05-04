const express = require("express");
const router = express.Router();
const superAdminController = require("../controllers/superAdminController");
const { requireSuperAdmin } = require("../middlewares/superAdminMiddleware");

// All routes require SuperAdmin authentication
router.use(requireSuperAdmin);

// Tenant Management
router.get("/tenants", superAdminController.getAllTenants);
router.post("/tenants", superAdminController.createTenant);
router.get("/tenants/:id", superAdminController.getTenantById);
router.patch("/tenants/:id", superAdminController.updateTenant);
router.delete("/tenants/:id", superAdminController.suspendTenant);

// Analytics
router.get("/analytics", superAdminController.getAnalytics);

// Audit Logs
router.get("/audit", superAdminController.getAuditLogs);

module.exports = router;
