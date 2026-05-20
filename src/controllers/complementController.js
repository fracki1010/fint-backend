const SystemConfig = require("../models/systemConfig.model");
const { COMPLEMENTS, APP_BASE } = require("../config/complementConfig");
const { handleServerError } = require("../utils/http");

/**
 * Default descriptions (fallback cuando no hay override en BD)
 */
const DEFAULT_DESCRIPTIONS = {
  expansion:
    "Eliminá los límites de productos y ventas mensuales. Ideal para negocios en crecimiento que necesitan escalar sin restricciones.",
  team_10:
    "Agregá hasta 10 usuarios con roles diferenciados (admin, ventas, depósito, contabilidad). Perfecto para equipos en crecimiento.",
  team_unlimited:
    "Usuarios ilimitados con roles personalizables. Para empresas grandes con equipos distribuidos.",
  financiero:
    "Dashboard visual con KPIs de tesorería, comparación de ventas vs compras y alertas de variaciones anormales.",
  contabilidad:
    "Libros IVA automáticos (ventas y compras), exportación para contador y generación de asientos contables.",
  bom:
    "Definí productos compuestos por ingredientes. Cálculo automático de costos teóricos y explosión de materiales.",
  produccion:
    "Registrá órdenes de producción, consumo automático de stock de ingredientes y trazabilidad de lotes.",
  api:
    "Acceso programático completo a tu tenant. Documentación interactiva Swagger e integración con otros sistemas.",
  reportes:
    "Reportes personalizables por fecha, producto, vendedor y estado. Exportación a Excel y PDF.",
  listas_precios:
    "Hasta 5 listas de precios diferenciadas. Asignación automática por cliente (mayoristas, minoristas, etc.).",
  centros_costo:
    "Categorizá gastos por centro de costo, analizá rentabilidad por producto y visualizá distribución de costos.",
  conciliacion:
    "Match automático entre movimientos bancarios y registros internos. Importación de extractos bancarios.",
  whatsapp:
    "Conectá un número de WhatsApp y dejá que un agente con IA sea tu nuevo asistente personal. El asistente puede consultar stock, precios, tomar pedidos y responder preguntas frecuentes 24/7 sin intervención humana.",
};

const DESCRIPTIONS_LABELS = {
  expansion: "Expansión de Límites",
  team_10: "Team 10",
  team_unlimited: "Team ∞",
  financiero: "Panel Financiero",
  contabilidad: "Contabilidad",
  bom: "Lista de Materiales",
  produccion: "Módulo de Producción",
  api: "API Access",
  reportes: "Reportes Avanzados",
  listas_precios: "Múltiples Listas de Precios",
  centros_costo: "Centros de Costo",
  conciliacion: "Conciliación Bancaria",
  whatsapp: "Asistente por WhatsApp",
};

/**
 * @desc    Get complement catalog (prices, descriptions, names)
 * @route   GET /api/complements/catalog
 * @access  Public (authenticated)
 */
const getCatalog = async (req, res) => {
  try {
    const config = await SystemConfig.findOne({ key: "global" }).lean();
    const overrides = config?.complementPricing || {};
    const descOverrides = config?.complementDescriptions || {};
    const appBasePrice = config?.appBasePrice || APP_BASE.price;

    const complements = Object.entries(COMPLEMENTS).map(([id, comp]) => ({
      id,
      name: DESCRIPTIONS_LABELS[id] || comp.name,
      price: overrides[id] !== undefined ? overrides[id] : comp.price,
      description: descOverrides[id] || DEFAULT_DESCRIPTIONS[id] || "",
      features: comp.features || [],
    }));

    return res.json({
      success: true,
      appBasePrice,
      complements,
    });
  } catch (error) {
    return handleServerError(res, error, "Error al obtener catálogo");
  }
};

module.exports = { getCatalog };
