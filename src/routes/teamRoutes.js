const express = require("express");

const teamController = require("../controllers/teamController");
const { requireRole } = require("../middlewares/roleMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const { idParam } = require("../validators/schemas");

const router = express.Router();

router.get("/", teamController.getTeam);
router.post("/", requireRole("admin"), teamController.createTeamMember);
router.patch("/:id", validateRequest({ params: idParam }), requireRole("admin"), teamController.updateTeamMember);
router.delete("/:id", validateRequest({ params: idParam }), requireRole("admin"), teamController.deleteTeamMember);

module.exports = router;
