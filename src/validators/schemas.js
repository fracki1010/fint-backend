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
};

const createClientBody = z.object({
  ...clientPayloadBase,
  name: z.string().trim().min(1, "Nombre requerido"),
  phone: z.string().trim().min(3, "Teléfono requerido"),
  taxId: z.string().trim().min(1, "Documento fiscal requerido"),
});

const updateClientBody = z.object(clientPayloadBase);

const productPayloadBase = {
  sku: z.string().trim().optional(),
  name: z.string().trim().min(1, "Nombre requerido").optional(),
  description: z.string().trim().optional(),
  price: z.coerce.number().min(0, "Precio inválido").optional(),
  costPrice: z.coerce.number().min(0, "Costo inválido").optional(),
  stock: z.coerce.number().min(0, "Stock inválido").optional(),
  minStock: z.coerce.number().min(0, "Stock mínimo inválido").optional(),
  category: z.string().trim().optional(),
  categories: z.array(z.string().trim().min(1)).optional(),
  unitOfMeasure: z
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
};

const createProductBody = z.object({
  ...productPayloadBase,
  name: z.string().trim().min(1, "Nombre requerido"),
  price: z.coerce.number().min(0, "Precio inválido"),
});

const updateProductBody = z.object(productPayloadBase);

const orderItemSchema = z.object({
  product: z.string().trim().min(1, "Producto requerido"),
  quantity: z.coerce.number().positive("Cantidad inválida"),
  price: z.coerce.number().min(0, "Precio inválido"),
  productId: objectId.optional(),
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
  deliveryStatus: z.enum(["Pendiente", "Preparando", "Entregada"]).optional(),
  notes: z.string().trim().optional(),
  imageUrl: z.string().trim().optional(),
  source: z.enum(["WhatsApp", "Dashboard"]).optional(),
});

const updateOrderBody = z.object({
  salesStatus: z.enum(["Pendiente", "Confirmada", "Cancelada"]).optional(),
  paymentStatus: z.enum(["Pendiente", "Parcial", "Pagado"]).optional(),
  deliveryStatus: z.enum(["Pendiente", "Preparando", "Entregada"]).optional(),
  notes: z.string().trim().optional(),
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

const includeInactiveQuery = z.object({
  includeInactive: z.enum(["true", "false"]).optional(),
  page: numericString,
  limit: numericString,
});

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
  whatsappAuthorizedNumbers: z
    .union([z.array(z.string().trim()), z.string().trim()])
    .optional(),
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
});

const notificationIdParam = z.object({
  id: objectId,
});

module.exports = {
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
};
