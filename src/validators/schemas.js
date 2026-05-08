const { z } = require("zod");

const objectId = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "ID inválido")
  .trim();

const numericString = z
  .union([z.string(), z.number(), z.undefined()])
  .optional()
  .transform((value) => {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  });

const paginationQuery = z.object({
  page: numericString,
  limit: numericString,
});

const loginBody = z.object({
  email: z.string().trim().email("Email inválido"),
  password: z.string().min(1, "Contraseña requerida"),
});

const bootstrapBody = z.object({
  setupKey: z.string().min(1, "Clave requerida"),
  fullName: z.string().trim().min(2, "Nombre requerido"),
  email: z.string().trim().email("Email inválido"),
  password: z.string().min(6, "Contraseña mínima de 6 caracteres"),
  storeName: z.string().trim().min(1).optional(),
});

const createUserBody = z.object({
  fullName: z.string().trim().min(2, "Nombre requerido"),
  email: z.string().trim().email("Email inválido"),
  password: z.string().min(6, "Contraseña mínima de 6 caracteres"),
  storeName: z.string().trim().min(1).optional(),
});

const idParam = z.object({ id: objectId });

const clientPayloadBase = {
  name: z.string().trim().min(1, "Nombre requerido").optional(),
  phone: z.string().trim().min(3, "Teléfono requerido").optional(),
  taxId: z.string().trim().min(1, "Documento fiscal requerido").optional(),
  email: z.string().trim().email("Email inválido").optional().or(z.literal("")),
  address: z.string().trim().optional(),
  fiscalAddress: z.string().trim().optional(),
  company: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  debt: z.coerce.number().min(0, "La deuda no puede ser negativa").optional(),
  priceList: z.enum(["retail", "wholesale", "distributor"]).optional(),
};

const createClientBody = z.object({
  ...clientPayloadBase,
  name: z.string().trim().min(1, "Nombre requerido"),
  phone: z.string().trim().min(3, "Teléfono requerido"),
  taxId: z.string().trim().min(1, "Documento fiscal requerido"),
});

const updateClientBody = z.object(clientPayloadBase);

const UNIT_OPTIONS_ENUM = z.enum([
  "unidad",
  "caja",
  "paquete",
  "bolsa",
  "botella",
  "kg",
  "g",
  "litro",
  "ml",
  "metro",
]);

const presentationSchema = z.object({
  _id: z.string().trim().optional(),
  sku: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  name: z.string().trim().min(1, "Nombre requerido"),
  unitOfMeasure: UNIT_OPTIONS_ENUM,
  price: z.coerce.number().min(0, "Precio inválido"),
  equivalentQty: z.coerce.number().positive("Cantidad equivalente inválida"),
  isActive: z.boolean().optional(),
});

const priceTiersSchema = z.object({
  retail: z.coerce.number().min(0, "Precio minorista inválido").optional().nullable(),
  wholesale: z.coerce.number().min(0, "Precio mayorista inválido").optional().nullable(),
  distributor: z.coerce.number().min(0, "Precio distribuidor inválido").optional().nullable(),
}).optional();

const productPayloadBase = {
  sku: z.string().trim().optional(),
  barcode: z.string().trim().optional(),
  name: z.string().trim().min(1, "Nombre requerido").optional(),
  description: z.string().trim().optional(),
  price: z.coerce.number().min(0, "Precio inválido").optional(),
  costPrice: z.coerce.number().min(0, "Costo inválido").optional(),
  stock: z.coerce.number().min(0, "Stock inválido").optional(),
  minStock: z.coerce.number().min(0, "Stock mínimo inválido").optional(),
  category: z.string().trim().optional(),
  categories: z.array(z.string().trim().min(1)).optional(),
  unitOfMeasure: UNIT_OPTIONS_ENUM.optional(),
  type: z
    .enum(["raw_material", "finished", "both"])
    .optional(),
  purchaseUnit: UNIT_OPTIONS_ENUM.optional(),
  purchaseEquivalentQty: z.coerce
    .number()
    .positive("Cantidad equivalente debe ser positiva")
    .optional(),
  presentations: z.array(presentationSchema).optional(),
  priceTiers: priceTiersSchema,
};

const createProductBody = z.object({
  ...productPayloadBase,
  name: z.string().trim().min(1, "Nombre requerido"),
  price: z.coerce.number().min(0, "Precio inválido").optional(),
});

const updateProductBody = z.object(productPayloadBase);

const orderItemSchema = z.object({
  product: z.string().trim().min(1, "Producto requerido"),
  quantity: z.coerce.number().positive("Cantidad inválida"),
  price: z.coerce.number().min(0, "Precio inválido"),
  productId: objectId.optional(),
  presentationId: objectId.optional(),
});

const createOrderBody = z.object({
  client: objectId,
  items: z.array(orderItemSchema).min(1, "Debes incluir al menos un item"),
  totalAmount: z.coerce.number().min(0, "Total inválido"),
  status: z
    .enum(["Pendiente", "Pagado", "Entregado", "Confirmada", "Cancelada"])
    .optional(),
  salesStatus: z.enum(["Pendiente", "Confirmada", "Cancelada"]).optional(),
  paymentStatus: z.enum(["Pendiente", "Parcial", "Pagado"]).optional(),
  paymentMethod: z.string().trim().optional(),
  deliveryStatus: z.enum(["Pendiente", "Preparando", "Entregada"]).optional(),
  notes: z.string().trim().optional(),
  imageUrl: z.string().trim().optional(),
  source: z.enum(["WhatsApp", "Dashboard"]).optional(),
  vouchersToGenerate: z.array(z.enum(["invoice", "delivery_note", "receipt"])).optional(),
  costCenter: objectId.optional(),
});

const updateOrderBody = z.object({
  salesStatus: z.enum(["Pendiente", "Confirmada", "Cancelada"]).optional(),
  paymentStatus: z.enum(["Pendiente", "Parcial", "Pagado"]).optional(),
  paymentMethod: z.string().trim().optional(),
  deliveryStatus: z.enum(["Pendiente", "Preparando", "Entregada"]).optional(),
  notes: z.string().trim().optional(),
  costCenter: objectId.optional(),
});

const stockMovementBody = z.object({
  product: objectId,
  type: z.enum(["ENTRADA", "SALIDA", "MERMA", "AJUSTE"]),
  quantity: z.coerce.number().positive("Cantidad inválida"),
  reason: z.string().trim().optional(),
  order: objectId.optional(),
  source: z.enum(["WhatsApp", "Dashboard", "Sistema"]).optional(),
});

const stockQuerySchema = paginationQuery.extend({
  product: objectId.optional(),
  type: z.enum(["ENTRADA", "SALIDA", "MERMA", "AJUSTE"]).optional(),
  source: z.enum(["WhatsApp", "Dashboard", "Sistema"]).optional(),
  datePreset: z.enum(["today", "7", "30", "90"]).optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

const createSupplyBody = z.object({
  sku: z.string().trim().optional(),
  name: z.string().trim().min(1, "Nombre requerido"),
  unit: z
    .enum(["unidad", "kg", "g", "litro", "ml", "metro", "caja", "paquete"])
    .optional(),
  currentStock: z.coerce.number().min(0).optional(),
  minStock: z.coerce.number().min(0).optional(),
  referenceCost: z.coerce.number().min(0).optional(),
});

const updateSupplyBody = z.object({
  sku: z.string().trim().optional(),
  name: z.string().trim().min(1).optional(),
  unit: z
    .enum(["unidad", "kg", "g", "litro", "ml", "metro", "caja", "paquete"])
    .optional(),
  minStock: z.coerce.number().min(0).optional(),
  referenceCost: z.coerce.number().min(0).optional(),
});

const supplyMovementBody = z.object({
  type: z.enum(["IN", "OUT", "ADJUST"]),
  quantity: z.coerce.number().positive("Cantidad invalida"),
  reason: z.string().trim().min(1, "Motivo requerido"),
  sourceType: z.string().trim().optional(),
  sourceId: z.string().trim().optional(),
});

const recipeIngredientSchema = z.object({
  supplyItemId: objectId.optional(),
  productItemId: objectId.optional(),
  quantity: z.coerce.number().positive("Cantidad invalida"),
}).refine(
  (data) => data.supplyItemId || data.productItemId,
  {
    message: "Cada ingrediente debe tener un insumo (supplyItemId) o un producto (productItemId).",
  },
);

const createRecipeBody = z.object({
  name: z.string().trim().min(1, "Nombre requerido"),
  productId: objectId.optional(),
  yieldQuantity: z.coerce.number().positive("Cantidad invalida").optional(),
  ingredients: z.array(recipeIngredientSchema).optional(),
  notes: z.string().trim().optional(),
});

const updateRecipeBody = z.object({
  name: z.string().trim().min(1).optional(),
  productId: objectId.optional(),
  yieldQuantity: z.coerce.number().positive("Cantidad invalida").optional(),
  ingredients: z.array(recipeIngredientSchema).optional(),
  notes: z.string().trim().optional(),
});

const purchaseItemBody = z.object({
  supplyItemId: objectId.optional(),
  productItemId: objectId.optional(),
  presentationId: objectId.optional(),
  quantity: z.coerce.number().positive("Cantidad invalida"),
  unitCost: z.coerce.number().min(0, "Costo invalido"),
  lineTotal: z.coerce.number().min(0, "Subtotal invalido"),
}).refine(
  (data) => data.supplyItemId || data.productItemId,
  {
    message: "Cada item debe tener un insumo (supplyItemId) o un producto (productItemId).",
  },
);

const createPurchaseBody = z.object({
  supplierId: objectId,
  date: z.string().trim().min(1, "Fecha requerida"),
  paymentCondition: z.enum(["CASH", "CREDIT"]),
  subtotal: z.coerce.number().min(0),
  tax: z.coerce.number().min(0),
  total: z.coerce.number().min(0),
  notes: z.string().trim().optional(),
  paymentMethod: z.string().trim().optional(),
  costCenter: objectId.optional(),
  items: z.array(purchaseItemBody).min(1, "Debes incluir al menos un item"),
});

const createCostCenterBody = z.object({
  name: z.string().trim().min(1, "Nombre requerido"),
  description: z.string().trim().optional(),
});

const updateCostCenterBody = z.object({
  name: z.string().trim().optional(),
  description: z.string().trim().optional(),
  isActive: z.boolean().optional(),
});

const payPurchaseBody = z.object({
  amount: z.coerce.number().positive("Monto debe ser mayor a cero"),
  paymentMethod: z.enum(["cash", "card", "mercadopago", "transfer", "naranja_x", "uala", "brubank", "santander", "supervielle", "frances", "bna", "prex", "cocos", "galicia", "check", "other"]),
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const supplierPaymentBody = z.object({
  date: z.string().trim().min(1, "Fecha requerida"),
  amount: z.coerce.number().positive("Monto invalido"),
  paymentMethod: z.string().trim().optional(),
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const supplierAccountEntryBody = z.object({
  date: z.string().trim().min(1, "Fecha requerida"),
  type: z.enum(["CHARGE", "CREDIT_NOTE", "DEBIT_NOTE"]),
  amount: z.coerce.number().positive("Monto invalido"),
  purchaseId: objectId.optional(),
  paymentMethod: z.string().trim().optional(),
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const supplierStatementQuery = z.object({
  from: z.string().trim().optional(),
  to: z.string().trim().optional(),
});

const includeInactiveQuery = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
  page: numericString,
  limit: numericString,
});

const priceTierConfigSchema = z.object({
  names: z.any().optional(),
  defaultDiscounts: z.any().optional(),
}).optional();

const settingUpdateBody = z.object({
  storeName: z.string().trim().optional(),
  taxId: z.string().trim().optional(),
  fiscalCondition: z.string().trim().optional(),
  address: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  email: z.string().trim().optional(),
  invoiceTerms: z.string().trim().optional(),
  taxRate: z.coerce.number().min(0).max(100).optional(),
  currency: z.string().trim().optional(),
  theme: z.enum(["light", "dark"]).optional(),
  whatsappEnabled: z.boolean().optional(),
  whatsappNumberFormat: z.enum(["AR", "INTL"]).optional(),
  whatsappAdminNumber: z.string().trim().optional(),
  whatsappAuthorizedNumbers: z.array(z.string().trim()).optional(),
  lowStockThreshold: z.coerce.number().min(0).optional(),
  orderPrefix: z.string().trim().optional(),
  allowDeliveryWithoutPayment: z.boolean().optional(),
  stockDeductionMoment: z.enum(["delivery", "confirmation"]).optional(),
  defaultUnitOfMeasure: z
    .enum([
      "unidad",
      "caja",
      "paquete",
      "bolsa",
      "botella",
      "kg",
      "g",
      "litro",
      "ml",
      "metro",
    ])
    .optional(),
  defaultSalesStatus: z.enum(["Pendiente", "Confirmada", "Cancelada"]).optional(),
  defaultPaymentStatus: z.enum(["Pendiente", "Parcial", "Pagado"]).optional(),
  defaultDeliveryStatus: z
    .enum(["Pendiente", "Preparando", "Entregada"])
    .optional(),
  priceTierConfig: priceTierConfigSchema,
  admin: z
    .object({
      fullName: z.string().trim().optional(),
      role: z.string().trim().optional(),
      phone: z.string().trim().optional(),
      email: z.string().trim().optional(),
      company: z
        .object({
          name: z.string().trim().optional(),
          address: z.string().trim().optional(),
          phone: z.string().trim().optional(),
          email: z.string().trim().optional(),
        })
        .optional(),
    })
    .optional(),
}).passthrough();

const notificationIdParam = z.object({
  id: objectId,
});

  // ── Quote / Presupuesto Schemas ──

const quoteItemBody = z.object({
  product: z.string().trim().min(1, "Producto requerido"),
  productId: objectId.optional(),
  presentationId: objectId.optional(),
  quantity: z.coerce.number().positive("Cantidad inválida"),
  price: z.coerce.number().min(0, "Precio inválido"),
  lineTotal: z.coerce.number().min(0, "Subtotal inválido"),
});

const createQuoteBody = z.object({
  client: objectId,
  date: z.string().trim().min(1, "Fecha requerida"),
  expirationDate: z.string().trim().optional(),
  items: z.array(quoteItemBody).min(1, "Debes incluir al menos un item"),
  subtotal: z.coerce.number().min(0, "Subtotal inválido"),
  tax: z.coerce.number().min(0).default(0),
  total: z.coerce.number().min(0, "Total inválido"),
  notes: z.string().trim().optional(),
});

const updateQuoteBody = z.object({
  client: objectId.optional(),
  date: z.string().trim().optional(),
  expirationDate: z.string().trim().optional(),
  items: z.array(quoteItemBody).min(1).optional(),
  subtotal: z.coerce.number().min(0).optional(),
  tax: z.coerce.number().min(0).optional(),
  total: z.coerce.number().min(0).optional(),
  notes: z.string().trim().optional(),
});

// ── Banking / Bank Reconciliation Schemas ──

const bankAccountTypeEnum = z.enum(["checking", "savings"]);
const bankCurrencyEnum = z.enum(["ARS", "USD", "EUR"]).default("ARS");
const transactionTypeEnum = z.enum(["debit", "credit"]);
const transactionStatusEnum = z.enum(["pending", "cleared", "reconciled"]);
const matchedEntryTypeEnum = z.enum([
  "ClientAccountEntry",
  "SupplierAccountEntry",
  "Order",
]);

const createBankAccountBody = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(100, "Máximo 100 caracteres"),
  bank: z.string().trim().min(1, "Banco requerido"),
  accountNumber: z.string().trim().min(1, "Número de cuenta requerido"),
  type: bankAccountTypeEnum.default("checking"),
  currency: bankCurrencyEnum.default("ARS"),
  currentBalance: z.coerce.number().min(0, "El saldo no puede ser negativo").default(0),
  isActive: z.boolean().default(true),
});

const updateBankAccountBody = z.object({
  name: z.string().trim().min(1, "Nombre requerido").max(100).optional(),
  bank: z.string().trim().min(1, "Banco requerido").optional(),
  accountNumber: z.string().trim().min(1, "Número de cuenta requerido").optional(),
  type: bankAccountTypeEnum.optional(),
  currency: bankCurrencyEnum.optional(),
  currentBalance: z.coerce.number().min(0, "El saldo no puede ser negativo").optional(),
  isActive: z.boolean().optional(),
});

const createBankTransactionBody = z.object({
  bankAccount: objectId,
  date: z.string().trim().min(1, "Fecha requerida"),
  description: z
    .string()
    .trim()
    .min(1, "Descripción requerida")
    .max(500, "Máximo 500 caracteres"),
  amount: z.coerce.number().refine((val) => val !== 0, {
    message: "El monto no puede ser cero",
  }),
  type: transactionTypeEnum,
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
});

const updateBankTransactionBody = z.object({
  date: z.string().trim().optional(),
  description: z.string().trim().min(1).max(500).optional(),
  amount: z.coerce.number().refine((val) => val !== 0, {
    message: "El monto no puede ser cero",
  }).optional(),
  type: transactionTypeEnum.optional(),
  reference: z.string().trim().optional(),
  status: transactionStatusEnum.optional(),
  notes: z.string().trim().optional(),
});

const matchTransactionBody = z.object({
  matchedEntryType: matchedEntryTypeEnum,
  matchedEntryId: objectId,
});

const unmatchTransactionBody = z.object({});

const confirmReconciliationBody = z.object({
  endDate: z.string().trim().min(1, "Fecha de cierre requerida"),
});

const bankTransactionQuery = z.object({
  bankAccount: objectId.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  status: transactionStatusEnum.optional(),
  type: transactionTypeEnum.optional(),
  page: z.coerce.number().positive().optional(),
  limit: z.coerce.number().positive().max(100).optional(),
});

const reconciliationQuery = z.object({
  dateFrom: z.string().trim().min(1, "Fecha desde requerida"),
  dateTo: z.string().trim().min(1, "Fecha hasta requerida"),
});

module.exports = {
  quoteItemBody,
  createQuoteBody,
  updateQuoteBody,
  recipeIngredientSchema,
  createRecipeBody,
  updateRecipeBody,
  createSupplyBody,
  updateSupplyBody,
  supplyMovementBody,
  createPurchaseBody,
  payPurchaseBody,
  createCostCenterBody,
  updateCostCenterBody,
  supplierPaymentBody,
  supplierAccountEntryBody,
  supplierStatementQuery,
  loginBody,
  bootstrapBody,
  createUserBody,
  idParam,
  createClientBody,
  updateClientBody,
  includeInactiveQuery,
  createProductBody,
  updateProductBody,
  createOrderBody,
  updateOrderBody,
  stockMovementBody,
  stockQuerySchema,
  settingUpdateBody,
  notificationIdParam,
  createBankAccountBody,
  updateBankAccountBody,
  createBankTransactionBody,
  updateBankTransactionBody,
  matchTransactionBody,
  unmatchTransactionBody,
  confirmReconciliationBody,
  bankTransactionQuery,
  reconciliationQuery,
};
