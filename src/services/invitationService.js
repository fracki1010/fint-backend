const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const User = require("../models/user.model");
const UserInvitation = require("../models/userInvitation.model");

const INVITATION_TTL_MS = 48 * 60 * 60 * 1000;

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

const invalidError = () =>
  Object.assign(new Error("La invitación no es válida o ya venció."), { code: "INVALID_INVITATION" });

// Creates a new one-time link for a user and voids any earlier pending link of that user.
// Returns the raw token once; only its hash is stored.
const createInvitation = async ({ tenantId, userId, now = new Date() }) => {
  await UserInvitation.updateMany(
    { tenant: tenantId, user: userId, usedAt: null, expiresAt: { $gt: now } },
    { $set: { expiresAt: now } },
  );

  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + INVITATION_TTL_MS);
  await UserInvitation.create({
    tenant: tenantId,
    user: userId,
    tokenHash: hashToken(token),
    expiresAt,
  });

  return { token, expiresAt };
};

// Sets the invited user's password. The link works once and only before it expires.
const acceptInvitation = async ({ token, password, now = new Date() }) => {
  if (typeof token !== "string" || !token) throw invalidError();

  const invitation = await UserInvitation.findOne({
    tokenHash: hashToken(token),
    usedAt: null,
    expiresAt: { $gt: now },
  });
  if (!invitation) throw invalidError();

  const user = await User.findOne({ _id: invitation.user, tenant: invitation.tenant });
  if (!user || !user.isActive) throw invalidError();

  user.passwordHash = await bcrypt.hash(password, 10);
  await user.save();

  invitation.usedAt = now;
  await invitation.save();
  await UserInvitation.updateMany(
    { user: user._id, usedAt: null },
    { $set: { expiresAt: now } },
  );

  return { userId: user._id, email: user.email };
};

// The invited user cannot log in until they accept: their stored hash is random and unknown.
const unusablePasswordHash = async () => bcrypt.hash(crypto.randomBytes(32).toString("hex"), 10);

module.exports = {
  createInvitation,
  acceptInvitation,
  unusablePasswordHash,
  hashToken,
  INVITATION_TTL_MS,
};
