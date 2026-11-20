const { parseLocaleNumber } = require("./inventoryAnalyticsService");

// Pure helpers for the WhatsApp order wizard. They read the user's answer and map the
// collected answers to order fields; they never touch the database.

const normalize = (text = "") =>
  text
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

const METHOD_LABELS = {
  cash: "Efectivo",
  transfer: "Transferencia",
  card: "Tarjeta",
  mercadopago: "Mercado Pago",
  other: "Otro",
};

const QUESTIONS = {
  PAYMENT_STATUS: "¿Cómo queda el pago?\n1) Pagado\n2) Pagado en parte\n3) Pendiente de pago",
  PAID_AMOUNT: "¿Cuánto pagó ahora? (solo el monto)",
  PAYMENT_METHOD:
    "¿Con qué medio pagó?\n1) Efectivo\n2) Transferencia\n3) Tarjeta\n4) Mercado Pago\n5) Otro",
  DELIVERY: "¿Ya lo entregaste?\n1) Sí, entregado\n2) Pendiente de entrega",
  INVOICE: "¿Querés que te mande la factura en PDF? (Sí/No)",
};

const parsePaymentStatus = (text) => {
  const t = normalize(text);
  if (t === "1") return "paid";
  if (t === "2") return "partial";
  if (t === "3") return "pending";
  // Pending is checked before paid so "pendiente de pago" is not read as paid.
  if (/parcial|a cuenta|adelanto|\bsena\b/.test(t)) return "partial";
  if (/pendiente|debe|fiad|cuenta corriente|no pag/.test(t)) return "pending";
  if (/pagad|pago|ya pag|cobrad|^si\b/.test(t)) return "paid";
  return null;
};

const parsePaymentMethod = (text) => {
  const t = normalize(text);
  if (t === "1") return "cash";
  if (t === "2") return "transfer";
  if (t === "3") return "card";
  if (t === "4") return "mercadopago";
  if (t === "5") return "other";
  if (/efectivo|cash|plata|billete/.test(t)) return "cash";
  if (/transfer|transf|cbu|alias|banco/.test(t)) return "transfer";
  if (/tarjeta|debito|credito|visa|master|card/.test(t)) return "card";
  if (/mercado ?pago|\bmp\b/.test(t)) return "mercadopago";
  if (/otro/.test(t)) return "other";
  return null;
};

const parseDelivery = (text) => {
  const t = normalize(text);
  if (t === "1") return true;
  if (t === "2") return false;
  if (/pendiente|despues|mas tarde|envi|domicilio|manana/.test(t)) return false;
  if (/entreg|\bya\b|ahora|lleva|retir|hoy|listo/.test(t)) return true;
  return null;
};

const parseYesNo = (text) => {
  const t = normalize(text);
  if (/^(si|s|dale|ok|claro|obvio|1)$/.test(t)) return true;
  if (/^(no|n|2)$/.test(t)) return false;
  return null;
};

// Returns the amount, or null when it is not a positive number below the order total.
const parsePaidAmount = (text, total) => {
  const match = normalize(text).match(/\d[\d.,]*/);
  if (!match) return null;
  const value = parseLocaleNumber(match[0]);
  if (!(value > 0 && value < total)) return null;
  return Math.round(value * 100) / 100;
};

// payment: { status: "paid"|"partial"|"pending", method, paidAmount }
const buildOrderStatusFields = ({ payment, total, delivered, now = new Date() }) => {
  const isDelivered = delivered === true;
  const base = {
    status: isDelivered ? "Entregado" : "Confirmada",
    salesStatus: "Confirmada",
    confirmedAt: now,
    deliveryStatus: isDelivered ? "Entregada" : "Pendiente",
    deliveredAt: isDelivered ? now : null,
  };

  if (payment.status === "pending") {
    return {
      ...base,
      paymentStatus: "Pendiente",
      paymentMethod: "",
      paymentSplits: [],
      paidAt: null,
    };
  }

  const paidAmount = payment.status === "paid" ? total : payment.paidAmount;
  return {
    ...base,
    paymentStatus: payment.status === "paid" ? "Pagado" : "Parcial",
    paymentMethod: payment.method,
    paymentSplits: [{ method: payment.method, amount: paidAmount }],
    paidAt: now,
  };
};

const money = (value) => `$${Number(value || 0).toFixed(2)}`;

const describePayment = (payment, total) => {
  if (payment.status === "pending") return "Pago: pendiente (cuenta corriente)";
  const label = METHOD_LABELS[payment.method] || payment.method;
  if (payment.status === "partial") {
    return `Pago: parcial, ${money(payment.paidAmount)} en ${label}, resto ${money(total - payment.paidAmount)} pendiente`;
  }
  return `Pago: completo en ${label}`;
};

// Lines appended to the order summary so the user sees every answer before confirming.
const describeWizardAnswers = ({ payment, delivered, invoice, total }) => [
  describePayment(payment, total),
  `Entrega: ${delivered ? "entregado ahora" : "pendiente de entrega"}`,
  `Factura: ${invoice ? "sí, PDF por WhatsApp" : "no"}`,
];

module.exports = {
  QUESTIONS,
  parsePaymentStatus,
  parsePaymentMethod,
  parseDelivery,
  parseYesNo,
  parsePaidAmount,
  buildOrderStatusFields,
  describeWizardAnswers,
  METHOD_LABELS,
};
