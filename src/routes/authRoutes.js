const express = require("express");

const authController = require("../controllers/authController");
const authMiddleware = require("../middlewares/authMiddleware");
const loginRateLimitMiddleware = require("../middlewares/loginRateLimitMiddleware");
const validateRequest = require("../middlewares/validateRequest");
const {
  loginBody,
  bootstrapBody,
  createUserBody,
} = require("../validators/schemas");

const router = express.Router();

router.post(
  "/bootstrap-superadmin",
  loginRateLimitMiddleware,
  validateRequest({ body: bootstrapBody }),
  authController.bootstrapSuperAdmin,
);
router.post(
  "/login",
  loginRateLimitMiddleware,
  validateRequest({ body: loginBody }),
  authController.login,
);
router.get("/me", authMiddleware, authController.me);
router.post(
  "/users",
  authMiddleware,
  validateRequest({ body: createUserBody }),
  authController.createUser,
);

module.exports = router;
