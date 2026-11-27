/**
 * @fileoverview Team members keep the role they are given. A role missing from the controller's
 * list is silently replaced by "lectura", so the list must cover every role the user model allows.
 */

const { VALID_ROLES } = require("../../../src/controllers/teamController");
const User = require("../../../src/models/user.model");

describe("team roles", () => {
  it("accepts every role the user model allows, including sucursal", () => {
    const modelRoles = User.schema.path("role").enumValues;
    expect(VALID_ROLES.sort()).toEqual([...modelRoles].sort());
    expect(VALID_ROLES).toContain("sucursal");
  });
});
