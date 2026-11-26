const express = require("express");

const locationController = require("../controllers/locationController");
const { requireRole } = require("../middlewares/roleMiddleware");

const router = express.Router();

// Restricted users see only their own location; the owner sees all of them.
router.get("/", locationController.listLocations);
router.post("/", requireRole("admin"), locationController.createLocation);
router.get("/:id/stock", locationController.getLocationStock);
router.post("/transfers", requireRole("admin"), locationController.transfer);

module.exports = router;
