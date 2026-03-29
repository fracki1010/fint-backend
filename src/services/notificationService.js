const Notification = require("../models/notification.model");
const { publishToUser } = require("./notificationStreamService");

const createAndDispatchNotification = async ({
  userId,
  type = "info",
  title,
  message,
  metadata = null,
}) => {
  if (!userId || !title || !message) return null;

  const notification = await Notification.create({
    user: userId,
    type,
    title,
    message,
    metadata,
  });

  publishToUser(userId, {
    event: "notification:new",
    notification,
  });

  return notification;
};

module.exports = {
  createAndDispatchNotification,
};
