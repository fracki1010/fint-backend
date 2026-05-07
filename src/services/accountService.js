/**
 * @fileoverview Account Service - Business logic for client current account operations
 * 
 * This module handles:
 * - Payment allocation with FIFO and manual strategies
 * - Client balance calculations
 * - Credit limit enforcement
 * - Aging report generation
 * - MongoDB transaction support for data consistency
 * 
 * @module services/accountService
 */

const mongoose = require("mongoose");
const ClientAccountEntry = require("../models/clientAccountEntry.model");
const Client = require("../models/client.model");

/**
 * Allocate a payment to pending charges
 * 
 * Supports two allocation strategies:
 * 1. **FIFO (default)**: Automatically allocates to oldest charges first
 * 2. **Manual**: Allocates according to specified amounts per charge
 * 
 * Uses MongoDB transactions to ensure data consistency during concurrent operations.
 * 
 * @param {string} tenantId - Tenant ID for multi-tenant isolation
 * @param {string} clientId - Client ID receiving the payment
 * @param {number} paymentAmount - Total payment amount (must be > 0)
 * @param {Object} options - Allocation options
 * @param {string} [options.paymentMethod=""] - Payment method (cash, card, transfer, check, other)
 * @param {string} [options.reference=""] - Payment reference/tracking number
 * @param {string} [options.notes=""] - Additional notes about the payment
 * @param {string} [options.createdBy=null] - User ID who created the payment
 * @param {Array<{entryId: string, amount: number}>} [options.manualAllocations=null] - Manual allocation overrides
 * @returns {Promise<AllocationResult>} Allocation result with payment entry and affected charges
 * @throws {Error} When payment amount is invalid or allocation exceeds remaining amounts
 * 
 * @example
 * // FIFO allocation
 * const result = await allocatePayment(tenantId, clientId, 1000, {
 *   paymentMethod: 'cash',
 *   reference: 'CASH-001'
 * });
 * 
 * @example
 * // Manual allocation
 * const result = await allocatePayment(tenantId, clientId, 800, {
 *   paymentMethod: 'transfer',
 *   manualAllocations: [
 *     { entryId: 'charge-1', amount: 500 },
 *     { entryId: 'charge-2', amount: 300 }
 *   ]
 * });
 */
async function allocatePayment(
  tenantId,
  clientId,
  paymentAmount,
  options = {}
) {
  const session = await mongoose.startSession();
  let sessionClosed = false;

  try {
    session.startTransaction();

    const {
      paymentMethod = "",
      reference = "",
      notes = "",
      createdBy = null,
      manualAllocations = null,
    } = options;

    // Validate payment amount
    if (!paymentAmount || paymentAmount <= 0) {
      throw new Error("Invalid payment amount");
    }

    // Get pending charges sorted by date (FIFO)
    const pendingCharges = await ClientAccountEntry.find({
      tenant: tenantId,
      client: clientId,
      type: { $in: ["CHARGE", "DEBIT_NOTE"] },
      $or: [
        { status: { $in: ["pending", "partial"] } },
        { status: null },
      ],
    })
      .sort({ date: 1, createdAt: 1 })
      .session(session);

    // Calculate remaining amounts for each charge
    const chargesWithRemaining = pendingCharges.map((charge) => {
      const remaining =
        charge.remainingAmount ??
        charge.amount -
          (charge.allocations?.reduce((sum, alloc) => sum + alloc.amount, 0) ||
            0);
      return { charge, remaining };
    });

    // Determine allocations
    let allocations = [];
    let remainingPayment = paymentAmount;

    if (manualAllocations && manualAllocations.length > 0) {
      // Manual allocation mode
      for (const manualAlloc of manualAllocations) {
        const chargeInfo = chargesWithRemaining.find(
          (c) => String(c.charge._id) === String(manualAlloc.entryId)
        );

        if (!chargeInfo) {
          throw new Error(
            `Charge ${manualAlloc.entryId} not found or not eligible for allocation`
          );
        }

        if (manualAlloc.amount > chargeInfo.remaining) {
          throw new Error(
            `Allocation amount ${manualAlloc.amount} exceeds remaining ${chargeInfo.remaining} for charge ${manualAlloc.entryId}`
          );
        }

        if (manualAlloc.amount > remainingPayment) {
          throw new Error(
            `Allocation amount ${manualAlloc.amount} exceeds remaining payment ${remainingPayment}`
          );
        }

        allocations.push({
          entryId: manualAlloc.entryId,
          amount: manualAlloc.amount,
          date: new Date(),
        });
        remainingPayment -= manualAlloc.amount;
      }
    } else {
      // FIFO automatic allocation
      for (const { charge, remaining } of chargesWithRemaining) {
        if (remainingPayment <= 0) break;

        const allocAmount = Math.min(remaining, remainingPayment);
        allocations.push({
          entryId: charge._id,
          amount: allocAmount,
          date: new Date(),
        });
        remainingPayment -= allocAmount;
      }
    }

    // Update allocated charges
    const affectedCharges = [];
    for (const alloc of allocations) {
      const charge = pendingCharges.find(
        (c) => String(c._id) === String(alloc.entryId)
      );

      // Calculate new remaining amount
      const currentRemaining =
        charge.remainingAmount ??
        charge.amount -
          (charge.allocations?.reduce((sum, a) => sum + a.amount, 0) || 0);
      const newRemaining = currentRemaining - alloc.amount;

      // Determine new status
      let newStatus;
      if (newRemaining <= 0) {
        newStatus = "paid";
      } else if (newRemaining < charge.amount) {
        newStatus = "partial";
      } else {
        newStatus = "pending";
      }

      // Update charge
      await ClientAccountEntry.updateOne(
        { _id: charge._id },
        {
          $push: { allocations: alloc },
          $set: {
            remainingAmount: Math.max(0, newRemaining),
            status: newStatus,
          },
        },
        { session }
      );

      affectedCharges.push({
        entryId: charge._id,
        amount: alloc.amount,
        previousRemaining: currentRemaining,
        newRemaining: Math.max(0, newRemaining),
        status: newStatus,
      });
    }

    // Create payment entry
    const paymentEntry = await ClientAccountEntry.create(
      [
        {
          tenant: tenantId,
          client: clientId,
          date: new Date().toISOString().slice(0, 10),
          type: "PAYMENT",
          amount: paymentAmount,
          sign: -1,
          paymentMethod,
          reference,
          notes: notes || "Pago asignado automáticamente",
          createdBy,
          allocations,
          remainingAmount: 0,
          status: "paid",
        },
      ],
      { session }
    );

    await session.commitTransaction();
    sessionClosed = true;

    return {
      paymentEntry: paymentEntry[0],
      allocations,
      affectedCharges,
      unallocatedAmount: remainingPayment,
    };
  } catch (error) {
    if (!sessionClosed) {
      try {
        await session.abortTransaction();
      } catch {
        // Session may already be closed
      }
      session.endSession();
      sessionClosed = true;
    }
    throw error;
  } finally {
    if (!sessionClosed) {
      session.endSession();
    }
  }
}

/**
 * Calculate client balance from all account entries
 * 
 * Sums all entry amounts multiplied by their sign:
 * - Positive sign (+1): CHARGE, DEBIT_NOTE (client owes)
 * - Negative sign (-1): PAYMENT, CREDIT_NOTE (we owe/refund)
 * 
 * @param {string} tenantId - Tenant ID
 * @param {string} clientId - Client ID
 * @returns {Promise<number>} Client balance (positive = client owes, negative = we owe client)
 * 
 * @example
 * const balance = await getClientBalance(tenantId, clientId);
 * console.log(balance); // 5000 (client owes $5000)
 */
async function getClientBalance(tenantId, clientId) {
  const result = await ClientAccountEntry.aggregate([
    {
      $match: {
        tenant: new mongoose.Types.ObjectId(tenantId),
        client: new mongoose.Types.ObjectId(clientId),
      },
    },
    {
      $group: {
        _id: null,
        balance: { $sum: { $multiply: ["$amount", "$sign"] } },
      },
    },
  ]);

  return result[0]?.balance || 0;
}

/**
 * Check if a new charge would exceed the client's credit limit
 * 
 * Credit limit logic:
 * - If no limit set (0 or null): always returns true (unlimited)
 * - Otherwise: checks if current balance + new charge <= limit
 * 
 * @param {string} tenantId - Tenant ID
 * @param {string} clientId - Client ID
 * @param {number} newChargeAmount - Amount of the proposed new charge
 * @returns {Promise<boolean>} True if charge is within limit or no limit set
 * 
 * @example
 * const canCharge = await checkCreditLimit(tenantId, clientId, 5000);
 * if (!canCharge) {
 *   // Show warning or block sale
 * }
 */
async function checkCreditLimit(tenantId, clientId, newChargeAmount = 0) {
  const client = await Client.findOne({
    _id: clientId,
    tenant: tenantId,
  }).select("creditLimit");

  // If no credit limit set (0 or null), allow unlimited
  if (!client || !client.creditLimit || client.creditLimit <= 0) {
    return true;
  }

  const currentBalance = await getClientBalance(tenantId, clientId);
  const projectedBalance = currentBalance + newChargeAmount;

  // Check if projected balance exceeds credit limit
  return projectedBalance <= client.creditLimit;
}

/**
 * Get all pending charges for a client
 * 
 * Returns charges with status "pending" or "partial" that haven't been fully paid.
 * Includes calculated remaining and allocated amounts.
 * 
 * @param {string} tenantId - Tenant ID
 * @param {string} clientId - Client ID
 * @returns {Promise<Array<ChargeWithRemaining>>} List of pending charges with remaining amounts
 * @returns {Promise<Array>} Array of pending charges with additional computed fields:
 *   - remainingAmount: Outstanding balance on this charge
 *   - allocatedAmount: Total amount already paid toward this charge
 * 
 * @example
 * const pending = await getPendingCharges(tenantId, clientId);
 * pending.forEach(charge => {
 *   console.log(`${charge._id}: $${charge.remainingAmount} remaining`);
 * });
 */
async function getPendingCharges(tenantId, clientId) {
  const charges = await ClientAccountEntry.find({
    tenant: tenantId,
    client: clientId,
    type: { $in: ["CHARGE", "DEBIT_NOTE"] },
    $or: [
      { status: { $in: ["pending", "partial"] } },
      { status: null },
    ],
  })
    .populate("order", "orderNumber")
    .sort({ date: 1, createdAt: 1 });

  return charges.map((charge) => {
    const allocated =
      charge.allocations?.reduce((sum, alloc) => sum + alloc.amount, 0) || 0;
    const remaining =
      charge.remainingAmount ?? Math.max(0, charge.amount - allocated);

    return {
      ...charge.toObject(),
      remainingAmount: remaining,
      allocatedAmount: allocated,
    };
  });
}

/**
 * Generate aging report for a client or all clients
 * 
 * Categorizes outstanding charges into aging buckets based on due date:
 * - current: Not yet due (≤ 0 days overdue)
 * - 1-30: 1-30 days overdue
 * - 31-60: 31-60 days overdue  
 * - 61-90: 61-90 days overdue
 * - 90+: More than 90 days overdue
 * 
 * Uses MongoDB aggregation pipeline for efficient server-side calculation.
 * 
 * @param {string} tenantId - Tenant ID
 * @param {string} [clientId=null] - Optional client ID to filter (null = all clients)
 * @returns {Promise<AgingReport>} Aging report with buckets and totals
 * @returns {Promise<Object>} Aging report containing:
 *   - clients: Array of client aging data
 *   - totals: Aggregated totals across all clients
 *   - generatedAt: ISO timestamp of report generation
 * 
 * @example
 * // Single client report
 * const aging = await getAgingReport(tenantId, clientId);
 * console.log(aging.clients[0].buckets);
 * 
 * @example
 * // All clients report
 * const allAging = await getAgingReport(tenantId);
 * console.log(allAging.totals);
 */
async function getAgingReport(tenantId, clientId = null) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build match stage
  const matchStage = {
    tenant: new mongoose.Types.ObjectId(tenantId),
    type: { $in: ["CHARGE", "DEBIT_NOTE"] },
    $or: [
      { status: { $in: ["pending", "partial"] } },
      { status: null },
    ],
    dueDate: { $exists: true, $ne: null },
  };

  if (clientId) {
    matchStage.client = new mongoose.Types.ObjectId(clientId);
  }

  // Aggregation pipeline for aging buckets
  const agingPipeline = [
    { $match: matchStage },
    {
      $addFields: {
        daysOverdue: {
          $floor: {
            $divide: [
              { $subtract: [today, "$dueDate"] },
              1000 * 60 * 60 * 24, // Convert ms to days
            ],
          },
        },
        effectiveRemaining: {
          $cond: {
            if: { $gt: ["$remainingAmount", 0] },
            then: "$remainingAmount",
            else: {
              $subtract: [
                "$amount",
                { $sum: { $ifNull: ["$allocations.amount", []] } },
              ],
            },
          },
        },
      },
    },
    {
      $addFields: {
        agingBucket: {
          $switch: {
            branches: [
              { case: { $lt: ["$daysOverdue", 0] }, then: "current" },
              { case: { $lte: ["$daysOverdue", 30] }, then: "1-30" },
              { case: { $lte: ["$daysOverdue", 60] }, then: "31-60" },
              { case: { $lte: ["$daysOverdue", 90] }, then: "61-90" },
            ],
            default: "90+",
          },
        },
      },
    },
    {
      $group: {
        _id: {
          client: "$client",
          bucket: "$agingBucket",
        },
        total: { $sum: "$effectiveRemaining" },
        count: { $sum: 1 },
        entries: {
          $push: {
            _id: "$_id",
            date: "$date",
            dueDate: "$dueDate",
            amount: "$amount",
            remainingAmount: "$effectiveRemaining",
            daysOverdue: "$daysOverdue",
          },
        },
      },
    },
    {
      $group: {
        _id: "$_id.client",
        buckets: {
          $push: {
            bucket: "$_id.bucket",
            total: "$total",
            count: "$count",
            entries: "$entries",
          },
        },
        totalOutstanding: { $sum: "$total" },
      },
    },
    {
      $lookup: {
        from: "clients",
        localField: "_id",
        foreignField: "_id",
        as: "clientInfo",
      },
    },
    {
      $unwind: {
        path: "$clientInfo",
        preserveNullAndEmptyArrays: true,
      },
    },
    {
      $project: {
        clientId: "$_id",
        clientName: { $ifNull: ["$clientInfo.name", "Unknown"] },
        clientPhone: { $ifNull: ["$clientInfo.phone", ""] },
        creditLimit: { $ifNull: ["$clientInfo.creditLimit", 0] },
        buckets: 1,
        totalOutstanding: 1,
        current: {
          $let: {
            vars: {
              currentBucket: {
                $filter: {
                  input: "$buckets",
                  cond: { $eq: ["$$this.bucket", "current"] },
                },
              },
            },
            in: { $ifNull: [{ $arrayElemAt: ["$$currentBucket.total", 0] }, 0] },
          },
        },
        overdue1to30: {
          $let: {
            vars: {
              bucket: {
                $filter: {
                  input: "$buckets",
                  cond: { $eq: ["$$this.bucket", "1-30"] },
                },
              },
            },
            in: { $ifNull: [{ $arrayElemAt: ["$$bucket.total", 0] }, 0] },
          },
        },
        overdue31to60: {
          $let: {
            vars: {
              bucket: {
                $filter: {
                  input: "$buckets",
                  cond: { $eq: ["$$this.bucket", "31-60"] },
                },
              },
            },
            in: { $ifNull: [{ $arrayElemAt: ["$$bucket.total", 0] }, 0] },
          },
        },
        overdue61to90: {
          $let: {
            vars: {
              bucket: {
                $filter: {
                  input: "$buckets",
                  cond: { $eq: ["$$this.bucket", "61-90"] },
                },
              },
            },
            in: { $ifNull: [{ $arrayElemAt: ["$$bucket.total", 0] }, 0] },
          },
        },
        overdue90plus: {
          $let: {
            vars: {
              bucket: {
                $filter: {
                  input: "$buckets",
                  cond: { $eq: ["$$this.bucket", "90+"] },
                },
              },
            },
            in: { $ifNull: [{ $arrayElemAt: ["$$bucket.total", 0] }, 0] },
          },
        },
      },
    },
  ];

  const results = await ClientAccountEntry.aggregate(agingPipeline);

  // Calculate totals across all clients
  const totals = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61-90": 0,
    "90+": 0,
    totalOutstanding: 0,
  };

  results.forEach((client) => {
    totals.current += client.current || 0;
    totals["1-30"] += client.overdue1to30 || 0;
    totals["31-60"] += client.overdue31to60 || 0;
    totals["61-90"] += client.overdue61to90 || 0;
    totals["90+"] += client.overdue90plus || 0;
    totals.totalOutstanding += client.totalOutstanding || 0;
  });

  // Sort by total outstanding (highest first)
  results.sort((a, b) => b.totalOutstanding - a.totalOutstanding);

  return {
    clients: results,
    totals,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Get credit status for a client
 * 
 * Calculates credit utilization and returns status information for display
 * and credit limit enforcement.
 * 
 * Status thresholds:
 * - **ok**: < 80% utilization
 * - **near_limit**: ≥ 80% and ≤ 100% utilization
 * - **over_limit**: > 100% utilization
 * - **no_limit**: No credit limit set
 * 
 * @param {string} tenantId - Tenant ID
 * @param {string} clientId - Client ID
 * @returns {Promise<CreditStatus>} Credit status with utilization info
 * @returns {Promise<Object>} Credit status containing:
 *   - clientId, clientName: Client identification
 *   - creditLimit: Maximum allowed credit
 *   - currentBalance: Current amount owed
 *   - remainingCredit: Available credit (null if no limit)
 *   - utilizationPercentage: Percentage used (0-100+, rounded to 2 decimals)
 *   - status: 'ok' | 'near_limit' | 'over_limit' | 'no_limit'
 *   - isNearLimit: Boolean (≥ 80%)
 *   - isOverLimit: Boolean (> 100%)
 * @throws {Error} When client is not found
 * 
 * @example
 * const status = await getCreditStatus(tenantId, clientId);
 * if (status.isNearLimit) {
 *   showWarning(`Client at ${status.utilizationPercentage}% of credit limit`);
 * }
 */
async function getCreditStatus(tenantId, clientId) {
  const client = await Client.findOne({
    _id: clientId,
    tenant: tenantId,
  }).select("name creditLimit");

  if (!client) {
    throw new Error("Client not found");
  }

  const balance = await getClientBalance(tenantId, clientId);
  const creditLimit = client.creditLimit || 0;

  // If no credit limit set, return basic info
  if (creditLimit <= 0) {
    return {
      clientId,
      clientName: client.name,
      creditLimit: 0,
      currentBalance: balance,
      remainingCredit: null,
      utilizationPercentage: 0,
      status: "no_limit",
      isNearLimit: false,
      isOverLimit: false,
    };
  }

  const remainingCredit = Math.max(0, creditLimit - balance);
  const utilizationPercentage = (balance / creditLimit) * 100;

  return {
    clientId,
    clientName: client.name,
    creditLimit,
    currentBalance: balance,
    remainingCredit,
    utilizationPercentage: Math.round(utilizationPercentage * 100) / 100,
    status: balance > creditLimit ? "over_limit" : utilizationPercentage >= 80 ? "near_limit" : "ok",
    isNearLimit: utilizationPercentage >= 80 && balance <= creditLimit,
    isOverLimit: balance > creditLimit,
  };
}

/**
 * @typedef {Object} AllocationResult
 * @property {ClientAccountEntry} paymentEntry - The created payment entry
 * @property {Array<{entryId: string, amount: number, date: Date}>} allocations - Applied allocations
 * @property {Array<{entryId: string, amount: number, previousRemaining: number, newRemaining: number, status: string}>} affectedCharges - Details of updated charges
 * @property {number} unallocatedAmount - Amount not allocated to any charge
 */

/**
 * @typedef {Object} ChargeWithRemaining
 * @extends ClientAccountEntry
 * @property {number} remainingAmount - Calculated outstanding amount
 * @property {number} allocatedAmount - Total amount already paid
 */

/**
 * @typedef {Object} AgingReport
 * @property {Array<Object>} clients - Client aging data
 * @property {Object} totals - Aggregated totals
 * @property {string} generatedAt - ISO timestamp
 */

/**
 * @typedef {Object} CreditStatus
 * @property {string} clientId
 * @property {string} clientName
 * @property {number} creditLimit
 * @property {number} currentBalance
 * @property {number|null} remainingCredit
 * @property {number} utilizationPercentage
 * @property {'ok'|'near_limit'|'over_limit'|'no_limit'} status
 * @property {boolean} isNearLimit
 * @property {boolean} isOverLimit
 */

module.exports = {
  allocatePayment,
  getClientBalance,
  checkCreditLimit,
  getPendingCharges,
  getAgingReport,
  getCreditStatus,
};
