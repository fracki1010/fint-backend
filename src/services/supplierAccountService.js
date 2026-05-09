const mongoose = require('mongoose');
const SupplierAccountEntry = require('../models/supplierAccountEntry.model');

/**
 * Allocate a payment to pending charges (FIFO)
 *
 * @param {Object} params
 * @param {string} params.supplier - Supplier ID
 * @param {number} params.amount - Payment amount to allocate
 * @param {Date}   [params.date] - Allocation date
 * @param {string} [params.paymentEntryId] - The payment entry being allocated
 * @returns {Promise<{allocated: number, unallocated: number, allocations: Array}>}
 */
async function allocatePayment({ supplier, amount, date, paymentEntryId }) {
  // Get pending charges ordered by date (FIFO)
  const pendingCharges = await SupplierAccountEntry.find({
    supplier,
    type: 'CHARGE',
    $or: [
      { status: { $in: ['pending', 'partial'] } },
      { status: null, remainingAmount: null }, // legacy entries
    ],
  }).sort({ date: 1, createdAt: 1 });

  let remaining = amount;
  const allocations = [];

  for (const charge of pendingCharges) {
    if (remaining <= 0) break;

    // For legacy entries without reconciliation, remainingAmount = amount
    const chargeRemaining = charge.remainingAmount ?? charge.amount;
    if (chargeRemaining <= 0) continue;

    const allocated = Math.min(chargeRemaining, remaining);
    remaining -= allocated;

    const newRemaining = chargeRemaining - allocated;
    const newStatus = newRemaining <= 0 ? 'paid' : 'partial';

    const allocation = {
      entryId: charge._id,
      amount: allocated,
      date: date || new Date(),
    };

    allocations.push(allocation);

    await SupplierAccountEntry.updateOne(
      { _id: charge._id },
      {
        $set: {
          remainingAmount: newRemaining,
          status: newStatus,
        },
        $push: { allocations: allocation },
      }
    );
  }

  return {
    allocated: amount - remaining,
    unallocated: remaining,
    allocations,
  };
}

/**
 * Get pending charges for a supplier
 *
 * @param {string} supplierId
 * @returns {Promise<Array>}
 */
async function getPendingCharges(supplierId) {
  return SupplierAccountEntry.find({
    supplier: supplierId,
    type: 'CHARGE',
    $or: [
      { status: { $in: ['pending', 'partial'] } },
      { status: null, remainingAmount: null },
    ],
  }).sort({ date: 1, createdAt: 1 });
}

/**
 * Get aging report for supplier entries
 *
 * @param {string} supplierId
 * @returns {Promise<{current: number, days30: number, days60: number, days90plus: number}>}
 */
async function getAging(supplierId) {
  const now = new Date();
  const entries = await SupplierAccountEntry.find({
    supplier: supplierId,
    type: 'CHARGE',
    $or: [
      { status: { $in: ['pending', 'partial'] } },
      { status: null },
    ],
  }).sort({ date: 1 });

  const buckets = {
    current: 0, days30: 0, days60: 0, days90plus: 0,
  };

  for (const entry of entries) {
    const dueDate = entry.dueDate || entry.date;
    const daysOverdue = Math.floor((now - new Date(dueDate)) / (1000 * 60 * 60 * 24));
    const remaining = entry.remainingAmount ?? entry.amount ?? 0;

    if (daysOverdue <= 0) buckets.current += remaining;
    else if (daysOverdue <= 30) buckets.days30 += remaining;
    else if (daysOverdue <= 60) buckets.days60 += remaining;
    else buckets.days90plus += remaining;
  }

  return buckets;
}

module.exports = { allocatePayment, getPendingCharges, getAging };
