/**
 * @fileoverview Unit tests for voucherService.js
 * Tests counter atomicity, voucher generation, voiding, and concurrent access.
 */

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const fs = require("fs");
const path = require("path");

const Voucher = require("../../../src/models/voucher.model");
const VoucherCounter = require("../../../src/models/voucherCounter.model");
const Order = require("../../../src/models/order.model");
const Client = require("../../../src/models/client.model");
const Setting = require("../../../src/models/setting.model");

const {
  generateVoucher,
  generateVouchers,
  getNextNumber,
  previewNextNumber,
  voidVoucher,
  getVouchersByOrder,
  getVoucherById,
  listVouchers,
  getOrCreateCounter,
} = require("../../../src/services/voucherService");

describe("voucherService", () => {
  let mongoServer;
  let tenantId;
  let userId;
  let clientId;
  let orderId;

  // Test PDF output directory
  const testPdfDir = path.join(process.cwd(), "test-comprobantes");

  beforeAll(async () => {
    mongoServer = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);

    // Ensure test PDF directory exists
    if (!fs.existsSync(testPdfDir)) {
      fs.mkdirSync(testPdfDir, { recursive: true });
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();

    // Clean up test PDFs
    if (fs.existsSync(testPdfDir)) {
      fs.rmSync(testPdfDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Clean collections before each test
    await Voucher.deleteMany({});
    await VoucherCounter.deleteMany({});
    await Order.deleteMany({});
    await Client.deleteMany({});
    await Setting.deleteMany({});

    // Create test tenant and user
    tenantId = new mongoose.Types.ObjectId();
    userId = new mongoose.Types.ObjectId();

    // Create test client
    const client = await Client.create({
      tenant: tenantId,
      name: "Test Client",
      phone: "5491111111111",
      taxId: "20-11111111-1",
    });
    clientId = client._id;

    // Create test order
    const order = await Order.create({
      tenant: tenantId,
      client: clientId,
      orderNumber: "VTA-001",
      items: [
        { product: "Test Product", quantity: 2, price: 100 },
      ],
      totalAmount: 200,
      salesStatus: "Confirmada",
      paymentStatus: "Pagado",
      deliveryStatus: "Entregada",
    });
    orderId = order._id;

    // Create test settings
    await Setting.create({
      tenant: tenantId,
      storeName: "Test Store",
      taxId: "30-11111111-1",
      invoicePrefix: "F-",
      deliveryNotePrefix: "R-",
      receiptPrefix: "D-",
      nextInvoiceNumber: 1,
      nextDeliveryNoteNumber: 1,
      nextReceiptNumber: 1,
      annualResetEnabled: true,
      autoGenerateInvoice: true,
    });
  });

  afterEach(async () => {
    await Voucher.deleteMany({});
    await VoucherCounter.deleteMany({});
    await Order.deleteMany({});
    await Client.deleteMany({});
    await Setting.deleteMany({});
  });

  describe("getNextNumber", () => {
    it("should increment counter correctly for new voucher type", async () => {
      const result = await getNextNumber("invoice", tenantId);

      expect(result.sequentialNumber).toBe(1);
      expect(result.fullNumber).toMatch(/^F-000001$/);
      expect(result.year).toBe(new Date().getFullYear());
    });

    it("should increment existing counter sequentially", async () => {
      // First voucher
      await getNextNumber("invoice", tenantId);

      // Second voucher
      const result = await getNextNumber("invoice", tenantId);

      expect(result.sequentialNumber).toBe(2);
      expect(result.fullNumber).toMatch(/^F-000002$/);
    });

    it("should handle concurrent counter increments without duplicates", async () => {
      const promises = [];
      for (let i = 0; i < 20; i++) {
        promises.push(getNextNumber("invoice", tenantId));
      }

      const results = await Promise.all(promises);
      const numbers = results.map((r) => r.sequentialNumber);

      // Check all numbers are unique
      const uniqueNumbers = new Set(numbers);
      expect(uniqueNumbers.size).toBe(20);

      // Check numbers are sequential from 1 to 20
      const sortedNumbers = [...uniqueNumbers].sort((a, b) => a - b);
      expect(sortedNumbers).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    });

    it("should reset counter on year change when annual reset is enabled", async () => {
      // Create counter for previous year
      const previousYear = new Date().getFullYear() - 1;
      await VoucherCounter.create({
        tenant: tenantId,
        type: "invoice",
        year: previousYear,
        prefix: "F-",
        lastNumber: 999,
      });

      // Get next number should create new counter for current year
      const result = await getNextNumber("invoice", tenantId);

      // Should start from 1 for new year
      expect(result.sequentialNumber).toBe(1);
      expect(result.year).toBe(new Date().getFullYear());
    });

    it("should use correct prefix for different voucher types", async () => {
      const invoice = await getNextNumber("invoice", tenantId);
      const deliveryNote = await getNextNumber("delivery_note", tenantId);
      const receipt = await getNextNumber("receipt", tenantId);

      expect(invoice.fullNumber).toMatch(/^F-/);
      expect(deliveryNote.fullNumber).toMatch(/^R-/);
      expect(receipt.fullNumber).toMatch(/^D-/);
    });
  });

  describe("previewNextNumber", () => {
    it("should preview next number without incrementing", async () => {
      // Create counter with lastNumber 5
      await VoucherCounter.create({
        tenant: tenantId,
        type: "invoice",
        year: new Date().getFullYear(),
        prefix: "F-",
        lastNumber: 5,
      });

      const preview = await previewNextNumber("invoice", tenantId);

      expect(preview.sequentialNumber).toBe(6);
      expect(preview.fullNumber).toBe("F-000006");

      // Counter should not be incremented
      const counter = await VoucherCounter.findOne({
        tenant: tenantId,
        type: "invoice",
      });
      expect(counter.lastNumber).toBe(5);
    });
  });

  describe("generateVoucher", () => {
    it("should create voucher with correct data", async () => {
      const voucher = await generateVoucher(orderId, "invoice", userId, {
        tenantId,
      });

      expect(voucher).toBeTruthy();
      expect(voucher.order.toString()).toBe(orderId.toString());
      expect(voucher.type).toBe("invoice");
      expect(voucher.status).toBe("active");
      expect(voucher.number).toMatch(/^F-\d{6}$/);
      expect(voucher.sequentialNumber).toBe(1);
      expect(voucher.createdBy.toString()).toBe(userId.toString());
      expect(voucher.tenant.toString()).toBe(tenantId.toString());
      expect(voucher.filePath).toBeTruthy();
      expect(voucher.fileUrl).toBeTruthy();
    });

    it("should generate PDF file", async () => {
      const voucher = await generateVoucher(orderId, "invoice", userId, {
        tenantId,
      });

      expect(fs.existsSync(voucher.filePath)).toBe(true);
      const stats = fs.statSync(voucher.filePath);
      expect(stats.size).toBeGreaterThan(0);
    });

    it("should skip generation if active voucher already exists for order/type", async () => {
      // First generation
      const voucher1 = await generateVoucher(orderId, "invoice", userId, {
        tenantId,
        skipIfExists: true,
      });

      // Second generation should return existing
      const voucher2 = await generateVoucher(orderId, "invoice", userId, {
        tenantId,
        skipIfExists: true,
      });

      expect(voucher1._id.toString()).toBe(voucher2._id.toString());
    });

    it("should create new voucher if skipIfExists is false", async () => {
      // First generation
      await generateVoucher(orderId, "invoice", userId, {
        tenantId,
        skipIfExists: true,
      });

      // Second generation with skipIfExists=false should create new
      const voucher2 = await generateVoucher(orderId, "invoice", userId, {
        tenantId,
        skipIfExists: false,
      });

      const vouchers = await Voucher.find({ order: orderId, type: "invoice" });
      expect(vouchers).toHaveLength(2);
      expect(voucher2.sequentialNumber).toBe(2);
    });

    it("should throw error for invalid voucher type", async () => {
      await expect(
        generateVoucher(orderId, "invalid_type", userId, { tenantId })
      ).rejects.toThrow("INVALID_VOUCHER_TYPE");
    });

    it("should throw error when tenant is missing", async () => {
      await expect(
        generateVoucher(orderId, "invoice", userId, {})
      ).rejects.toThrow("TENANT_REQUIRED");
    });

    it("should throw error for non-existent order", async () => {
      const fakeOrderId = new mongoose.Types.ObjectId();
      await expect(
        generateVoucher(fakeOrderId, "invoice", userId, { tenantId })
      ).rejects.toThrow("ORDER_NOT_FOUND");
    });

    it("should generate different voucher types with correct content", async () => {
      const invoice = await generateVoucher(orderId, "invoice", userId, { tenantId });
      const deliveryNote = await generateVoucher(orderId, "delivery_note", userId, { tenantId });
      const receipt = await generateVoucher(orderId, "receipt", userId, { tenantId });

      expect(invoice.type).toBe("invoice");
      expect(invoice.number).toMatch(/^F-/);

      expect(deliveryNote.type).toBe("delivery_note");
      expect(deliveryNote.number).toMatch(/^R-/);

      expect(receipt.type).toBe("receipt");
      expect(receipt.number).toMatch(/^D-/);
    });
  });

  describe("generateVouchers", () => {
    it("should generate multiple vouchers in parallel", async () => {
      const result = await generateVouchers(
        orderId,
        ["invoice", "delivery_note", "receipt"],
        userId,
        { tenantId }
      );

      expect(result.vouchers).toHaveLength(3);
      expect(result.totalGenerated).toBe(3);
      expect(result.totalRequested).toBe(3);
      expect(result.errors).toBeNull();

      // Verify all types generated
      const types = result.vouchers.map((v) => v.type).sort();
      expect(types).toEqual(["delivery_note", "invoice", "receipt"]);
    });

    it("should handle partial failures gracefully", async () => {
      // Delete order to cause failure for some vouchers
      const result = await generateVouchers(
        new mongoose.Types.ObjectId(),
        ["invoice", "delivery_note"],
        userId,
        { tenantId }
      );

      expect(result.vouchers).toHaveLength(0);
      expect(result.errors).toHaveLength(2);
      expect(result.totalGenerated).toBe(0);
    });

    it("should throw error for empty types array", async () => {
      await expect(
        generateVouchers(orderId, [], userId, { tenantId })
      ).rejects.toThrow("INVALID_TYPES");
    });

    it("should throw error for invalid voucher types", async () => {
      await expect(
        generateVouchers(orderId, ["invoice", "invalid"], userId, { tenantId })
      ).rejects.toThrow("INVALID_VOUCHER_TYPES");
    });
  });

  describe("voidVoucher", () => {
    it("should void voucher with reason", async () => {
      const voucher = await generateVoucher(orderId, "invoice", userId, { tenantId });

      const voided = await voidVoucher(voucher._id, "Error en datos del cliente", userId);

      expect(voided.status).toBe("voided");
      expect(voided.voidReason).toBe("Error en datos del cliente");
      expect(voided.voidedAt).toBeTruthy();
    });

    it("should throw error when reason is too short", async () => {
      const voucher = await generateVoucher(orderId, "invoice", userId, { tenantId });

      await expect(
        voidVoucher(voucher._id, "AB", userId)
      ).rejects.toThrow("VOID_REASON_REQUIRED");
    });

    it("should throw error when voucher not found", async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await expect(
        voidVoucher(fakeId, "Test reason", userId)
      ).rejects.toThrow("VOUCHER_NOT_FOUND");
    });

    it("should throw error when voucher already voided", async () => {
      const voucher = await generateVoucher(orderId, "invoice", userId, { tenantId });
      await voidVoucher(voucher._id, "First void", userId);

      await expect(
        voidVoucher(voucher._id, "Second void", userId)
      ).rejects.toThrow("ALREADY_VOIDED");
    });
  });

  describe("getVouchersByOrder", () => {
    it("should return vouchers for order", async () => {
      await generateVoucher(orderId, "invoice", userId, { tenantId });
      await generateVoucher(orderId, "receipt", userId, { tenantId });

      const vouchers = await getVouchersByOrder(orderId);

      expect(vouchers).toHaveLength(2);
    });

    it("should exclude voided vouchers by default", async () => {
      const voucher = await generateVoucher(orderId, "invoice", userId, { tenantId });
      await generateVoucher(orderId, "receipt", userId, { tenantId });
      await voidVoucher(voucher._id, "Test", userId);

      const vouchers = await getVouchersByOrder(orderId);

      expect(vouchers).toHaveLength(1);
      expect(vouchers[0].type).toBe("receipt");
    });

    it("should include voided vouchers when requested", async () => {
      const voucher = await generateVoucher(orderId, "invoice", userId, { tenantId });
      await generateVoucher(orderId, "receipt", userId, { tenantId });
      await voidVoucher(voucher._id, "Test", userId);

      const vouchers = await getVouchersByOrder(orderId, { includeVoided: true });

      expect(vouchers).toHaveLength(2);
    });

    it("should filter by tenant when specified", async () => {
      await generateVoucher(orderId, "invoice", userId, { tenantId });

      const vouchers = await getVouchersByOrder(orderId, { tenantId });

      expect(vouchers).toHaveLength(1);
    });
  });

  describe("getVoucherById", () => {
    it("should return voucher by ID", async () => {
      const created = await generateVoucher(orderId, "invoice", userId, { tenantId });

      const found = await getVoucherById(created._id, tenantId);

      expect(found._id.toString()).toBe(created._id.toString());
    });

    it("should throw error when voucher not found", async () => {
      const fakeId = new mongoose.Types.ObjectId();

      await expect(
        getVoucherById(fakeId, tenantId)
      ).rejects.toThrow("VOUCHER_NOT_FOUND");
    });
  });

  describe("listVouchers", () => {
    beforeEach(async () => {
      // Create multiple vouchers for filtering tests
      await generateVoucher(orderId, "invoice", userId, { tenantId });
      await generateVoucher(orderId, "delivery_note", userId, { tenantId });
      await generateVoucher(orderId, "receipt", userId, { tenantId });
    });

    it("should list all vouchers with pagination", async () => {
      const result = await listVouchers({ tenantId }, { page: 1, limit: 10 });

      expect(result.vouchers).toHaveLength(3);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.hasNextPage).toBe(false);
    });

    it("should filter by type", async () => {
      const result = await listVouchers({ tenantId, type: "invoice" });

      expect(result.vouchers).toHaveLength(1);
      expect(result.vouchers[0].type).toBe("invoice");
    });

    it("should filter by status", async () => {
      const invoice = await Voucher.findOne({ type: "invoice" });
      await voidVoucher(invoice._id, "Test", userId);

      const result = await listVouchers({ tenantId, status: "voided" });

      expect(result.vouchers).toHaveLength(1);
      expect(result.vouchers[0].status).toBe("voided");
    });

    it("should filter by order", async () => {
      const result = await listVouchers({ tenantId, orderId });

      expect(result.vouchers).toHaveLength(3);
    });

    it("should filter by client name", async () => {
      const result = await listVouchers({ tenantId, clientName: "Test Client" });

      expect(result.vouchers.length).toBeGreaterThan(0);
    });

    it("should handle date range filtering", async () => {
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);

      const result = await listVouchers({
        tenantId,
        dateFrom: yesterday.toISOString(),
        dateTo: tomorrow.toISOString(),
      });

      expect(result.vouchers.length).toBeGreaterThan(0);
    });

    it("should respect pagination limits", async () => {
      const result = await listVouchers({ tenantId }, { page: 1, limit: 2 });

      expect(result.vouchers).toHaveLength(2);
      expect(result.total).toBe(3);
      expect(result.hasNextPage).toBe(true);
    });
  });

  describe("getOrCreateCounter", () => {
    it("should create new counter if not exists", async () => {
      const counter = await getOrCreateCounter(tenantId, "invoice", 2026);

      expect(counter).toBeTruthy();
      expect(counter.tenant.toString()).toBe(tenantId.toString());
      expect(counter.type).toBe("invoice");
      expect(counter.year).toBe(2026);
      expect(counter.prefix).toBe("F-");
    });

    it("should return existing counter if exists", async () => {
      await VoucherCounter.create({
        tenant: tenantId,
        type: "invoice",
        year: 2026,
        prefix: "CUSTOM-",
        lastNumber: 50,
      });

      const counter = await getOrCreateCounter(tenantId, "invoice", 2026);

      expect(counter.prefix).toBe("CUSTOM-");
      expect(counter.lastNumber).toBe(50);
    });
  });

  describe("High concurrency stress test", () => {
    it("should handle 100 concurrent voucher generations without duplicates", async () => {
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          generateVoucher(orderId, "invoice", userId, { tenantId, skipIfExists: false })
            .catch(() => null) // Ignore errors, just check for duplicates
        );
      }

      const results = await Promise.all(promises);
      const successful = results.filter((r) => r !== null);

      // Get all sequential numbers
      const numbers = successful.map((v) => v.sequentialNumber);
      const uniqueNumbers = new Set(numbers);

      // All successful generations should have unique numbers
      expect(uniqueNumbers.size).toBe(successful.length);

      // Verify counter reflects total
      const counter = await VoucherCounter.findOne({
        tenant: tenantId,
        type: "invoice",
      });
      expect(counter.lastNumber).toBe(successful.length);
    });
  });
});
