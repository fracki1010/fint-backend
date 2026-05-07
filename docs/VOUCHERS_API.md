# Vouchers API Documentation

## Overview

The Vouchers API provides endpoints for generating, managing, and downloading fiscal documents including Invoices (Facturas), Delivery Notes (Remitos), and Receipts (Recibos).

## Base URL

```
/api/vouchers
```

---

## Endpoints

### 1. Generate Vouchers for an Order

Create one or more vouchers for a specific order.

**Endpoint:** `POST /orders/:orderId/vouchers`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "types": ["invoice", "delivery_note", "receipt"],
  "generatePdf": true
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `types` | Array | Yes | Voucher types to generate: `invoice`, `delivery_note`, `receipt` |
| `generatePdf` | Boolean | No | Whether to generate PDF files (default: true) |

**Response (201 Created):**
```json
{
  "vouchers": [
    {
      "_id": "60a1b2c3d4e5f6g7h8i9j0k1",
      "order": "60a1b2c3d4e5f6g7h8i9j0k2",
      "type": "invoice",
      "number": "F-000042",
      "sequentialNumber": 42,
      "filePath": "/comprobantes/tenant-1/2026/invoice/invoice-F-000042-1234567890.pdf",
      "fileUrl": "/api/vouchers/download/invoice-F-000042-1234567890.pdf",
      "status": "active",
      "createdAt": "2026-01-15T10:30:00.000Z",
      "metadata": {
        "clientName": "Juan Perez",
        "clientTaxId": "20-12345678-1",
        "totalAmount": 250.00,
        "itemCount": 3
      }
    }
  ],
  "generatedAt": "2026-01-15T10:30:00.000Z",
  "totalGenerated": 1,
  "totalRequested": 1
}
```

**Error Responses:**
- `400 Bad Request` - Invalid voucher types or empty types array
- `401 Unauthorized` - Missing or invalid authentication
- `404 Not Found` - Order not found
- `409 Conflict` - Duplicate voucher number (concurrent request)

---

### 2. List Vouchers for an Order

Get all vouchers associated with a specific order.

**Endpoint:** `GET /orders/:orderId/vouchers`

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `includeVoided` | Boolean | Include voided vouchers in results (default: false) |

**Response (200 OK):**
```json
{
  "vouchers": [
    {
      "_id": "60a1b2c3d4e5f6g7h8i9j0k1",
      "order": "60a1b2c3d4e5f6g7h8i9j0k2",
      "type": "invoice",
      "number": "F-000042",
      "status": "active",
      "createdAt": "2026-01-15T10:30:00.000Z"
    }
  ]
}
```

---

### 3. List All Vouchers

Get a paginated list of all vouchers with optional filters.

**Endpoint:** `GET /vouchers`

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `page` | Number | Page number (default: 1) |
| `limit` | Number | Items per page (default: 20, max: 100) |
| `type` | String | Filter by type: `invoice`, `delivery_note`, `receipt` |
| `status` | String | Filter by status: `active`, `voided` |
| `orderId` | String | Filter by order ID |
| `clientName` | String | Search by client name (partial match) |
| `dateFrom` | ISO Date | Filter by creation date (start) |
| `dateTo` | ISO Date | Filter by creation date (end) |

**Response (200 OK):**
```json
{
  "vouchers": [...],
  "total": 150,
  "page": 1,
  "totalPages": 8,
  "hasNextPage": true
}
```

---

### 4. Download Voucher PDF

Download the PDF file for a specific voucher.

**Endpoint:** `GET /vouchers/:voucherId/download`

**Headers:**
```
Authorization: Bearer <token>
```

**Response:**
- `200 OK` - PDF file stream with `Content-Type: application/pdf`
- `Content-Disposition: attachment; filename="F-000042.pdf"`

**Error Responses:**
- `401 Unauthorized` - Missing or invalid authentication
- `404 Not Found` - Voucher not found or PDF missing

---

### 5. Void Voucher

Mark a voucher as voided with a reason. Voided vouchers are kept for audit purposes.

**Endpoint:** `POST /vouchers/:voucherId/void`

**Headers:**
```
Authorization: Bearer <token>
Content-Type: application/json
```

**Request Body:**
```json
{
  "reason": "Error en datos del cliente"
}
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `reason` | String | Yes | Reason for voiding (min 3 characters) |

**Response (200 OK):**
```json
{
  "voucher": {
    "_id": "60a1b2c3d4e5f6g7h8i9j0k1",
    "number": "F-000042",
    "status": "voided",
    "voidReason": "Error en datos del cliente",
    "voidedAt": "2026-01-15T11:00:00.000Z"
  },
  "message": "Comprobante F-000042 anulado correctamente"
}
```

**Error Responses:**
- `400 Bad Request` - Missing or invalid reason
- `400 Bad Request` - Voucher already voided
- `401 Unauthorized` - Missing or invalid authentication
- `404 Not Found` - Voucher not found

---

### 6. Get Next Voucher Number

Preview the next sequential number for a voucher type without incrementing the counter.

**Endpoint:** `GET /vouchers/next-number`

**Headers:**
```
Authorization: Bearer <token>
```

**Query Parameters:**
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `type` | String | Yes | Voucher type: `invoice`, `delivery_note`, `receipt` |

**Response (200 OK):**
```json
{
  "nextNumber": "F-000043",
  "sequentialNumber": 43,
  "prefix": "F-",
  "year": 2026
}
```

---

## Voucher Types

| Type | Prefix | Description |
|------|--------|-------------|
| `invoice` | F- | Factura - Complete fiscal document with client and store tax data |
| `delivery_note` | R- | Remito - Delivery confirmation with quantities only |
| `receipt` | D- | Recibo - Payment confirmation for paid orders |

---

## Status Codes

| Status | Description |
|--------|-------------|
| `active` | Voucher is valid and can be downloaded |
| `voided` | Voucher has been cancelled (kept for audit) |

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `INVALID_VOUCHER_TYPE` | 400 | Invalid or unsupported voucher type |
| `INVALID_VOUCHER_TYPES` | 400 | One or more invalid types in array |
| `VOID_REASON_REQUIRED` | 400 | Void reason missing or too short |
| `ALREADY_VOIDED` | 400 | Voucher has already been voided |
| `ORDER_NOT_FOUND` | 404 | Order ID does not exist |
| `VOUCHER_NOT_FOUND` | 404 | Voucher ID does not exist |
| `TENANT_REQUIRED` | 400 | Tenant context missing |

---

## Concurrent Access

The API handles concurrent voucher generation safely using atomic database operations. When multiple requests attempt to generate vouchers simultaneously:

1. Each voucher receives a unique sequential number
2. No duplicate numbers are assigned
3. Counter increments correctly
4. All transactions are ACID-compliant

---

## Annual Reset

When annual reset is enabled in settings, voucher counters reset to 1 at the start of each calendar year. The year is included in voucher numbering format when this feature is enabled.

---

## Rate Limiting

Standard API rate limits apply:
- 100 requests per minute per user
- 1000 requests per hour per tenant

---

## Webhooks

Coming soon: Webhook notifications for voucher events (generated, voided, downloaded).
