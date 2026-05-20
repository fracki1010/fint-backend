const express = require("express");
const router = express.Router();
const complementController = require("../controllers/complementController");
const authMiddleware = require("../middlewares/authMiddleware");

// Catalog is available for any authenticated user
router.get("/catalog", authMiddleware, complementController.getCatalog);

module.exports = router;
