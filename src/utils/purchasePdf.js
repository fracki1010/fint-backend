const PDFDocument = require("pdfkit");

function formatCurrency(amount) {
  return `$${Number(amount || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function generatePurchasePdf(purchase, supplier) {
  const doc = new PDFDocument({ margin: 40, size: "A4" });
  const buffers = [];

  doc.on("data", (chunk) => buffers.push(chunk));

  // Header
  doc.fontSize(20).font("Helvetica-Bold").text("Orden de Compra", { align: "center" });
  doc.fontSize(10).font("Helvetica").text(`N°: ${purchase._id.toString().slice(-8).toUpperCase()}`, { align: "center" });
  doc.moveDown(1.5);

  // Supplier info
  doc.fontSize(11).font("Helvetica-Bold").text("Proveedor:");
  doc.fontSize(10).font("Helvetica").text(supplier?.name || "—");
  if (supplier?.taxId) doc.text(`CUIT: ${supplier.taxId}`);
  if (supplier?.phone) doc.text(`Tel: ${supplier.phone}`);
  if (supplier?.email) doc.text(`Email: ${supplier.email}`);
  doc.moveDown(1);

  // Purchase info
  doc.fontSize(11).font("Helvetica-Bold").text("Detalle:");
  doc.fontSize(10).font("Helvetica");
  doc.text(`Fecha: ${purchase.date}`);
  doc.text(`Condición: ${purchase.paymentCondition === "CASH" ? "Contado" : `Crédito${purchase.dueDate ? ` (Vence: ${purchase.dueDate})` : ""}`}`);
  doc.text(`Estado: ${purchase.status === "DRAFT" ? "Borrador" : purchase.status === "CONFIRMED" ? "Confirmada" : purchase.status === "RECEIVED" ? "Recibida" : "Cancelada"}`);
  doc.text(`Pago: ${purchase.paymentStatus === "PAID" ? "Pagado" : purchase.paymentStatus === "PARTIAL" ? `Parcial ($${purchase.paidAmount})` : "Pendiente"}`);
  doc.moveDown(1.5);

  // Items table
  const tableTop = doc.y;
  const col1 = 40, col2 = 250, col3 = 340, col4 = 430, col5 = 500;
  const rowHeight = 18;

  doc.fontSize(9).font("Helvetica-Bold");
  doc.text("Producto", col1, tableTop);
  doc.text("Cant.", col2, tableTop, { width: 80, align: "center" });
  doc.text("P. Unit.", col3, tableTop, { width: 80, align: "right" });
  doc.text("Subtotal", col5, tableTop, { width: 70, align: "right" });

  doc.moveDown(0.5);
  doc.moveTo(40, doc.y).lineTo(555, doc.y).stroke("#ccc");
  doc.moveDown(0.3);

  doc.font("Helvetica");
  for (const item of purchase.items || []) {
    const y = doc.y;
    doc.text(item.product || "—", col1, y, { width: 200 });
    doc.text(String(item.quantity || 0), col2, y, { width: 80, align: "center" });
    doc.text(formatCurrency(item.unitCost), col3, y, { width: 80, align: "right" });
    doc.text(formatCurrency(item.lineTotal), col5, y, { width: 70, align: "right" });
    doc.moveDown(0.8);
  }

  // Totals
  doc.moveDown(1);
  doc.moveTo(350, doc.y).lineTo(555, doc.y).stroke("#ccc");
  doc.moveDown(0.5);

  const totalsX = 350;
  doc.fontSize(10);
  doc.text("Subtotal:", totalsX, doc.y, { width: 205, align: "left" });
  doc.text(formatCurrency(purchase.subtotal), { width: 205, align: "right" });
  doc.moveDown(0.5);
  doc.text("IVA:", totalsX, doc.y, { width: 205, align: "left" });
  doc.text(formatCurrency(purchase.tax), { width: 205, align: "right" });
  doc.moveDown(0.5);
  doc.moveTo(350, doc.y).lineTo(555, doc.y).stroke("#ccc");
  doc.moveDown(0.3);
  doc.font("Helvetica-Bold").fontSize(12);
  doc.text("TOTAL:", totalsX, doc.y, { width: 205, align: "left" });
  doc.text(formatCurrency(purchase.total), { width: 205, align: "right" });
  doc.moveDown(2);

  // Notes
  if (purchase.notes) {
    doc.fontSize(9).font("Helvetica");
    doc.text(`Notas: ${purchase.notes}`);
  }

  doc.end();

  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(buffers)));
  });
}

module.exports = { generatePurchasePdf };
