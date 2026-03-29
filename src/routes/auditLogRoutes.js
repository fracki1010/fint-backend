const express = require("express");

const auditLogController = require("../controllers/auditLogController");
const validateRequest = require("../middlewares/validateRequest");
const { auditQuerySchema } = require("../validators/schemas");

const router = express.Router();

router.get("/", validateRequest({ query: auditQuerySchema }), auditLogController.getAuditLogs);

module.exports = router;
