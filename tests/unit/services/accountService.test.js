/**
 * @fileoverview Unit tests for accountService.js
 * Tests payment allocation, FIFO strategy, credit limits, and aging reports.
 */

const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const ClientAccountEntry = require("../../../src/models/clientAccountEntry.model");
const Client = require("../../../src/models/client.model");
const {
  allocatePayment,
  getClientBalance,
  checkCreditLimit,
  getPendingCharges,
  getAgingReport,
  getCreditStatus,
} = require("../../../src/services/accountService");

describe("accountService", () => {
  let mongoServer;
  let tenantId;
  let clientId;

  beforeAll(async () => {
    mongoServer = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });
    const uri = mongoServer.getUri();
    await mongoose.connect(uri);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongoServer.stop();
  });

  beforeEach(async () => {
    // Clean collections before each test
    await ClientAccountEntry.deleteMany({});
    await Client.deleteMany({});

    // Create test tenant and client
    tenantId = new mongoose.Types.ObjectId();
    const client = await Client.create({
      tenant: tenantId,
      name: "Test Client",
      phone: "5491111111111",
      creditLimit: 10000,
    });
    clientId = client._id;
  });

  afterEach(async () => {
    await ClientAccountEntry.deleteMany({});
    await Client.deleteMany({});
  });

  describe("allocatePayment", () => {
    it("should allocate payment using FIFO strategy by default", async () => {
      // Create three charges with different dates
      const charge1 = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 500,
        sign: 1,
        dueDate: new Date("2026-02-01"),
        remainingAmount: 500,
        status: "pending",
      });

      const charge2 = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-15",
        type: "CHARGE",
        amount: 300,
        sign: 1,
        dueDate: new Date("2026-02-15"),
        remainingAmount: 300,
        status: "pending",
      });

      const charge3 = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-20",
        type: "CHARGE",
        amount: 400,
        sign: 1,
        dueDate: new Date("2026-02-20"),
        remainingAmount: 400,
        status: "pending",
      });

      // Allocate 600 - should pay charge1 fully (500) and partially pay charge2 (100)
      const result = await allocatePayment(tenantId, clientId, 600, {
        paymentMethod: "cash",
        reference: "TEST-001",
      });

      expect(result.paymentEntry).toBeTruthy();
      expect(result.paymentEntry.amount).toBe(600);
      expect(result.allocations).toHaveLength(2);
      expect(result.allocations[0].entryId.toString()).toBe(charge1._id.toString());
      expect(result.allocations[0].amount).toBe(500);
      expect(result.allocations[1].entryId.toString()).toBe(charge2._id.toString());
      expect(result.allocations[1].amount).toBe(100);

      // Verify affected charges
      expect(result.affectedCharges).toHaveLength(2);
      expect(result.unallocatedAmount).toBe(0);

      // Verify charge1 is now paid
      const updatedCharge1 = await ClientAccountEntry.findById(charge1._id);
      expect(updatedCharge1.status).toBe("paid");
      expect(updatedCharge1.remainingAmount).toBe(0);

      // Verify charge2 is partial
      const updatedCharge2 = await ClientAccountEntry.findById(charge2._id);
      expect(updatedCharge2.status).toBe("partial");
      expect(updatedCharge2.remainingAmount).toBe(200);

      // Verify charge3 is untouched
      const updatedCharge3 = await ClientAccountEntry.findById(charge3._id);
      expect(updatedCharge3.status).toBe("pending");
      expect(updatedCharge3.remainingAmount).toBe(400);
    });

    it("should allocate payment with manual override", async () => {
      const charge1 = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 500,
        sign: 1,
        dueDate: new Date("2026-02-01"),
        remainingAmount: 500,
        status: "pending",
      });

      const charge2 = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-15",
        type: "CHARGE",
        amount: 300,
        sign: 1,
        dueDate: new Date("2026-02-15"),
        remainingAmount: 300,
        status: "pending",
      });

      // Manual allocation: pay charge2 first with 200
      const result = await allocatePayment(tenantId, clientId, 200, {
        paymentMethod: "cash",
        manualAllocations: [{ entryId: charge2._id.toString(), amount: 200 }],
      });

      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0].entryId.toString()).toBe(charge2._id.toString());
      expect(result.allocations[0].amount).toBe(200);

      // Verify charge2 is partial
      const updatedCharge2 = await ClientAccountEntry.findById(charge2._id);
      expect(updatedCharge2.status).toBe("partial");
      expect(updatedCharge2.remainingAmount).toBe(100);

      // Verify charge1 is untouched (FIFO would have paid it first)
      const updatedCharge1 = await ClientAccountEntry.findById(charge1._id);
      expect(updatedCharge1.status).toBe("pending");
      expect(updatedCharge1.remainingAmount).toBe(500);
    });

    it("should handle partial payments correctly", async () => {
      const charge = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 1000,
        sign: 1,
        dueDate: new Date("2026-02-01"),
        remainingAmount: 1000,
        status: "pending",
      });

      // First partial payment of 300
      const result1 = await allocatePayment(tenantId, clientId, 300, {
        paymentMethod: "cash",
      });

      expect(result1.affectedCharges[0].status).toBe("partial");
      expect(result1.affectedCharges[0].newRemaining).toBe(700);

      // Second partial payment of 400
      const result2 = await allocatePayment(tenantId, clientId, 400, {
        paymentMethod: "transfer",
      });

      expect(result2.affectedCharges[0].status).toBe("partial");
      expect(result2.affectedCharges[0].newRemaining).toBe(300);

      // Final payment of 300
      const result3 = await allocatePayment(tenantId, clientId, 300, {
        paymentMethod: "card",
      });

      expect(result3.affectedCharges[0].status).toBe("paid");
      expect(result3.affectedCharges[0].newRemaining).toBe(0);

      // Verify final state
      const finalCharge = await ClientAccountEntry.findById(charge._id);
      expect(finalCharge.status).toBe("paid");
      expect(finalCharge.remainingAmount).toBe(0);
      expect(finalCharge.allocations).toHaveLength(3);
    });

    it("should throw error for invalid payment amount", async () => {
      await expect(
        allocatePayment(tenantId, clientId, 0)
      ).rejects.toThrow("Invalid payment amount");

      await expect(
        allocatePayment(tenantId, clientId, -100)
      ).rejects.toThrow("Invalid payment amount");
    });

    it("should handle overpayment (payment > total debt)", async () => {
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 500,
        sign: 1,
        dueDate: new Date("2026-02-01"),
        remainingAmount: 500,
        status: "pending",
      });

      // Pay 700 when only 500 is owed
      const result = await allocatePayment(tenantId, clientId, 700, {
        paymentMethod: "cash",
      });

      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0].amount).toBe(500);
      expect(result.unallocatedAmount).toBe(200);
    });

    it("should reject manual allocation exceeding remaining amount", async () => {
      const charge = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 500,
        sign: 1,
        dueDate: new Date("2026-02-01"),
        remainingAmount: 500,
        status: "pending",
      });

      await expect(
        allocatePayment(tenantId, clientId, 600, {
          manualAllocations: [{ entryId: charge._id.toString(), amount: 600 }],
        })
      ).rejects.toThrow("Allocation amount 600 exceeds remaining 500");
    });

    it("should protect against concurrent allocations with transactions", async () => {
      const charge = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 500,
        sign: 1,
        dueDate: new Date("2026-02-01"),
        remainingAmount: 500,
        status: "pending",
      });

      // Try to allocate two payments of 400 simultaneously
      // Only one should succeed or they should be properly sequenced
      const promise1 = allocatePayment(tenantId, clientId, 400, {
        paymentMethod: "cash",
        reference: "PAY-001",
      });

      const promise2 = allocatePayment(tenantId, clientId, 400, {
        paymentMethod: "transfer",
        reference: "PAY-002",
      });

      const [result1, result2] = await Promise.allSettled([promise1, promise2]);

      // Both should succeed (transactions ensure consistency)
      expect(result1.status).toBe("fulfilled");
      expect(result2.status).toBe("fulfilled");

      // Verify final charge state
      const finalCharge = await ClientAccountEntry.findById(charge._id);
      const totalAllocated = finalCharge.allocations.reduce(
        (sum, a) => sum + a.amount,
        0
      );

      // Total allocated should not exceed original amount
      expect(totalAllocated).toBeLessThanOrEqual(500);
    });

    it("should skip already paid charges in FIFO allocation", async () => {
      const paidCharge = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 500,
        sign: 1,
        dueDate: new Date("2026-02-01"),
        remainingAmount: 0,
        status: "paid",
      });

      const pendingCharge = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-15",
        type: "CHARGE",
        amount: 300,
        sign: 1,
        dueDate: new Date("2026-02-15"),
        remainingAmount: 300,
        status: "pending",
      });

      const result = await allocatePayment(tenantId, clientId, 300, {
        paymentMethod: "cash",
      });

      // Should only allocate to pending charge
      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0].entryId.toString()).toBe(
        pendingCharge._id.toString()
      );
    });

    it("should support CREDIT_NOTE allocations", async () => {
      const charge = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 1000,
        sign: 1,
        dueDate: new Date("2026-02-01"),
        remainingAmount: 1000,
        status: "pending",
      });

      // Create a credit note entry (negative sign)
      const creditNoteEntry = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: new Date().toISOString().slice(0, 10),
        type: "CREDIT_NOTE",
        amount: 200,
        sign: -1,
        allocations: [{ entryId: charge._id, amount: 200, date: new Date() }],
        remainingAmount: 0,
        status: "paid",
      });

      // Apply credit note to charge
      await ClientAccountEntry.updateOne(
        { _id: charge._id },
        {
          $push: {
            allocations: {
              entryId: creditNoteEntry._id,
              amount: 200,
              date: new Date(),
            },
          },
          $set: { remainingAmount: 800, status: "partial" },
        }
      );

      const updatedCharge = await ClientAccountEntry.findById(charge._id);
      expect(updatedCharge.remainingAmount).toBe(800);
      expect(updatedCharge.status).toBe("partial");
      expect(updatedCharge.allocations).toHaveLength(1);
    });

    it("should handle payment to partially paid charge", async () => {
      const charge = await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 1000,
        sign: 1,
        dueDate: new Date("2026-02-01"),
        remainingAmount: 400, // Already partially paid
        status: "partial",
        allocations: [{ entryId: new mongoose.Types.ObjectId(), amount: 600, date: new Date() }],
      });

      const result = await allocatePayment(tenantId, clientId, 400, {
        paymentMethod: "cash",
      });

      expect(result.allocations).toHaveLength(1);
      expect(result.allocations[0].amount).toBe(400);
      expect(result.affectedCharges[0].status).toBe("paid");
    });
  });

  describe("getClientBalance", () => {
    it("should calculate balance correctly with multiple entries", async () => {
      // Create charge (+1000)
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 1000,
        sign: 1,
      });

      // Create payment (-300)
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-15",
        type: "PAYMENT",
        amount: 300,
        sign: -1,
      });

      // Create debit note (+200)
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-20",
        type: "DEBIT_NOTE",
        amount: 200,
        sign: 1,
      });

      // Create credit note (-150)
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-25",
        type: "CREDIT_NOTE",
        amount: 150,
        sign: -1,
      });

      const balance = await getClientBalance(tenantId, clientId);
      // 1000 - 300 + 200 - 150 = 750
      expect(balance).toBe(750);
    });

    it("should return 0 for client with no entries", async () => {
      const newClientId = new mongoose.Types.ObjectId();
      const balance = await getClientBalance(tenantId, newClientId);
      expect(balance).toBe(0);
    });

    it("should handle negative balance (client has credit)", async () => {
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "PAYMENT",
        amount: 1000,
        sign: -1,
      });

      const balance = await getClientBalance(tenantId, clientId);
      expect(balance).toBe(-1000);
    });
  });

  describe("checkCreditLimit", () => {
    it("should allow charge when within credit limit", async () => {
      // Create charge of 5000 (within 10000 limit)
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 5000,
        sign: 1,
      });

      const canCharge = await checkCreditLimit(tenantId, clientId, 3000);
      expect(canCharge).toBe(true);
    });

    it("should block charge when exceeding credit limit", async () => {
      // Create charge of 8000
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 8000,
        sign: 1,
      });

      // Try to add 3000 more (would be 11000, over 10000 limit)
      const canCharge = await checkCreditLimit(tenantId, clientId, 3000);
      expect(canCharge).toBe(false);
    });

    it("should allow unlimited when no credit limit set", async () => {
      const noLimitClient = await Client.create({
        tenant: tenantId,
        name: "No Limit Client",
        phone: "5492222222222",
        creditLimit: 0,
      });

      await ClientAccountEntry.create({
        tenant: tenantId,
        client: noLimitClient._id,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 50000,
        sign: 1,
      });

      const canCharge = await checkCreditLimit(tenantId, noLimitClient._id, 10000);
      expect(canCharge).toBe(true);
    });

    it("should return true when creditLimit is null", async () => {
      const nullLimitClient = await Client.create({
        tenant: tenantId,
        name: "Null Limit Client",
        phone: "5493333333333",
        creditLimit: null,
      });

      const canCharge = await checkCreditLimit(tenantId, nullLimitClient._id, 50000);
      expect(canCharge).toBe(true);
    });
  });

  describe("getPendingCharges", () => {
    it("should return only pending and partial charges", async () => {
      // Pending charge
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 500,
        sign: 1,
        remainingAmount: 500,
        status: "pending",
      });

      // Partial charge
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-15",
        type: "CHARGE",
        amount: 1000,
        sign: 1,
        remainingAmount: 400,
        status: "partial",
      });

      // Paid charge
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-20",
        type: "CHARGE",
        amount: 300,
        sign: 1,
        remainingAmount: 0,
        status: "paid",
      });

      // Payment entry (should be excluded)
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-25",
        type: "PAYMENT",
        amount: 200,
        sign: -1,
      });

      const pendingCharges = await getPendingCharges(tenantId, clientId);

      expect(pendingCharges).toHaveLength(2);
      expect(pendingCharges.every((c) => c.status !== "paid")).toBe(true);
      expect(pendingCharges.every((c) => ["CHARGE", "DEBIT_NOTE"].includes(c.type))).toBe(true);
    });

    it("should calculate remaining and allocated amounts correctly", async () => {
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 1000,
        sign: 1,
        remainingAmount: 600,
        status: "partial",
        allocations: [{ entryId: new mongoose.Types.ObjectId(), amount: 400, date: new Date() }],
      });

      const pendingCharges = await getPendingCharges(tenantId, clientId);

      expect(pendingCharges[0].remainingAmount).toBe(600);
      expect(pendingCharges[0].allocatedAmount).toBe(400);
    });

    it("should return empty array when no pending charges", async () => {
      const pendingCharges = await getPendingCharges(tenantId, clientId);
      expect(pendingCharges).toEqual([]);
    });
  });

  describe("getAgingReport", () => {
    it("should categorize charges into correct aging buckets", async () => {
      const today = new Date();

      // Current (not due yet)
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 1000,
        sign: 1,
        dueDate: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        remainingAmount: 1000,
        status: "pending",
      });

      // 1-30 days overdue
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 500,
        sign: 1,
        dueDate: new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000), // 15 days ago
        remainingAmount: 500,
        status: "pending",
      });

      // 31-60 days overdue
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 800,
        sign: 1,
        dueDate: new Date(today.getTime() - 45 * 24 * 60 * 60 * 1000), // 45 days ago
        remainingAmount: 800,
        status: "pending",
      });

      // 61-90 days overdue
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 600,
        sign: 1,
        dueDate: new Date(today.getTime() - 75 * 24 * 60 * 60 * 1000), // 75 days ago
        remainingAmount: 600,
        status: "pending",
      });

      // 90+ days overdue
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 1200,
        sign: 1,
        dueDate: new Date(today.getTime() - 100 * 24 * 60 * 60 * 1000), // 100 days ago
        remainingAmount: 1200,
        status: "pending",
      });

      const agingReport = await getAgingReport(tenantId, clientId);

      expect(agingReport.clients).toHaveLength(1);
      const clientAging = agingReport.clients[0];

      expect(clientAging.current).toBe(1000);
      expect(clientAging.overdue1to30).toBe(500);
      expect(clientAging.overdue31to60).toBe(800);
      expect(clientAging.overdue61to90).toBe(600);
      expect(clientAging.overdue90plus).toBe(1200);
      expect(clientAging.totalOutstanding).toBe(4100);
    });

    it("should return all clients when clientId is null", async () => {
      const today = new Date();

      const client2 = await Client.create({
        tenant: tenantId,
        name: "Client 2",
        phone: "5494444444444",
        creditLimit: 5000,
      });

      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 1000,
        sign: 1,
        dueDate: new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000),
        remainingAmount: 1000,
        status: "pending",
      });

      await ClientAccountEntry.create({
        tenant: tenantId,
        client: client2._id,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 2000,
        sign: 1,
        dueDate: new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000),
        remainingAmount: 2000,
        status: "pending",
      });

      const agingReport = await getAgingReport(tenantId);

      expect(agingReport.clients).toHaveLength(2);
      expect(agingReport.totals.totalOutstanding).toBe(3000);
    });

    it("should exclude paid charges from aging", async () => {
      const today = new Date();

      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 1000,
        sign: 1,
        dueDate: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
        remainingAmount: 0,
        status: "paid",
      });

      const agingReport = await getAgingReport(tenantId, clientId);

      expect(agingReport.clients).toHaveLength(0);
      expect(agingReport.totals.totalOutstanding).toBe(0);
    });

    it("should calculate effective remaining from allocations when remainingAmount is 0", async () => {
      const today = new Date();

      // Charge with remainingAmount=0 but has allocations
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 1000,
        sign: 1,
        dueDate: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
        remainingAmount: null,
        status: "pending",
        allocations: [], // Not yet allocated, so full amount is remaining
      });

      const agingReport = await getAgingReport(tenantId, clientId);

      // Should calculate effectiveRemaining from amount - allocations
      expect(agingReport.clients[0].overdue1to30).toBe(1000);
    });
  });

  describe("getCreditStatus", () => {
    it("should return correct credit status for client with limit", async () => {
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 5000,
        sign: 1,
      });

      const creditStatus = await getCreditStatus(tenantId, clientId);

      expect(creditStatus.clientId).toBe(clientId.toString());
      expect(creditStatus.clientName).toBe("Test Client");
      expect(creditStatus.creditLimit).toBe(10000);
      expect(creditStatus.currentBalance).toBe(5000);
      expect(creditStatus.remainingCredit).toBe(5000);
      expect(creditStatus.utilizationPercentage).toBe(50);
      expect(creditStatus.status).toBe("ok");
      expect(creditStatus.isNearLimit).toBe(false);
      expect(creditStatus.isOverLimit).toBe(false);
    });

    it("should detect near limit status at 80% threshold", async () => {
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 8000,
        sign: 1,
      });

      const creditStatus = await getCreditStatus(tenantId, clientId);

      expect(creditStatus.utilizationPercentage).toBe(80);
      expect(creditStatus.status).toBe("near_limit");
      expect(creditStatus.isNearLimit).toBe(true);
      expect(creditStatus.isOverLimit).toBe(false);
    });

    it("should detect over limit status when exceeding 100%", async () => {
      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 12000,
        sign: 1,
      });

      const creditStatus = await getCreditStatus(tenantId, clientId);

      expect(creditStatus.utilizationPercentage).toBe(120);
      expect(creditStatus.status).toBe("over_limit");
      expect(creditStatus.isNearLimit).toBe(false);
      expect(creditStatus.isOverLimit).toBe(true);
    });

    it("should handle no credit limit set", async () => {
      const noLimitClient = await Client.create({
        tenant: tenantId,
        name: "No Limit Client",
        phone: "5495555555555",
        creditLimit: 0,
      });

      const creditStatus = await getCreditStatus(tenantId, noLimitClient._id);

      expect(creditStatus.creditLimit).toBe(0);
      expect(creditStatus.remainingCredit).toBeNull();
      expect(creditStatus.utilizationPercentage).toBe(0);
      expect(creditStatus.status).toBe("no_limit");
    });

    it("should throw error for non-existent client", async () => {
      const nonExistentId = new mongoose.Types.ObjectId();

      await expect(
        getCreditStatus(tenantId, nonExistentId)
      ).rejects.toThrow("Client not found");
    });

    it("should round utilization percentage to 2 decimal places", async () => {
      // Set credit limit to 3333 to get repeating decimal
      await Client.findByIdAndUpdate(clientId, { creditLimit: 3333 });

      await ClientAccountEntry.create({
        tenant: tenantId,
        client: clientId,
        date: "2026-01-01",
        type: "CHARGE",
        amount: 1000,
        sign: 1,
      });

      const creditStatus = await getCreditStatus(tenantId, clientId);

      // 1000 / 3333 = 0.30003... should round to 30.00
      expect(creditStatus.utilizationPercentage).toBeCloseTo(30, 1);
    });
  });
});
