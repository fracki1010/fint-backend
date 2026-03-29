const express = require("express");

const authMiddleware = require("../middlewares/authMiddleware");
const notificationController = require("../controllers/notificationController");
const validateRequest = require("../middlewares/validateRequest");
const { notificationIdParam } = require("../validators/schemas");

const router = express.Router();

router.get("/stream", notificationController.streamNotifications);
router.get("/", authMiddleware, notificationController.getNotifications);
router.patch(
  "/:id/read",
  authMiddleware,
  validateRequest({ params: notificationIdParam }),
  notificationController.markNotificationAsRead,
);
router.patch("/read-all", authMiddleware, notificationController.markAllAsRead);

module.exports = router;
