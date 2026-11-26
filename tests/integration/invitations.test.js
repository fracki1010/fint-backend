/**
 * @fileoverview One-time invitation links: create, accept once, expire, replace older links,
 * and never store the raw token. Runs against a real MongoDB.
 */

const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const { MongoMemoryServer } = require("mongodb-memory-server");

const User = require("../../src/models/user.model");
const UserInvitation = require("../../src/models/userInvitation.model");
const {
  createInvitation,
  acceptInvitation,
  unusablePasswordHash,
  INVITATION_TTL_MS,
} = require("../../src/services/invitationService");

let mongoServer;
const tenant = new mongoose.Types.ObjectId();
let member;

const createMember = () =>
  User.create({
    tenant,
    fullName: "Socio Norte",
    email: `socio-${Date.now()}-${Math.random()}@test.local`,
    passwordHash: "placeholder",
    role: "ventas",
    isSuperAdmin: false,
  });

describe("user invitations", () => {
  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all([User.deleteMany({}), UserInvitation.deleteMany({})]);
    member = await createMember();
    member.passwordHash = await unusablePasswordHash();
    await member.save();
  });

  it("lets the invited user set a password that then works for login", async () => {
    const { token } = await createInvitation({ tenantId: tenant, userId: member._id });

    await acceptInvitation({ token, password: "claveNueva1" });

    const saved = await User.findById(member._id).lean();
    expect(await bcrypt.compare("claveNueva1", saved.passwordHash)).toBe(true);
  });

  it("works only once", async () => {
    const { token } = await createInvitation({ tenantId: tenant, userId: member._id });
    await acceptInvitation({ token, password: "claveNueva1" });

    await expect(acceptInvitation({ token, password: "otraClave22" })).rejects.toMatchObject({
      code: "INVALID_INVITATION",
    });
  });

  it("refuses a link after it expires", async () => {
    const issuedAt = new Date("2026-11-01T00:00:00Z");
    const { token, expiresAt } = await createInvitation({
      tenantId: tenant,
      userId: member._id,
      now: issuedAt,
    });
    expect(expiresAt.getTime() - issuedAt.getTime()).toBe(INVITATION_TTL_MS);

    const afterExpiry = new Date(expiresAt.getTime() + 1000);
    await expect(
      acceptInvitation({ token, password: "claveNueva1", now: afterExpiry }),
    ).rejects.toMatchObject({ code: "INVALID_INVITATION" });
  });

  it("voids the older link when a new one is issued", async () => {
    const first = await createInvitation({ tenantId: tenant, userId: member._id });
    const second = await createInvitation({ tenantId: tenant, userId: member._id });

    await expect(acceptInvitation({ token: first.token, password: "claveNueva1" })).rejects.toMatchObject({
      code: "INVALID_INVITATION",
    });
    await expect(acceptInvitation({ token: second.token, password: "claveNueva1" })).resolves.toBeTruthy();
  });

  it("rejects a wrong token", async () => {
    await createInvitation({ tenantId: tenant, userId: member._id });

    await expect(acceptInvitation({ token: "no-existe", password: "claveNueva1" })).rejects.toMatchObject({
      code: "INVALID_INVITATION",
    });
  });

  it("stores only the hash of the token, never the token itself", async () => {
    const { token } = await createInvitation({ tenantId: tenant, userId: member._id });

    const stored = await UserInvitation.findOne({ user: member._id }).lean();
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored.tokenHash).toHaveLength(64);
  });
});
