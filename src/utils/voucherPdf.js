const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

// Default configuration
const DEFAULTS = {
  margin: 40,
  pageSize: "A4",
  fonts: {
    regular: "Helvetica",
    bold: "Helvetica-Bold",
  },
  colors: {
    primary: "#111",
    secondary: "#555",
    light: "#C9CDD4",
    accent: "#2563EB",
  },
};

// Utility functions
const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const formatMoney = (value, currency = "$") => {
  const num = Number(value || 0);
  return `${currency}${num.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
};

const formatDate = (date) => {
  if (!date) return new Date().toLocaleDateString("es-AR");
  return new Date(date).toLocaleDateString("es-AR");
};

const numberToWords = (num) => {
  const units = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
  const teens = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
  const tens = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
  const hundreds = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

  if (num === 0) return "cero";
  if (num === 100) return "cien";

  let words = "";
  const wholePart = Math.floor(num);
  const decimalPart = Math.round((num - wholePart) * 100);

  if (wholePart > 999999) {
    const millions = Math.floor(wholePart / 1000000);
    words += millions === 1 ? "un millón " : `${numberToWords(millions)} millones `;
    num = wholePart % 1000000;
  }

  if (wholePart > 999) {
    const thousands = Math.floor((wholePart % 1000000) / 1000);
    if (thousands === 1) {
      words += "mil ";
    } else {
      words += `${numberToWords(thousands)} mil `;
    }
  }

  const remainder = wholePart % 1000;
  if (remainder > 0) {
    if (remainder < 100) {
      if (remainder < 10) {
        words += units[remainder];
      } else if (remainder < 20) {
        words += teens[remainder - 10];
      } else {
        const ten = Math.floor(remainder / 10);
        const unit = remainder % 10;
        words += tens[ten];
        if (unit > 0) words += ` y ${units[unit]}`;
      }
    } else {
      const hundred = Math.floor(remainder / 100);
      const rest = remainder % 100;
      words += hundreds[hundred];
      if (rest > 0) {
        if (rest < 10) {
          words += ` ${units[rest]}`;
        } else if (rest < 20) {
          words += ` ${teens[rest - 10]}`;
        } else {
          const ten = Math.floor(rest / 10);
          const unit = rest % 10;
          words += ` ${tens[ten]}`;
          if (unit > 0) words += ` y ${units[unit]}`;
        }
      }
    }
  }

  let result = words.trim();
  if (decimalPart > 0) {
    result += ` con ${decimalPart}/100`;
  } else {
    result += " con 00/100";
  }

  return result;
};

// Shared layout helpers
class PdfLayout {
  constructor(doc, options = {}) {
    this.doc = doc;
    this.marginX = options.marginX || DEFAULTS.margin;
    this.pageWidth = doc.page.width;
    this.pageHeight = doc.page.height;
    this.pageBottom = this.pageHeight - this.marginX;
  }

  ensureSpace(neededHeight = 24) {
    if (this.doc.y + neededHeight <= this.pageBottom) return;
    this.doc.addPage();
    this.doc.y = this.marginX;
  }

  drawHeader(store = {}, voucherType = "", voucherNumber = "") {
    const startY = this.doc.y;
    const storeName = store.storeName || "Fint Guard";

    // Store info - left side
    this.doc
      .font(DEFAULTS.fonts.bold)
      .fontSize(20)
      .fillColor(DEFAULTS.colors.primary)
      .text(storeName, this.marginX, startY);

    this.doc.moveDown(0.2);
    this.doc.font(DEFAULTS.fonts.bold).fontSize(12);
    this.doc.font(DEFAULTS.fonts.regular).fontSize(10);

    if (store.taxId) {
      this.doc.text(`CUIT/NIT: ${store.taxId}`, this.marginX, this.doc.y);
    }
    if (store.phone) {
      this.doc.text(`Teléfono: ${store.phone}`, this.marginX, this.doc.y);
    }
    if (store.email) {
      this.doc.text(`Email: ${store.email}`, this.marginX, this.doc.y);
    }
    if (store.address) {
      this.doc.text(`Dirección: ${store.address}`, this.marginX, this.doc.y);
    }

    // Voucher type and number - right side
    const typeLabels = {
      invoice: "FACTURA",
      delivery_note: "REMITO",
      receipt: "RECIBO",
    };

    const rightX = this.pageWidth - 200;
    this.doc.y = startY;

    this.doc
      .font(DEFAULTS.fonts.bold)
      .fontSize(24)
      .fillColor(DEFAULTS.colors.accent)
      .text(typeLabels[voucherType] || "DOCUMENTO", rightX, startY, {
        width: 160,
        align: "right",
      });

    this.doc.moveDown(0.3);
    this.doc
      .font(DEFAULTS.fonts.bold)
      .fontSize(14)
      .fillColor(DEFAULTS.colors.primary)
      .text(`N° ${voucherNumber}`, rightX, this.doc.y, {
        width: 160,
        align: "right",
      });

    this.doc.y = Math.max(this.doc.y, startY + 80);
    this.doc.moveDown(0.5);
  }

  drawClientInfo(client = {}, order = {}) {
    this.ensureSpace(60);
    const startY = this.doc.y;

    this.doc
      .font(DEFAULTS.fonts.bold)
      .fontSize(11)
      .fillColor(DEFAULTS.colors.primary)
      .text("CLIENTE", this.marginX, startY);

    this.doc.moveDown(0.2);
    this.doc.font(DEFAULTS.fonts.regular).fontSize(10);

    const clientName = client.name || client.phone || "Consumidor final";
    this.doc.text(`Nombre: ${clientName}`, this.marginX, this.doc.y);

    if (client.taxId) {
      this.doc.text(`Documento: ${client.taxId}`, this.marginX, this.doc.y);
    }
    if (client.phone) {
      this.doc.text(`Teléfono: ${client.phone}`, this.marginX, this.doc.y);
    }
    if (client.fiscalAddress || client.address) {
      this.doc.text(`Dirección: ${client.fiscalAddress || client.address}`, this.marginX, this.doc.y);
    }

    // Order info - right side
    const rightX = this.pageWidth - 200;
    this.doc.y = startY;

    this.doc
      .font(DEFAULTS.fonts.bold)
      .fontSize(11)
      .text("ORDEN", rightX, startY, { width: 160, align: "right" });

    this.doc.moveDown(0.2);
    this.doc.font(DEFAULTS.fonts.regular).fontSize(10);
    this.doc.text(`N°: ${order.orderNumber || order._id || "N/A"}`, rightX, this.doc.y, {
      width: 160,
      align: "right",
    });
    this.doc.text(`Fecha: ${formatDate(order.createdAt)}`, rightX, this.doc.y, {
      width: 160,
      align: "right",
    });

    this.doc.y = Math.max(this.doc.y, startY + 50);
    this.doc.moveDown(0.5);
  }

  drawFooter() {
    this.doc.y = this.pageBottom - 30;
    this.doc
      .font(DEFAULTS.fonts.regular)
      .fontSize(8)
      .fillColor(DEFAULTS.colors.secondary)
      .text(
        "Documento generado automáticamente por Fint Guard. Este comprobante tiene validez fiscal según la normativa vigente.",
        this.marginX,
        this.doc.y,
        { align: "center", width: this.pageWidth - this.marginX * 2 },
      );
  }

  drawTableHeader(columns) {
    this.ensureSpace(28);
    const y = this.doc.y;

    this.doc.font(DEFAULTS.fonts.bold).fontSize(10).fillColor(DEFAULTS.colors.primary);

    let currentX = this.marginX;
    columns.forEach((col) => {
      this.doc.text(col.label, currentX, y, {
        width: col.width,
        align: col.align || "left",
      });
      currentX += col.width;
    });

    // Draw line under header
    this.doc
      .moveTo(this.marginX, y + 14)
      .lineTo(this.pageWidth - this.marginX, y + 14)
      .strokeColor(DEFAULTS.colors.light)
      .stroke();

    this.doc.y = y + 20;
  }

  drawTableRow(columns, values) {
    this.doc.font(DEFAULTS.fonts.regular).fontSize(10).fillColor(DEFAULTS.colors.primary);

    // Calculate row height based on tallest cell
    let maxHeight = 16;
    columns.forEach((col, index) => {
      const value = values[index] || "";
      const height = this.doc.heightOfString(String(value), { width: col.width - 5 });
      maxHeight = Math.max(maxHeight, height + 4);
    });

    this.ensureSpace(maxHeight + 6);
    const y = this.doc.y;

    let currentX = this.marginX;
    columns.forEach((col, index) => {
      const value = values[index] || "";
      this.doc.text(String(value), currentX, y, {
        width: col.width - 5,
        align: col.align || "left",
      });
      currentX += col.width;
    });

    this.doc.y = y + maxHeight + 4;
  }

  drawTotalsSection(totals) {
    this.ensureSpace(48);
    this.doc.moveDown(0.4);

    const startX = this.pageWidth - 220;
    const lineWidth = 200;

    // Draw line above totals
    this.doc
      .moveTo(startX - 20, this.doc.y)
      .lineTo(startX + lineWidth, this.doc.y)
      .strokeColor(DEFAULTS.colors.light)
      .stroke();

    this.doc.moveDown(0.4);

    totals.forEach((total) => {
      this.doc
        .font(total.bold ? DEFAULTS.fonts.bold : DEFAULTS.fonts.regular)
        .fontSize(total.size || 11)
        .fillColor(DEFAULTS.colors.primary)
        .text(total.label, startX, this.doc.y, { width: 100, align: "left" })
        .text(total.value, startX + 100, this.doc.y - 14, {
          width: 100,
          align: "right",
        });
    });

    this.doc.moveDown(0.5);
  }
}

// Template: Invoice (Factura)
const generateInvoiceTemplate = async (doc, data) => {
  const { order = {}, client = {}, store = {}, voucherNumber = "" } = data;
  const layout = new PdfLayout(doc);

  // Header
  layout.drawHeader(store, "invoice", voucherNumber);
  layout.drawClientInfo(client, order);

  // Invoice details
  layout.ensureSpace(30);
  doc.font(DEFAULTS.fonts.bold).fontSize(11).text("DETALLE DE FACTURA", layout.marginX, doc.y);
  doc.moveDown(0.3);

  // Table columns
  const columns = [
    { label: "Producto", width: 200 },
    { label: "Cant.", width: 60, align: "right" },
    { label: "Precio Unit.", width: 90, align: "right" },
    { label: "Subtotal", width: 100, align: "right" },
  ];

  layout.drawTableHeader(columns);

  // Items
  const items = Array.isArray(order.items) ? order.items : [];
  items.forEach((item) => {
    const qty = Number(item.quantity || 0);
    const price = Number(item.price || 0);
    const subtotal = qty * price;

    layout.drawTableRow(columns, [
      item.product || "-",
      qty.toString(),
      formatMoney(price),
      formatMoney(subtotal),
    ]);
  });

  // Totals
  const totalAmount = Number(order.totalAmount || 0);
  const taxRate = Number(store.taxRate || 21);
  const subtotal = totalAmount / (1 + taxRate / 100);
  const taxAmount = totalAmount - subtotal;

  layout.drawTotalsSection([
    { label: "Subtotal:", value: formatMoney(subtotal), bold: false, size: 10 },
    { label: `IVA (${taxRate}%):`, value: formatMoney(taxAmount), bold: false, size: 10 },
    { label: "TOTAL:", value: formatMoney(totalAmount), bold: true, size: 14 },
  ]);

  // Amount in words
  layout.ensureSpace(30);
  doc
    .font(DEFAULTS.fonts.regular)
    .fontSize(10)
    .fillColor(DEFAULTS.colors.secondary)
    .text(`Son: ${numberToWords(totalAmount).toUpperCase()} PESOS`, layout.marginX, doc.y);

  // Legal footer
  layout.drawFooter();
};

// Template: Delivery Note (Remito)
const generateDeliveryNoteTemplate = async (doc, data) => {
  const { order = {}, client = {}, store = {}, voucherNumber = "" } = data;
  const layout = new PdfLayout(doc);

  // Header
  layout.drawHeader(store, "delivery_note", voucherNumber);
  layout.drawClientInfo(client, order);

  // Delivery address section
  layout.ensureSpace(40);
  doc.font(DEFAULTS.fonts.bold).fontSize(11).text("DIRECCIÓN DE ENTREGA", layout.marginX, doc.y);
  doc.moveDown(0.2);
  doc.font(DEFAULTS.fonts.regular).fontSize(10);
  doc.text(client.fiscalAddress || client.address || "Retira en local", layout.marginX, doc.y);
  doc.moveDown(0.5);

  // Items table
  doc.font(DEFAULTS.fonts.bold).fontSize(11).text("PRODUCTOS ENTREGADOS", layout.marginX, doc.y);
  doc.moveDown(0.3);

  const columns = [
    { label: "Producto", width: 350 },
    { label: "Cantidad", width: 100, align: "right" },
  ];

  layout.drawTableHeader(columns);

  const items = Array.isArray(order.items) ? order.items : [];
  items.forEach((item) => {
    const qty = Number(item.quantity || 0);
    layout.drawTableRow(columns, [item.product || "-", qty.toString()]);
  });

  // Summary
  layout.ensureSpace(40);
  doc.moveDown(0.5);
  doc.font(DEFAULTS.fonts.bold).fontSize(11).text("RESUMEN", layout.marginX, doc.y);
  doc.moveDown(0.2);
  doc.font(DEFAULTS.fonts.regular).fontSize(10);
  doc.text(`Total de items: ${items.length}`, layout.marginX, doc.y);
  doc.text(`Total de unidades: ${items.reduce((sum, i) => sum + Number(i.quantity || 0), 0)}`, layout.marginX, doc.y);

  // Signature section
  layout.ensureSpace(80);
  doc.moveDown(1);

  const signatureY = doc.y;
  const signatureWidth = 200;
  const gap = 40;

  // Left signature - Client
  doc
    .moveTo(layout.marginX, signatureY + 40)
    .lineTo(layout.marginX + signatureWidth, signatureY + 40)
    .strokeColor(DEFAULTS.colors.light)
    .stroke();
  doc.font(DEFAULTS.fonts.regular).fontSize(9).text("Firma del Cliente", layout.marginX, signatureY + 45);
  doc.font(DEFAULTS.fonts.regular).fontSize(9).text("Recibí conforme", layout.marginX, signatureY + 56);

  // Right signature - Delivery
  const rightX = layout.pageWidth - layout.marginX - signatureWidth;
  doc
    .moveTo(rightX, signatureY + 40)
    .lineTo(rightX + signatureWidth, signatureY + 40)
    .strokeColor(DEFAULTS.colors.light)
    .stroke();
  doc.font(DEFAULTS.fonts.regular).fontSize(9).text("Firma del Repartidor", rightX, signatureY + 45);
  doc.font(DEFAULTS.fonts.regular).fontSize(9).text("Entregó", rightX, signatureY + 56);

  // Date and time
  doc.y = signatureY + 70;
  doc.font(DEFAULTS.fonts.regular).fontSize(9).text(
    `Fecha y hora de recepción: _____________`,
    layout.marginX,
    doc.y,
  );

  layout.drawFooter();
};

// Template: Receipt (Recibo)
const generateReceiptTemplate = async (doc, data) => {
  const { order = {}, client = {}, store = {}, voucherNumber = "", payment = {} } = data;
  const layout = new PdfLayout(doc);

  // Header
  layout.drawHeader(store, "receipt", voucherNumber);

  // Receipt specific header
  layout.ensureSpace(40);
  doc.font(DEFAULTS.fonts.bold).fontSize(16).fillColor(DEFAULTS.colors.accent);
  doc.text("RECIBO DE PAGO", layout.marginX, doc.y, { align: "center", width: layout.pageWidth - layout.marginX * 2 });
  doc.moveDown(0.5);

  // Main receipt content
  layout.ensureSpace(100);
  doc.font(DEFAULTS.fonts.regular).fontSize(11).fillColor(DEFAULTS.colors.primary);

  const totalAmount = Number(order.totalAmount || 0);
  const amountInWords = numberToWords(totalAmount).toUpperCase();
  const clientName = client.name || client.phone || "Consumidor final";
  const clientDoc = client.taxId || "N/A";
  const storeName = store.storeName || "Fint Guard";
  const storeDoc = store.taxId || "N/A";

  // Receipt text
  const receiptText = [
    `Recibí de: ${clientName}`,
    `Documento: ${clientDoc}`,
    "",
    `La cantidad de: ${formatMoney(totalAmount)}`,
    `(${amountInWords} PESOS)`,
    "",
    `En concepto de: Pago de orden N° ${order.orderNumber || order._id || "N/A"}`,
    `Fecha de pago: ${formatDate(payment.paidAt || order.paidAt || new Date())}`,
    `Medio de pago: ${payment.method || "Efectivo"}`,
    "",
    `Emitido por: ${storeName} - CUIT: ${storeDoc}`,
  ];

  receiptText.forEach((line) => {
    if (line === "") {
      doc.moveDown(0.3);
    } else {
      doc.text(line, layout.marginX, doc.y);
    }
  });

  // Order reference table
  layout.ensureSpace(60);
  doc.moveDown(0.5);
  doc.font(DEFAULTS.fonts.bold).fontSize(10).text("Referencia de la Orden:", layout.marginX, doc.y);
  doc.moveDown(0.2);

  const columns = [
    { label: "Campo", width: 150 },
    { label: "Valor", width: 300 },
  ];

  layout.drawTableHeader(columns);
  layout.drawTableRow(columns, ["N° Orden:", order.orderNumber || order._id || "N/A"]);
  layout.drawTableRow(columns, ["Fecha:", formatDate(order.createdAt)]);
  layout.drawTableRow(columns, ["Monto Total:", formatMoney(totalAmount)]);
  layout.drawTableRow(columns, ["Estado:", order.paymentStatus || "Pagado"]);

  // Signatures
  layout.ensureSpace(80);
  doc.moveDown(1);

  const signatureY = doc.y;
  const signatureWidth = 200;

  // Received by (Store)
  doc
    .moveTo(layout.marginX, signatureY + 40)
    .lineTo(layout.marginX + signatureWidth, signatureY + 40)
    .strokeColor(DEFAULTS.colors.light)
    .stroke();
  doc.font(DEFAULTS.fonts.regular).fontSize(9).text("Recibí (Firma y Sello)", layout.marginX, signatureY + 45);
  doc.font(DEFAULTS.fonts.regular).fontSize(9).text(storeName, layout.marginX, signatureY + 56);

  // Paid by (Client)
  const rightX = layout.pageWidth - layout.marginX - signatureWidth;
  doc
    .moveTo(rightX, signatureY + 40)
    .lineTo(rightX + signatureWidth, signatureY + 40)
    .strokeColor(DEFAULTS.colors.light)
    .stroke();
  doc.font(DEFAULTS.fonts.regular).fontSize(9).text("Pagó (Firma)", rightX, signatureY + 45);
  doc.font(DEFAULTS.fonts.regular).fontSize(9).text(clientName, rightX, signatureY + 56);

  layout.drawFooter();
};

// Main PDF generation function
const generateVoucherPdf = async ({
  voucherType,
  voucherNumber,
  order = {},
  client = {},
  store = {},
  payment = {},
  outputPath,
}) => {
  const templates = {
    invoice: generateInvoiceTemplate,
    delivery_note: generateDeliveryNoteTemplate,
    receipt: generateReceiptTemplate,
  };

  const template = templates[voucherType];
  if (!template) {
    throw new Error(`Tipo de comprobante no válido: ${voucherType}`);
  }

  // Ensure output directory exists
  ensureDir(path.dirname(outputPath));

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: DEFAULTS.margin,
      size: DEFAULTS.pageSize,
    });

    const output = fs.createWriteStream(outputPath);

    output.on("finish", () => resolve(outputPath));
    output.on("error", reject);
    doc.on("error", reject);

    doc.pipe(output);

    // Generate content
    template(doc, {
      order,
      client,
      store,
      voucherNumber,
      payment,
    }).then(() => {
      doc.end();
    }).catch(reject);
  });
};

// Build file path for voucher
const buildVoucherFilePath = ({ tenantId, type, number, baseDir = "comprobantes" }) => {
  const year = new Date().getFullYear();
  const dir = path.join(process.cwd(), baseDir, String(tenantId), String(year), type);
  const timestamp = Date.now();
  const fileName = `${type}-${number.replace(/[^a-zA-Z0-9-]/g, "")}-${timestamp}.pdf`;
  return { dir, filePath: path.join(dir, fileName) };
};

module.exports = {
  generateVoucherPdf,
  buildVoucherFilePath,
  formatMoney,
  formatDate,
  numberToWords,
  ensureDir,
};
