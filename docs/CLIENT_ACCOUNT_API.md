# Client Account API Documentation

## Overview

The Client Account API provides endpoints for managing client current accounts (cuenta corriente), including payment allocation, aging reports, and credit limit management.

## Base URL

```
/api/clients/:clientId/account
```

## Authentication

All endpoints require a valid JWT token in the Authorization header:

```
Authorization: Bearer <token>
```

---

## Endpoints

### 1. Allocate Payment

Allocates a payment to pending charges using FIFO strategy or manual allocation.

**Endpoint:** `POST /api/clients/:id/account/allocate`

#### Request

```json
{
  "amount": 1000,
  "paymentMethod": "cash",
  "reference": "REF-001",
  "notes": "January payment",
  "allocations": [
    { "entryId": "charge-id-1", "amount": 600 },
    { "entryId": "charge-id-2", "amount": 400 }
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `amount` | number | Yes | Total payment amount |
| `paymentMethod` | string | No | Payment method (cash, card, transfer, check, other) |
| `reference` | string | No | Payment reference number |
| `notes` | string | No | Additional notes |
| `allocations` | array | No | Manual allocations (if omitted, uses FIFO) |

#### Response (201 Created)

```json
{
  "success": true,
  "paymentEntry": {
    "_id": "payment-id",
    "type": "PAYMENT",
    "amount": 1000,
    "sign": -1,
    "paymentMethod": "cash",
    "reference": "REF-001",
    "notes": "January payment",
    "allocations": [
      { "entryId": "charge-id-1", "amount": 600, "date": "2026-01-15T10:00:00Z" }
    ],
    "status": "paid",
    "remainingAmount": 0
  },
  "allocations": [
    { "entryId": "charge-id-1", "amount": 600, "date": "2026-01-15T10:00:00Z" }
  ],
  "affectedCharges": [
    {
      "entryId": "charge-id-1",
      "amount": 600,
      "previousRemaining": 1000,
      "newRemaining": 400,
      "status": "partial"
    }
  ],
  "unallocatedAmount": 400
}
```

#### Error Responses

| Status | Code | Description |
|--------|------|-------------|
| 400 | `INVALID_AMOUNT` | Payment amount must be greater than zero |
| 400 | `ALLOCATION_EXCEEDS_REMAINING` | Manual allocation exceeds charge remaining amount |
| 404 | `CHARGE_NOT_FOUND` | Specified charge entry not found |
| 500 | `SERVER_ERROR` | Internal server error |

---

### 2. Get Client Aging Report

Returns an aging report for a specific client, categorizing outstanding amounts by due date buckets.

**Endpoint:** `GET /api/clients/:id/account/aging`

#### Response (200 OK)

```json
{
  "clientId": "client-id",
  "clientName": "John Doe",
  "totalOutstanding": 4100,
  "buckets": {
    "current": 1000,
    "1-30": 500,
    "31-60": 800,
    "61-90": 600,
    "90+": 1200
  },
  "entries": [
    {
      "bucket": "current",
      "total": 1000,
      "count": 1,
      "entries": [
        {
          "_id": "entry-id",
          "date": "2026-01-01",
          "dueDate": "2026-02-01",
          "amount": 1000,
          "remainingAmount": 1000,
          "daysOverdue": -5
        }
      ]
    }
  ],
  "generatedAt": "2026-02-01T00:00:00Z"
}
```

#### Bucket Definitions

| Bucket | Days Overdue | Description |
|--------|--------------|-------------|
| `current` | ≤ 0 | Not yet due |
| `1-30` | 1-30 | 1-30 days overdue |
| `31-60` | 31-60 | 31-60 days overdue |
| `61-90` | 61-90 | 61-90 days overdue |
| `90+` | > 90 | More than 90 days overdue |

---

### 3. Get Credit Status

Returns the client's credit utilization status and limit information.

**Endpoint:** `GET /api/clients/:id/account/credit-status`

#### Response (200 OK)

```json
{
  "clientId": "client-id",
  "clientName": "John Doe",
  "creditLimit": 10000,
  "currentBalance": 5000,
  "remainingCredit": 5000,
  "utilizationPercentage": 50.00,
  "status": "ok",
  "isNearLimit": false,
  "isOverLimit": false
}
```

#### Status Values

| Status | Description | Threshold |
|--------|-------------|-----------|
| `ok` | Within normal limits | < 80% utilization |
| `near_limit` | Approaching limit | ≥ 80% and ≤ 100% |
| `over_limit` | Limit exceeded | > 100% |
| `no_limit` | No credit limit set | limit = 0 or null |

---

### 4. Get Pending Charges

Returns all pending and partially paid charges for a client.

**Endpoint:** `GET /api/clients/:id/account/pending-charges`

#### Response (200 OK)

```json
{
  "clientId": "client-id",
  "charges": [
    {
      "_id": "charge-id",
      "client": "client-id",
      "date": "2026-01-01",
      "type": "CHARGE",
      "amount": 1000,
      "sign": 1,
      "remainingAmount": 600,
      "allocatedAmount": 400,
      "dueDate": "2026-02-01",
      "status": "partial",
      "order": "order-id"
    }
  ],
  "totalPending": 600
}
```

---

### 5. Get Client Balance

Returns the current balance calculated from all account entries.

**Endpoint:** `GET /api/clients/:id/account/balance`

#### Response (200 OK)

```json
{
  "clientId": "client-id",
  "balance": 2500,
  "formattedBalance": "$2,500.00"
}
```

---

## Data Models

### ClientAccountEntry

```typescript
interface ClientAccountEntry {
  _id: string;
  client: string;
  date: string;
  type: "CHARGE" | "PAYMENT" | "CREDIT_NOTE" | "DEBIT_NOTE";
  amount: number;
  sign: 1 | -1;
  order?: string | null;
  paymentMethod: string;
  reference: string;
  notes: string;
  // Reconciliation fields
  dueDate?: string | null;
  remainingAmount?: number | null;
  status?: "pending" | "partial" | "paid" | "cancelled";
  allocations?: Array<{
    entryId: string;
    amount: number;
    date: string;
  }>;
  createdAt?: string;
}
```

### Payment Allocation

```typescript
interface PaymentAllocationRequest {
  amount: number;
  paymentMethod?: string;
  reference?: string;
  notes?: string;
  allocations?: Array<{
    entryId: string;
    amount: number;
  }>;
}

interface PaymentAllocationResponse {
  success: boolean;
  paymentEntry: ClientAccountEntry;
  allocations: Array<{
    entryId: string;
    amount: number;
    date: string;
  }>;
  affectedCharges: Array<{
    entryId: string;
    amount: number;
    previousRemaining: number;
    newRemaining: number;
    status: string;
  }>;
  unallocatedAmount: number;
}
```

---

## Error Format

All errors follow the standard API error format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message"
  },
  "requestId": "uuid-for-tracing"
}
```

---

## Examples

### Example 1: Allocate Payment with FIFO Strategy

```bash
curl -X POST https://api.example.com/api/clients/123/account/allocate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 500,
    "paymentMethod": "cash",
    "reference": "CASH-001"
  }'
```

### Example 2: Manual Allocation

```bash
curl -X POST https://api.example.com/api/clients/123/account/allocate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 800,
    "paymentMethod": "transfer",
    "allocations": [
      { "entryId": "charge-456", "amount": 300 },
      { "entryId": "charge-789", "amount": 500 }
    ]
  }'
```

### Example 3: Get Aging Report

```bash
curl https://api.example.com/api/clients/123/account/aging \
  -H "Authorization: Bearer <token>"
```

### Example 4: Get Credit Status

```bash
curl https://api.example.com/api/clients/123/account/credit-status \
  -H "Authorization: Bearer <token>"
```

---

## Rate Limits

- Standard rate limits apply (100 requests per minute per user)
- Allocation endpoint has a lower limit (20 requests per minute) due to database transaction requirements

## Changelog

### Version 1.0 (2026-02-01)
- Initial release
- Added payment allocation endpoint
- Added aging report endpoint
- Added credit status endpoint
