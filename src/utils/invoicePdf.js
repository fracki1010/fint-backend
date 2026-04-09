const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const ensureDir = (dirPath) => {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
};

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;

const buildInvoiceFileName = (order = {}) => {
  const ref = (order.orderNumber || order._id || Date.now()).toString();
  const safeRef = ref.replace(/[^a-zA-Z0-9_-]/g, "");
  return `factura-venta-${safeRef}-${Date.now()}.pdf`;
};

const generateInvoicePdf = async ({ order = {}, client = {}, store = {} }) => {
  const invoicesDir = path.join(__dirname, "../../facturas_de_ventas");
  ensureDir(invoicesDir);
  const filePath = path.join(invoicesDir, buildInvoiceFileName(order));

  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: "A4" });
    const output = fs.createWriteStream(filePath);

    output.on("finish", resolve);
    output.on("error", reject);
    doc.on("error", reject);

    doc.pipe(output);

    const storeName = store.storeName || "Fint Guard";
    const invoiceRef = order.orderNumber || String(order._id || "N/A");
    const createdAt = order.createdAt
      ? new Date(order.createdAt).toLocaleString()
      : new Date().toLocaleString();

    doc.fontSize(20).text("Factura", { align: "left" });
    doc.moveDown(0.2);
    doc.fontSize(12).text(storeName, { align: "left" });
    if (store.taxId) doc.text(`CUIT/NIT: ${store.taxId}`);
    if (store.phone) doc.text(`Telefono: ${store.phone}`);
    if (store.email) doc.text(`Email: ${store.email}`);

    doc.moveDown(0.8);
    doc.fontSize(11).text(`Nro: ${invoiceRef}`);
    doc.text(`Fecha: ${createdAt}`);
    doc.moveDown(0.4);
    doc.text(`Cliente: ${client.name || client.phone || "Consumidor final"}`);
    if (client.phone) doc.text(`Telefono cliente: ${client.phone}`);
    if (client.taxId) doc.text(`Documento: ${client.taxId}`);

    doc.moveDown(0.8);
    doc.fontSize(11).text("Detalle");
    doc.moveDown(0.3);
    doc.fontSize(10);
    doc.text("Producto", 40, doc.y, { width: 220 });
    doc.text("Cant.", 270, doc.y, { width: 60, align: "right" });
    doc.text("Precio", 335, doc.y, { width: 90, align: "right" });
    doc.text("Subtotal", 430, doc.y, { width: 120, align: "right" });
    doc.moveTo(40, doc.y + 14).lineTo(550, doc.y + 14).stroke();
    doc.moveDown(0.9);

    const items = Array.isArray(order.items) ? order.items : [];
    items.forEach((item) => {
      const qty = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      const subtotal = qty * price;
      doc.text((item.product || "-").toString(), 40, doc.y, { width: 220 });
      doc.text(qty.toString(), 270, doc.y, { width: 60, align: "right" });
      doc.text(formatMoney(price), 335, doc.y, { width: 90, align: "right" });
      doc.text(formatMoney(subtotal), 430, doc.y, { width: 120, align: "right" });
      doc.moveDown(0.5);
    });

    doc.moveDown(0.8);
    doc.moveTo(330, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown(0.4);
    doc.fontSize(12).text(`Total: ${formatMoney(order.totalAmount)}`, 330, doc.y, {
      width: 220,
      align: "right",
    });

    doc.moveDown(1.2);
    doc.fontSize(9).fillColor("#555").text("Comprobante generado automaticamente por Fint Guard.");

    doc.end();
  });

  return filePath;
};

module.exports = {
  generateInvoicePdf,
};
