const Papa = require("papaparse");
const mongoose = require("mongoose");
const BankTransaction = require("../models/bankTransaction.model");
const { HttpError } = require("../utils/http");

// ── Bank Detection Patterns ──

const BANK_PATTERNS = {
  BBVA: {
    keywords: ["FECHA VALOR", "FECHA OPERACIÓN", "CONCEPTO", "IMPORTE"],
    columns: {
      date: ["FECHA VALOR", "FECHA OPERACIÓN"],
      description: "CONCEPTO",
      amount: "IMPORTE",
    },
    amountMode: "single", // positive = credit, negative = debit
  },
  Galicia: {
    keywords: ["Fecha", "Descripción", "Referencia", "Debe", "Haber"],
    columns: {
      date: "Fecha",
      description: "Descripción",
      reference: "Referencia",
      debit: "Debe",
      credit: "Haber",
    },
    amountMode: "debit_credit",
  },
  Santander: {
    keywords: ["FECHA", "DETALLE", "IMPORTE", "SALDO"],
    columns: {
      date: "FECHA",
      description: "DETALLE",
      amount: "IMPORTE",
    },
    amountMode: "single",
  },
  Nación: {
    keywords: ["Fecha", "Concepto", "NroComprobante", "Debe", "Haber"],
    columns: {
      date: "Fecha",
      description: "Concepto",
      reference: "NroComprobante",
      debit: "Debe",
      credit: "Haber",
    },
    amountMode: "debit_credit",
  },
};

// ── Generic / Fallback Column Names ──

const GENERIC_DATE_NAMES = [
  "fecha",
  "fecha valor",
  "fecha operación",
  "fecha operacion",
  "date",
  "f. emisión",
  "f. emision",
];
const GENERIC_DESC_NAMES = [
  "concepto",
  "descripción",
  "descripcion",
  "detalle",
  "detail",
  "descripcion del movimiento",
];
const GENERIC_AMOUNT_NAMES = [
  "importe",
  "monto",
  "total",
  "amount",
  "monto $",
  "importe \$",
];
const GENERIC_REF_NAMES = [
  "referencia",
  "nrocomprobante",
  "nro comprobante",
  "comprobante",
  "reference",
  "nro.",
];
const GENERIC_DEBIT_NAMES = ["debe", "debito", "débito", "debit"];
const GENERIC_CREDIT_NAMES = ["haber", "credito", "crédito", "credit"];

// ── Helpers ──

/**
 * Detect bank from CSV header row by matching known keywords.
 * Returns the bank key (BBVA, Galicia, Santander, Nación) or null.
 */
function detectBank(headers) {
  if (!headers || headers.length === 0) return null;

  const upperHeaders = headers.map((h) => h.trim().toUpperCase());

  for (const [bank, pattern] of Object.entries(BANK_PATTERNS)) {
    const keywordUpper = pattern.keywords.map((k) => k.toUpperCase());
    const matchCount = keywordUpper.filter((kw) =>
      upperHeaders.some((h) => h.includes(kw)),
    ).length;
    // 60% threshold: at least ceil(keywords.length * 0.6) match
    if (matchCount >= Math.ceil(pattern.keywords.length * 0.6)) {
      return bank;
    }
  }

  return null;
}

/**
 * Build a column-map for unknown banks by fuzzy-matching against generic names.
 */
function buildGenericColumnMap(headers) {
  const upperToOriginal = {};
  headers.forEach((h) => {
    upperToOriginal[h.trim().toUpperCase()] = h.trim();
  });

  const upperHeaders = Object.keys(upperToOriginal);
  const map = {};

  // Date
  for (const name of GENERIC_DATE_NAMES) {
    const found = upperHeaders.find((h) => h.includes(name.toUpperCase()));
    if (found) {
      map.date = upperToOriginal[found];
      break;
    }
  }

  // Description
  for (const name of GENERIC_DESC_NAMES) {
    const found = upperHeaders.find((h) => h.includes(name.toUpperCase()));
    if (found) {
      map.description = upperToOriginal[found];
      break;
    }
  }

  // Amount (single)
  for (const name of GENERIC_AMOUNT_NAMES) {
    const found = upperHeaders.find((h) => h.includes(name.toUpperCase()));
    if (found) {
      map.amount = upperToOriginal[found];
      break;
    }
  }

  // Debit
  for (const name of GENERIC_DEBIT_NAMES) {
    const found = upperHeaders.find((h) => h.includes(name.toUpperCase()));
    if (found) {
      map.debit = upperToOriginal[found];
      break;
    }
  }

  // Credit
  for (const name of GENERIC_CREDIT_NAMES) {
    const found = upperHeaders.find((h) => h.includes(name.toUpperCase()));
    if (found) {
      map.credit = upperToOriginal[found];
      break;
    }
  }

  // Reference
  for (const name of GENERIC_REF_NAMES) {
    const found = upperHeaders.find((h) => h.includes(name.toUpperCase()));
    if (found) {
      map.reference = upperToOriginal[found];
      break;
    }
  }

  return map;
}

/**
 * Normalize a date string to YYYY-MM-DD.
 * Supports DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, YYYY/MM/DD.
 */
function normalizeDate(value) {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) {
    const d = dmy[1].padStart(2, "0");
    const m = dmy[2].padStart(2, "0");
    return `${dmy[3]}-${m}-${d}`;
  }

  // YYYY-MM-DD or YYYY/MM/DD
  const ymd = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (ymd) {
    return `${ymd[1]}-${ymd[2].padStart(2, "0")}-${ymd[3].padStart(2, "0")}`;
  }

  // Try parsing as ISO date
  const ts = Date.parse(str);
  if (!isNaN(ts)) {
    const d = new Date(ts);
    return d.toISOString().split("T")[0];
  }

  return null;
}

/**
 * Parse a numeric value from a CSV cell.
 * Handles: "$ 1.500,50", "1500.50", "1,500.50", etc.
 */
function parseAmount(value) {
  if (value === undefined || value === null || value === "") return NaN;

  let str = String(value).trim();

  // Remove currency symbols and common suffixes
  str = str.replace(/[$\$€]/g, "").trim();

  // Detect format: European (1.500,50) vs US (1,500.50)
  const hasCommaAsDecimal = /,\d{2}$/.test(str);
  const hasDotAsDecimal = /\.\d{2}$/.test(str);
  const hasComma = str.includes(",");
  const hasDot = str.includes(".");

  if (hasCommaAsDecimal && hasDot) {
    // European: dots are thousands separators, comma is decimal
    str = str.replace(/\./g, "").replace(",", ".");
  } else if (hasDotAsDecimal && hasComma) {
    // US: commas are thousands separators, dot is decimal
    str = str.replace(/,/g, "");
  } else if (hasComma && !hasDot) {
    // Only comma — treat as decimal separator
    str = str.replace(",", ".");
  }
  // If only dot, treat as decimal separator (already correct for parseFloat)

  // Remove any remaining non-numeric chars (except - and .)
  str = str.replace(/[^\d.\-]/g, "");

  const parsed = parseFloat(str);
  return Number.isFinite(parsed) ? parsed : NaN;
}

/**
 * Parse a row into standard format based on the detected bank.
 */
function parseRow(row, bank, columnMap, index) {
  const errors = [];
  const isDebitCredit =
    BANK_PATTERNS[bank]?.amountMode === "debit_credit" ||
    (bank === null && columnMap.debit && columnMap.credit);

  let date = null;
  let description = null;
  let amount = NaN;
  let type = null;
  let reference = null;

  // ── Date ──
  const dateCol = columnMap.date;
  if (dateCol) {
    date = normalizeDate(row[dateCol]);
  }
  if (!date) {
    // Try all known date columns as fallback
    for (const col of Object.keys(row)) {
      const n = normalizeDate(row[col]);
      if (n) {
        date = n;
        break;
      }
    }
  }
  if (!date) {
    errors.push("Fecha inválida o no encontrada");
  }

  // ── Amount & Type ──
  if (isDebitCredit) {
    const debitVal = parseAmount(row[columnMap.debit]);
    const creditVal = parseAmount(row[columnMap.credit]);

    if (!isNaN(debitVal) && debitVal > 0) {
      amount = debitVal;
      type = "debit";
    } else if (!isNaN(creditVal) && creditVal > 0) {
      amount = creditVal;
      type = "credit";
    } else {
      errors.push("No se pudo determinar el monto (Debe/Haber)");
    }
  } else {
    const rawAmount = parseAmount(row[columnMap.amount]);
    if (!isNaN(rawAmount) && rawAmount !== 0) {
      amount = Math.abs(rawAmount);
      type = rawAmount > 0 ? "credit" : "debit";
    } else {
      errors.push("Monto inválido o cero");
    }
  }

  // ── Description ──
  const descCol = columnMap.description;
  if (descCol) {
    description = (row[descCol] || "").trim();
  }
  if (!description) {
    // Fallback: try any non-date, non-amount column that looks like text
    for (const col of Object.keys(row)) {
      const val = (row[col] || "").trim();
      if (val && val.length > 3 && !/^[\d\s\/\-\.\,]+$/.test(val)) {
        description = val;
        break;
      }
    }
  }
  if (!description) {
    errors.push("Descripción requerida");
  }

  // ── Reference (optional) ──
  const refCol = columnMap.reference;
  if (refCol) {
    reference = (row[refCol] || "").trim() || null;
  }

  return { date, description, amount, type, reference, errors };
}

// ── Exported Service ──

/**
 * Parse a CSV buffer and return a preview of the data.
 *
 * @param {Buffer} fileBuffer - Raw CSV file contents
 * @returns {{ totalRows: number, validRows: Array, errorRows: Array, detectedBank: string }}
 * @throws {HttpError} If CSV cannot be parsed
 */
function parseCSV(fileBuffer) {
  const csvString = fileBuffer.toString("utf-8");

  if (!csvString.trim()) {
    throw new HttpError(400, "UPLOAD_ERROR", "El archivo CSV está vacío");
  }

  const parsed = Papa.parse(csvString, {
    header: true,
    skipEmptyLines: true,
    trimHeaders: true,
    encoding: "utf-8",
  });

  if (parsed.errors.length > 0 && parsed.data.length === 0) {
    throw new HttpError(
      400,
      "UPLOAD_ERROR",
      "No se pudo parsear el archivo CSV. Verificá que sea un CSV válido.",
    );
  }

  const headers = parsed.meta.fields || [];
  if (headers.length === 0) {
    throw new HttpError(
      400,
      "UPLOAD_ERROR",
      "El archivo CSV no tiene encabezados o está vacío",
    );
  }

  const bank = detectBank(headers);
  let columnMap;

  if (bank) {
    const pattern = BANK_PATTERNS[bank];
    columnMap = { ...pattern.columns };
    columnMap.date = Array.isArray(pattern.columns.date)
      ? findFirstMatch(headers, pattern.columns.date)
      : pattern.columns.date;
  } else {
    columnMap = buildGenericColumnMap(headers);
  }

  const validRows = [];
  const errorRows = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const result = parseRow(row, bank, columnMap, i);

    if (result.errors.length > 0) {
      errorRows.push({
        rowNumber: i + 1,
        data: row,
        errors: result.errors,
      });
    } else {
      validRows.push({
        date: result.date,
        description: result.description.substring(0, 500),
        amount: result.amount,
        type: result.type,
        reference: result.reference,
      });
    }
  }

  return {
    totalRows: parsed.data.length,
    validRows,
    errorRows,
    detectedBank: bank || "Desconocido",
  };
}

/**
 * Bulk insert valid transaction rows within a MongoDB transaction.
 *
 * @param {string} tenantId - Tenant ObjectId
 * @param {string} bankAccountId - BankAccount ObjectId
 * @param {Array} rows - Array of { date, description, amount, type, reference }
 * @returns {Promise<number>} Number of documents inserted
 */
async function bulkInsertTransactions(tenantId, bankAccountId, rows) {
  if (!rows || rows.length === 0) return 0;

  const documents = rows.map((row) => ({
    tenant: tenantId,
    bankAccount: bankAccountId,
    date: new Date(row.date),
    description: row.description,
    amount: row.amount,
    type: row.type,
    reference: row.reference || null,
    status: "pending",
  }));

  const session = await mongoose.startSession();
  try {
    session.startTransaction();
    const result = await BankTransaction.insertMany(documents, { session });
    await session.commitTransaction();
    return result.length;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Find the first header that matches any of the candidate names (case-insensitive contains).
 */
function findFirstMatch(headers, candidates) {
  const upperHeaders = headers.map((h) => h.trim().toUpperCase());
  for (const candidate of candidates) {
    const upper = candidate.toUpperCase();
    const idx = upperHeaders.findIndex((h) => h.includes(upper));
    if (idx !== -1) return headers[idx];
  }
  return candidates[0]; // fallback
}

module.exports = {
  parseCSV,
  bulkInsertTransactions,
  detectBank,
};
