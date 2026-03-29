const Notification = require("../models/notification.model");
const authMiddleware = require("../middlewares/authMiddleware");
const {
  subscribe,
  unsubscribe,
} = require("../services/notificationStreamService");
const { sendError, handleServerError } = require("../utils/http");

exports.getNotifications = async (req, res) => {
  try {
    const notifications = await Notification.find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(50);

    const unreadCount = await Notification.countDocuments({
      user: req.user._id,
      isRead: false,
    });

    res.json({
      notifications,
      unreadCount,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener notificaciones");
  }
};

exports.markNotificationAsRead = async (req, res) => {
  try {
    const notification = await Notification.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      { isRead: true, readAt: new Date() },
      { returnDocument: "after" },
    );

    if (!notification) {
      return sendError(res, {
        status: 404,
        code: "NOTIFICATION_NOT_FOUND",
        message: "Notificacion no encontrada",
      });
    }

    return res.json(notification);
  } catch (error) {
    return handleServerError(res, error, "Error al actualizar notificacion");
  }
};

exports.markAllAsRead = async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true, readAt: new Date() },
    );

    return res.json({ ok: true });
  } catch (error) {
    return handleServerError(
      res,
      error,
      "Error al marcar notificaciones como leidas",
    );
  }
};

exports.streamNotifications = async (req, res) => {
  try {
    const queryToken = req.query.token?.toString() || "";
    const headerToken = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : null;
    const token = queryToken || headerToken || null;

    const user = await authMiddleware.resolveUserByToken(token);
    if (!user) {
      return sendError(res, {
        status: 401,
        code: "UNAUTHENTICATED",
        message: "No autenticado para stream",
      });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    res.write(`data: ${JSON.stringify({ event: "stream:ready" })}\n\n`);
    subscribe(user._id, res);

    const heartbeat = setInterval(() => {
      res.write(`data: ${JSON.stringify({ event: "stream:ping" })}\n\n`);
    }, 20000);

    req.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe(user._id, res);
      res.end();
    });
  } catch (error) {
    return handleServerError(res, error, "Error en stream de notificaciones");
  }
};
