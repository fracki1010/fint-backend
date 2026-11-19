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
    primary: "#111827",
    secondary: "#6B7280",
    light: "#E5E7EB",
    panel: "#F9FAFB",
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

const LOGO_BOX = { width: 84, height: 56 };

const TYPE_LABELS = {
  invoice: "Factura",
  delivery_note: "Remito",
  receipt: "Recibo",
};

// Only PNG and JPEG are embeddable by PDFKit; the service validates the same formats on save
const parseLogoBuffer = (dataUrl = "") => {
  const match = /^data:image\/(png|jpeg);base64,(.+)$/.exec(dataUrl || "");
  return match ? Buffer.from(match[2], "base64") : null;
};

// Shared layout helpers
class PdfLayout {
  constructor(doc, options = {}) {
    this.doc = doc;
    this.marginX = options.marginX || DEFAULTS.margin;
    this.pageWidth = doc.page.width;
    this.pageHeight = doc.page.height;
    this.contentWidth = this.pageWidth - this.marginX * 2;
    this.pageBottom = this.pageHeight - this.marginX - 40; // keeps clear of the footer
    this.rowCount = 0;
  }

  ensureSpace(neededHeight = 24) {
    if (this.doc.y + neededHeight <= this.pageBottom) return;
    this.doc.addPage();
    this.doc.y = this.marginX;
    // A table that continues on a new page repeats its header
    if (this.activeColumns) this.renderTableHeader();
  }

  drawHeader(store = {}, voucherType = "", voucherNumber = "") {
    const doc = this.doc;
    const top = this.marginX;
    const storeName = store.storeName || "Fint Guard";
    const logo = parseLogoBuffer(store.logoDataUrl);
    const textX = logo ? this.marginX + LOGO_BOX.width + 16 : this.marginX;
    const rightW = 190;
    const rightX = this.pageWidth - this.marginX - rightW;
    const leftW = rightX - textX - 20;

    if (logo) {
      try {
        doc.image(logo, this.marginX, top, { fit: [LOGO_BOX.width, LOGO_BOX.height] });
      } catch (error) {
        // Unreadable logo: the voucher is still issued without it
      }
    }

    doc
      .font(DEFAULTS.fonts.bold)
      .fontSize(18)
      .fillColor(DEFAULTS.colors.primary)
      .text(storeName, textX, top, { width: leftW });
    const nameBottom = doc.y;

    const details = [
      store.taxId ? `CUIT/NIT: ${store.taxId}` : null,
      store.address || null,
      store.phone ? `Tel: ${store.phone}` : null,
      store.email || null,
    ].filter(Boolean);

    doc
      .font(DEFAULTS.fonts.regular)
      .fontSize(9)
      .fillColor(DEFAULTS.colors.secondary)
      .text(details.join("   ·   "), textX, nameBottom + 4, { width: leftW, lineGap: 2 });
    const detailsBottom = doc.y;

    // Voucher type and number, right aligned
    doc
      .font(DEFAULTS.fonts.bold)
      .fontSize(8)
      .fillColor(DEFAULTS.colors.accent)
      .text((TYPE_LABELS[voucherType] || "Documento").toUpperCase(), rightX, top, {
        width: rightW,
        align: "right",
        characterSpacing: 1.5,
      });
    doc
      .font(DEFAULTS.fonts.bold)
      .fontSize(20)
      .fillColor(DEFAULTS.colors.primary)
      .text(`N° ${voucherNumber}`, rightX, doc.y + 2, { width: rightW, align: "right" });
    const rightBottom = doc.y;

    const logoBottom = logo ? top + LOGO_BOX.height : 0;
    const ruleY = Math.max(detailsBottom, rightBottom, logoBottom) + 14;

    doc
      .moveTo(this.marginX, ruleY)
      .lineTo(this.pageWidth - this.marginX, ruleY)
      .lineWidth(1.5)
      .strokeColor(DEFAULTS.colors.accent)
      .stroke()
      .lineWidth(1);

    doc.y = ruleY + 18;
  }

  drawSectionTitle(title) {
    this.ensureSpace(30);
    this.doc
      .font(DEFAULTS.fonts.bold)
      .fontSize(8)
      .fillColor(DEFAULTS.colors.accent)
      .text(title.toUpperCase(), this.marginX, this.doc.y, { characterSpacing: 1 });
    this.doc.y += 8;
  }

  drawClientInfo(client = {}, order = {}) {
    const doc = this.doc;
    const gap = 16;
    const cardWidth = (this.contentWidth - gap) / 2;
    const cardHeight = 92;
    this.ensureSpace(cardHeight + 20);
    const top = doc.y;

    const clientName = client.name || client.phone || "Consumidor final";
    const clientLines = [
      ["Nombre", clientName],
      ["Documento", client.taxId],
      ["Teléfono", client.phone],
      ["Dirección", client.fiscalAddress || client.address],
    ].filter(([, value]) => value);

    const orderLines = [
      ["Orden", order.orderNumber || order._id || "N/A"],
      ["Fecha", formatDate(order.createdAt)],
      ["Pago", order.paymentStatus || "-"],
    ];

    const writeCard = (x, title, lines) => {
      doc.roundedRect(x, top, cardWidth, cardHeight, 6).fill(DEFAULTS.colors.panel);

      doc
        .font(DEFAULTS.fonts.bold)
        .fontSize(7.5)
        .fillColor(DEFAULTS.colors.accent)
        .text(title.toUpperCase(), x + 14, top + 12, { characterSpacing: 1, width: cardWidth - 28 });

      let y = top + 30;
      lines.forEach(([label, value]) => {
        doc
          .font(DEFAULTS.fonts.bold)
          .fontSize(8.5)
          .fillColor(DEFAULTS.colors.secondary)
          .text(label, x + 14, y, { width: 64 });
        doc
          .font(DEFAULTS.fonts.regular)
          .fontSize(9.5)
          .fillColor(DEFAULTS.colors.primary)
          .text(String(value), x + 84, y, { width: cardWidth - 98 });
        y = doc.y + 4;
      });
    };

    writeCard(this.marginX, "Cliente", clientLines);
    writeCard(this.marginX + cardWidth + gap, "Comprobante", orderLines);

    doc.y = top + cardHeight + 20;
  }

  drawFooter() {
    const doc = this.doc;
    const y = this.pageHeight - this.marginX - 14;

    doc
      .moveTo(this.marginX, y - 8)
      .lineTo(this.pageWidth - this.marginX, y - 8)
      .lineWidth(0.5)
      .strokeColor(DEFAULTS.colors.light)
      .stroke()
      .lineWidth(1);

    doc
      .font(DEFAULTS.fonts.regular)
      .fontSize(7.5)
      .fillColor(DEFAULTS.colors.secondary)
      .text(
        "Documento generado automáticamente por Fint Guard. Este comprobante tiene validez fiscal según la normativa vigente.",
        this.marginX,
        y,
        { align: "center", width: this.contentWidth },
      );
  }

  // Columns are scaled so every table spans the full content width
  resolveColumns(columns) {
    const total = columns.reduce((sum, col) => sum + col.width, 0);
    const scale = this.contentWidth / total;
    return columns.map((col) => ({ ...col, width: col.width * scale }));
  }

  drawTableHeader(columns) {
    this.activeColumns = columns;
    this.ensureSpace(30);
    this.renderTableHeader();
  }

  renderTableHeader() {
    const doc = this.doc;
    const cols = this.resolveColumns(this.activeColumns);
    const y = doc.y;

    doc.rect(this.marginX, y, this.contentWidth, 22).fill(DEFAULTS.colors.primary);

    doc.font(DEFAULTS.fonts.bold).fontSize(8).fillColor("#FFFFFF");
    let x = this.marginX;
    cols.forEach((col) => {
      doc.text(col.label.toUpperCase(), x + 8, y + 7, {
        width: col.width - 16,
        align: col.align || "left",
        characterSpacing: 0.6,
      });
      x += col.width;
    });

    doc.y = y + 26;
    this.rowCount = 0;
  }

  drawTableRow(columns, values) {
    const doc = this.doc;
    const cols = this.resolveColumns(columns);

    doc.font(DEFAULTS.fonts.regular).fontSize(9.5);
    let contentHeight = 0;
    cols.forEach((col, index) => {
      const height = doc.heightOfString(String(values[index] ?? ""), { width: col.width - 16 });
      contentHeight = Math.max(contentHeight, height);
    });
    const rowHeight = Math.max(contentHeight + 12, 24);

    this.ensureSpace(rowHeight + 2);
    const y = doc.y;

    // Zebra striping keeps long tables readable without vertical borders
    if (this.rowCount % 2 === 1) {
      doc.rect(this.marginX, y, this.contentWidth, rowHeight).fill(DEFAULTS.colors.panel);
    }
    this.rowCount += 1;

    doc.font(DEFAULTS.fonts.regular).fontSize(9.5).fillColor(DEFAULTS.colors.primary);
    let x = this.marginX;
    cols.forEach((col, index) => {
      doc.text(String(values[index] ?? ""), x + 8, y + 6, {
        width: col.width - 16,
        align: col.align || "left",
      });
      x += col.width;
    });

    doc
      .moveTo(this.marginX, y + rowHeight)
      .lineTo(this.pageWidth - this.marginX, y + rowHeight)
      .lineWidth(0.5)
      .strokeColor(DEFAULTS.colors.light)
      .stroke()
      .lineWidth(1);

    doc.y = y + rowHeight;
  }

  // Non-bold rows are plain lines; the bold row is the dark total bar
  drawTotalsSection(totals) {
    this.activeColumns = null;
    const doc = this.doc;
    const boxWidth = 230;
    const x = this.pageWidth - this.marginX - boxWidth;
    const totalsHeight = totals.reduce((sum, t) => sum + (t.bold ? 34 : 22), 0);

    this.ensureSpace(totalsHeight + 24);
    let y = doc.y + 12;

    totals.forEach((total) => {
      if (total.bold) {
        doc.rect(x, y, boxWidth, 34).fill(DEFAULTS.colors.primary);
        doc
          .font(DEFAULTS.fonts.bold)
          .fontSize(11)
          .fillColor("#FFFFFF")
          .text(total.label, x + 12, y + 11, { width: 100 });
        doc
          .font(DEFAULTS.fonts.bold)
          .fontSize(13)
          .text(total.value, x + 110, y + 10, { width: boxWidth - 122, align: "right" });
        y += 34;
      } else {
        doc
          .font(DEFAULTS.fonts.regular)
          .fontSize(9.5)
          .fillColor(DEFAULTS.colors.secondary)
          .text(total.label, x + 12, y + 7, { width: 100 });
        doc
          .font(DEFAULTS.fonts.regular)
          .fillColor(DEFAULTS.colors.primary)
          .text(total.value, x + 110, y + 7, { width: boxWidth - 122, align: "right" });
        doc
          .moveTo(x, y + 22)
          .lineTo(x + boxWidth, y + 22)
          .lineWidth(0.5)
          .strokeColor(DEFAULTS.colors.light)
          .stroke()
          .lineWidth(1);
        y += 22;
      }
    });

    doc.y = y + 16;
  }
}

// Template: Invoice (Factura)
const generateInvoiceTemplate = async (doc, data) => {
  const { order = {}, store = {}, client = {}, voucherNumber = "" } = data;
  const layout = new PdfLayout(doc);

  layout.drawHeader(store, "invoice", voucherNumber);
  layout.drawClientInfo(client, order);

  layout.drawSectionTitle("Detalle");

  const columns = [
    { label: "Producto", width: 240 },
    { label: "Cant.", width: 60, align: "right" },
    { label: "Precio unit.", width: 110, align: "right" },
    { label: "Subtotal", width: 105, align: "right" },
  ];

  layout.drawTableHeader(columns);

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

  const totalAmount = Number(order.totalAmount || 0);
  const taxRate = Number(store.taxRate || 21);
  const subtotal = totalAmount / (1 + taxRate / 100);
  const taxAmount = totalAmount - subtotal;

  layout.drawTotalsSection([
    { label: "Subtotal", value: formatMoney(subtotal), bold: false },
    { label: `IVA (${taxRate}%)`, value: formatMoney(taxAmount), bold: false },
    { label: "TOTAL", value: formatMoney(totalAmount), bold: true },
  ]);

  layout.ensureSpace(30);
  doc
    .font(DEFAULTS.fonts.regular)
    .fontSize(9)
    .fillColor(DEFAULTS.colors.secondary)
    .text(`Son: ${numberToWords(totalAmount).toUpperCase()} PESOS`, layout.marginX, doc.y, {
      width: layout.contentWidth,
    });

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
