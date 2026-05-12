const PDFDocument = require("pdfkit");

const paymentMethodLabels = {
  cash: "Efectivo",
  card: "Tarjeta",
  transfer: "Transferencia",
  mercadopago: "Mercado Pago",
  check: "Cheque",
  other: "Otro",
};

function formatCurrency(amount) {
  return `$${Number(amount || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  return d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function getItemProductName(item) {
  if (typeof item.product === "object" && item.product) {
    return item.product.name || "Producto";
  }
  if (typeof item.supply === "object" && item.supply) {
    return item.supply.name || "Insumo";
  }
  if (typeof item.productName === "string") return item.productName;
  return item.product?.toString() || "Producto";
}

function getItemSku(item) {
  if (typeof item.product === "object" && item.product) {
    return item.product.sku || item.product._id?.toString().slice(-6).toUpperCase() || "";
  }
  if (typeof item.supply === "object" && item.supply) {
    return item.supply.sku || "";
  }
  return "";
}

function generatePurchasePdf(purchase, supplier) {
  const doc = new PDFDocument({ margin: 50, size: "A4" });
  const buffers = [];
  const pageWidth = 495;

  doc.on("data", (chunk) => buffers.push(chunk));

  // ── Colors ──
  const PRIMARY = "#1e40af";
  const DARK = "#1e293b";
  const MUTED = "#94a3b8";
  const LIGHT_BG = "#f8fafc";
  const BORDER = "#e2e8f0";

  // ── Top bar ──
  doc.rect(50, 40, pageWidth, 4).fill(PRIMARY);

  doc.fontSize(22).font("Helvetica-Bold").fillColor(DARK);
  doc.text("ORDEN DE COMPRA", 50, 60);

  doc.fontSize(8).font("Helvetica").fillColor(MUTED);
  doc.text("Documento no válido como factura", 50, 85);

  // Right side: OC number
  const rightX = 350;
  doc.fontSize(10).font("Helvetica-Bold").fillColor(DARK);
  doc.text("N° DE OC", rightX, 60, { width: 150, align: "right" });
  doc.fontSize(14).font("Helvetica-Bold").fillColor(PRIMARY);
  doc.text(purchase._id.toString().slice(-8).toUpperCase(), rightX, 75, { width: 150, align: "right" });

  // Status badge
  const statusColors = {
    DRAFT: "#f59e0b",
    CONFIRMED: "#22c55e",
    RECEIVED: "#3b82f6",
    CANCELLED: "#ef4444",
  };
  const statusLabels = {
    DRAFT: "Borrador",
    CONFIRMED: "Confirmada",
    RECEIVED: "Recibida",
    CANCELLED: "Cancelada",
  };
  const statusColor = statusColors[purchase.status] || "#94a3b8";
  const statusLabel = statusLabels[purchase.status] || purchase.status;
  doc.fontSize(8).font("Helvetica-Bold").fillColor("#fff");
  const badgeW = 90;
  const badgeH = 18;
  const badgeX = 410;
  doc.roundedRect(badgeX, 98, badgeW, badgeH, 3).fill(statusColor);
  doc.text(statusLabel, badgeX, 103, { width: badgeW, align: "center" });

  doc.moveDown(4);

  // ── Divider ──
  doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).stroke(BORDER);
  doc.moveDown(1.5);

  // ── Supplier info (left) + Order details (right) ──
  const infoY = doc.y;

  doc.fontSize(8).font("Helvetica-Bold").fillColor(MUTED).text("PROVEEDOR", 50, infoY);
  doc.fontSize(10).font("Helvetica-Bold").fillColor(DARK);
  doc.text(supplier?.name || "—", 50, infoY + 14);

  doc.fontSize(9).font("Helvetica").fillColor(DARK);
  let suppY = doc.y + 4;
  if (supplier?.taxId) { doc.text(`CUIT: ${supplier.taxId}`, 50, suppY); suppY += 16; }
  if (supplier?.phone) { doc.text(`Tel: ${supplier.phone}`, 50, suppY); suppY += 16; }
  if (supplier?.email) { doc.text(`Email: ${supplier.email}`, 50, suppY); suppY += 16; }
  if (supplier?.address) { doc.text(supplier.address, 50, suppY); }

  // Right column
  const infoRightX = 340;
  doc.fontSize(8).font("Helvetica-Bold").fillColor(MUTED).text("DETALLES DE LA ORDEN", infoRightX, infoY);

  const rowLabel = (label, value, yPos) => {
    doc.fontSize(9).font("Helvetica").fillColor(MUTED).text(label, infoRightX, yPos);
    doc.font("Helvetica-Bold").fillColor(DARK).text(value, infoRightX + 120, yPos, { width: 80, align: "right" });
  };

  rowLabel("Fecha:", formatDate(purchase.date), infoY + 14);
  rowLabel("Condición:", purchase.paymentCondition === "CASH" ? "Contado" : `Crédito${purchase.dueDate ? ` (Vence: ${formatDate(purchase.dueDate)})` : ""}`, infoY + 32);
  rowLabel("Método de pago:", paymentMethodLabels[purchase.paymentMethod] || purchase.paymentMethod || "—", infoY + 50);
  rowLabel("Estado:", purchase.paymentStatus === "PAID" ? "Pagado" : purchase.paymentStatus === "PARTIAL" ? `Parcial (${formatCurrency(purchase.paidAmount)})` : "Pendiente", infoY + 68);

  doc.moveDown(6);

  // ── Items Table ──
  const tableY = Math.max(doc.y, infoY + 85);
  doc.y = tableY;

  const tableHeaderH = 24;
  doc.rect(50, tableY, pageWidth, tableHeaderH).fill(LIGHT_BG);
  doc.rect(50, tableY, pageWidth, tableHeaderH).stroke(BORDER);

  const cols = [
    { x: 55, w: 45, label: "SKU", align: "left" },
    { x: 105, w: 170, label: "PRODUCTO", align: "left" },
    { x: 280, w: 50, label: "CANT.", align: "center" },
    { x: 335, w: 70, label: "P. UNIT.", align: "right" },
    { x: 410, w: 70, label: "SUBTOTAL", align: "right" },
  ];

  doc.fontSize(7).font("Helvetica-Bold").fillColor(MUTED);
  for (const col of cols) {
    doc.text(col.label, col.x, tableY + 7, { width: col.w, align: col.align });
  }

  // Table rows
  let rowY = tableY + tableHeaderH;
  doc.fontSize(9).font("Helvetica").fillColor(DARK);

  for (const item of purchase.items || []) {
    const name = getItemProductName(item);
    const sku = getItemSku(item);
    const rowH = 24;

    if (purchase.items.indexOf(item) % 2 === 1) {
      doc.rect(50, rowY, pageWidth, rowH).fill(LIGHT_BG);
    }
    doc.rect(50, rowY, pageWidth, rowH).stroke(BORDER);

    doc.font("Helvetica").fillColor(DARK);
    doc.text(sku, 55, rowY + 5, { width: 45 });
    doc.text(name, 105, rowY + 5, { width: 170 });
    doc.text(String(item.quantity || 0), 280, rowY + 5, { width: 50, align: "center" });
    doc.text(formatCurrency(item.unitCost), 335, rowY + 5, { width: 70, align: "right" });
    doc.font("Helvetica-Bold");
    doc.text(formatCurrency(item.lineTotal), 410, rowY + 5, { width: 70, align: "right" });

    rowY += rowH;
  }

  // ── Totals ──
  const totalsStartY = rowY + 10;
  const totalsX = 300;
  const totalsW = 195;

  let ty = totalsStartY;
  doc.fontSize(9).font("Helvetica").fillColor(DARK);
  doc.text("Subtotal", totalsX, ty, { width: 90, align: "left" });
  doc.text(formatCurrency(purchase.subtotal), totalsX + 90, ty, { width: 105, align: "right" });
  ty += 18;

  doc.text("IVA", totalsX, ty, { width: 90, align: "left" });
  doc.text(formatCurrency(purchase.tax), totalsX + 90, ty, { width: 105, align: "right" });
  ty += 22;

  doc.moveTo(totalsX, ty).lineTo(totalsX + totalsW, ty).stroke(PRIMARY);
  ty += 8;

  doc.fontSize(12).font("Helvetica-Bold").fillColor(PRIMARY);
  doc.text("TOTAL", totalsX, ty, { width: 90, align: "left" });
  doc.text(formatCurrency(purchase.total), totalsX + 90, ty, { width: 105, align: "right" });

  // ── Footer ──
  const footerY = Math.max(ty + 50, 620);

  if (purchase.notes) {
    doc.moveTo(50, footerY).lineTo(50 + pageWidth, footerY).stroke(BORDER);
    doc.moveDown(1);
    doc.fontSize(8).font("Helvetica-Bold").fillColor(MUTED).text("OBSERVACIONES", 50, footerY + 10);
    doc.moveDown(0.5);
    doc.fontSize(9).font("Helvetica").fillColor(DARK);
    doc.text(purchase.notes, 50, doc.y, { width: pageWidth });
  }

  // Bottom bar
  doc.rect(50, 770, pageWidth, 4).fill(PRIMARY);
  doc.fontSize(7).font("Helvetica").fillColor(MUTED);
  doc.text(`Generado el ${new Date().toLocaleString("es-AR")}`, 50, 780);

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
  });
}

module.exports = { generatePurchasePdf };
