// A user with a location sees only that location. A user without one (the owner, admins)
// sees every location. Returns the location id to filter by, or null for "all".
// Throws FORBIDDEN_LOCATION when a restricted user asks for another location.
const resolveLocationScope = (user, requestedLocationId) => {
  const ownLocation = user?.location ? String(user.location) : null;
  const requested = requestedLocationId ? String(requestedLocationId) : null;

  if (!ownLocation) return requested;

  if (requested && requested !== ownLocation) {
    throw Object.assign(new Error("No tenés acceso a ese lugar."), { code: "FORBIDDEN_LOCATION" });
  }
  return ownLocation;
};

module.exports = { resolveLocationScope };
