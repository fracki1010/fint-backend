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

    const MARGIN_X = 40;
    const PAGE_BOTTOM = doc.page.height - 40;
    const TABLE = {
      productX: 40,
      productW: 220,
      qtyX: 270,
      qtyW: 60,
      priceX: 335,
      priceW: 90,
      subtotalX: 430,
      subtotalW: 120,
    };

    const ensureSpace = (neededHeight = 24) => {
      if (doc.y + neededHeight <= PAGE_BOTTOM) return;
      doc.addPage();
      doc.y = 40;
    };

    const drawTableHeader = () => {
      ensureSpace(28);
      const y = doc.y;
      doc
        .font("Helvetica-Bold")
        .fontSize(10)
        .fillColor("#111")
        .text("Producto", TABLE.productX, y, { width: TABLE.productW })
        .text("Cant.", TABLE.qtyX, y, { width: TABLE.qtyW, align: "right" })
        .text("Precio", TABLE.priceX, y, { width: TABLE.priceW, align: "right" })
        .text("Subtotal", TABLE.subtotalX, y, { width: TABLE.subtotalW, align: "right" });
      doc.moveTo(MARGIN_X, y + 14).lineTo(550, y + 14).strokeColor("#C9CDD4").stroke();
      doc.y = y + 20;
    };

    const drawItemRow = (item = {}) => {
      const qty = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      const subtotal = qty * price;
      const productLabel = (item.product || "-").toString();

      doc.font("Helvetica").fontSize(10).fillColor("#111");
      const productHeight = doc.heightOfString(productLabel, { width: TABLE.productW });
      const rowHeight = Math.max(16, Math.ceil(productHeight) + 2);

      ensureSpace(rowHeight + 6);
      const y = doc.y;

      doc.text(productLabel, TABLE.productX, y, { width: TABLE.productW });
      doc.text(qty.toString(), TABLE.qtyX, y, { width: TABLE.qtyW, align: "right" });
      doc.text(formatMoney(price), TABLE.priceX, y, { width: TABLE.priceW, align: "right" });
      doc.text(formatMoney(subtotal), TABLE.subtotalX, y, {
        width: TABLE.subtotalW,
        align: "right",
      });

      doc.y = y + rowHeight + 4;
    };

    const storeName = store.storeName || "Fint Guard";
    const invoiceRef = order.orderNumber || String(order._id || "N/A");
    const createdAt = order.createdAt
      ? new Date(order.createdAt).toLocaleString()
      : new Date().toLocaleString();

    doc.y = 40;
    doc.font("Helvetica-Bold").fontSize(20).fillColor("#111").text("Factura", MARGIN_X, doc.y);
    doc.moveDown(0.2);
    doc.font("Helvetica-Bold").fontSize(12).text(storeName, MARGIN_X, doc.y);
    doc.font("Helvetica").fontSize(10);
    if (store.taxId) doc.text(`CUIT/NIT: ${store.taxId}`, MARGIN_X, doc.y);
    if (store.phone) doc.text(`Telefono: ${store.phone}`, MARGIN_X, doc.y);
    if (store.email) doc.text(`Email: ${store.email}`, MARGIN_X, doc.y);

    doc.moveDown(0.8);
    doc.font("Helvetica").fontSize(11);
    doc.text(`Nro: ${invoiceRef}`, MARGIN_X, doc.y);
    doc.text(`Fecha: ${createdAt}`, MARGIN_X, doc.y);
    doc.moveDown(0.4);
    doc.text(`Cliente: ${client.name || client.phone || "Consumidor final"}`, MARGIN_X, doc.y);
    if (client.phone) doc.text(`Telefono cliente: ${client.phone}`, MARGIN_X, doc.y);
    if (client.taxId) doc.text(`Documento: ${client.taxId}`, MARGIN_X, doc.y);

    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(11).text("Detalle", MARGIN_X, doc.y);
    doc.moveDown(0.3);

    drawTableHeader();

    const items = Array.isArray(order.items) ? order.items : [];
    items.forEach((item) => {
      drawItemRow(item);
    });

    ensureSpace(48);
    doc.moveDown(0.4);
    doc.moveTo(330, doc.y).lineTo(550, doc.y).strokeColor("#C9CDD4").stroke();
    doc.moveDown(0.4);
    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .fillColor("#111")
      .text(`Total: ${formatMoney(order.totalAmount)}`, 330, doc.y, {
        width: 220,
        align: "right",
      });

    doc.moveDown(1.2);
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#555")
      .text("Comprobante generado automaticamente por Fint Guard.", MARGIN_X, doc.y);

    doc.end();
  });

  return filePath;
};

module.exports = {
  generateInvoicePdf,
};
