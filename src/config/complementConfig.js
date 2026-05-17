const COMPLEMENTS = {
  expansion: {
    id: "expansion",
    name: "Expansión de Límites",
    price: 100,
    features: ["unlimited_products", "unlimited_orders"],
    limits: { maxProducts: -1, maxOrdersPerMonth: -1 },
  },
  team_10: {
    id: "team_10",
    name: "Team 10",
    price: 100,
    features: ["team_management"],
    limits: { maxUsers: 10 },
  },
  team_unlimited: {
    id: "team_unlimited",
    name: "Team ∞",
    price: 200,
    features: ["team_management"],
    limits: { maxUsers: -1 },
  },
  financiero: {
    id: "financiero",
    name: "Panel Financiero",
    price: 50,
    features: ["financial_center"],
  },
  contabilidad: {
    id: "contabilidad",
    name: "Contabilidad",
    price: 50,
    features: ["advanced_reports"],
  },
  bom: {
    id: "bom",
    name: "Lista de Materiales",
    price: 50,
    features: ["bill_of_materials"],
  },
  produccion: {
    id: "produccion",
    name: "Módulo de Producción",
    price: 50,
    features: ["recipes"],
  },
  api: {
    id: "api",
    name: "API Access",
    price: 100,
    features: ["api_access"],
  },
  reportes: {
    id: "reportes",
    name: "Reportes Avanzados",
    price: 50,
    features: ["advanced_reports"],
  },
  listas_precios: {
    id: "listas_precios",
    name: "Múltiples Listas de Precios",
    price: 50,
    features: ["multi_location"],
  },
  centros_costo: {
    id: "centros_costo",
    name: "Centros de Costo",
    price: 50,
    features: [],
  },
  conciliacion: {
    id: "conciliacion",
    name: "Conciliación Bancaria",
    price: 50,
    features: ["banking"],
  },
};

const APP_BASE = {
  price: 200,
  features: [
    "client_account",
    "supplier_account",
    "quotes",
    "banking",
  ],
  limits: {
    maxUsers: 1,
    maxProducts: 200,
    maxOrdersPerMonth: 500,
  },
};

/**
 * Derive enabled features from app base + active complements.
 * @param {string[]} complements - Array of complement IDs
 * @returns {string[]} Deduped feature list
 */
function deriveEnabledFeatures(complements = []) {
  const set = new Set(APP_BASE.features);
  for (const compId of complements) {
    const comp = COMPLEMENTS[compId];
    if (comp && comp.features) {
      for (const f of comp.features) set.add(f);
    }
  }
  return [...set];
}

/**
 * Derive limits from app base + active complements.
 * Later complements override earlier ones.
 * @param {string[]} complements - Array of complement IDs
 * @returns {Object} Merged limits
 */
function deriveLimits(complements = []) {
  const limits = { ...APP_BASE.limits };
  for (const compId of complements) {
    const comp = COMPLEMENTS[compId];
    if (comp && comp.limits) {
      Object.assign(limits, comp.limits);
    }
  }
  return limits;
}

/**
 * Compute total monthly price from app base + active complements.
 * @param {string[]} complements - Array of complement IDs
 * @returns {number} Total price in cents
 */
function computeTotalPrice(complements = []) {
  let total = APP_BASE.price;
  for (const compId of complements) {
    const comp = COMPLEMENTS[compId];
    if (comp && comp.price) {
      total += comp.price;
    }
  }
  return total;
}

module.exports = {
  COMPLEMENTS,
  APP_BASE,
  deriveEnabledFeatures,
  deriveLimits,
  computeTotalPrice,
};
