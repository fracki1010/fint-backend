const mongoose = require("mongoose");
const { processText } = require("../services/groqService");
const Client = require("../models/client.model");
const { Product } = require("../models/product.model");
const Order = require("../models/order.model");
const Setting = require("../models/setting.model");
const StockMovement = require("../models/stockMovement.model");
const User = require("../models/user.model");
const { generateInvoicePdf } = require("../utils/invoicePdf");
const { createAndDispatchNotification } = require("../services/notificationService");

let cachedWhatsAppOwner = null;
const MEMORY_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_ITEMS = 80;

const toPositiveNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

const normalizePhone = (value = "") => value.toString().trim();

const getWhatsAppOwnerId = async () => {
  if (cachedWhatsAppOwner) return cachedWhatsAppOwner;

  const ownerEmail = process.env.WHATSAPP_OWNER_EMAIL
    ? process.env.WHATSAPP_OWNER_EMAIL.toLowerCase().trim()
    : null;

  const ownerUser = ownerEmail
    ? await User.findOne({ email: ownerEmail, isActive: true })
    : await User.findOne({ isSuperAdmin: true, isActive: true });

  if (!ownerUser) {
    throw new Error("No hay usuario activo configurado para WhatsApp");
  }

  cachedWhatsAppOwner = {
    userId: ownerUser._id,
    tenantId: ownerUser.tenant,
  };
  return cachedWhatsAppOwner;
};

const normalizeText = (value = "") =>
  value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();

const escapeRegex = (value = "") =>
  value.toString().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const levenshteinDistance = (a = "", b = "") => {
  const first = normalizeText(a);
  const second = normalizeText(b);
  const matrix = Array.from({ length: first.length + 1 }, (_, i) =>
    Array.from({ length: second.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );

  for (let i = 1; i <= first.length; i += 1) {
    for (let j = 1; j <= second.length; j += 1) {
      const cost = first[i - 1] === second[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }

  return matrix[first.length][second.length];
};

const withSession = (query, session) => (session ? query.session(session) : query);

const findProductByName = async (tenantId, rawName, session = null) => {
  const requestedName = (rawName || "").toString().trim();
  if (!requestedName) {
    return { product: null, suggestions: [] };
  }

  const exactRegex = new RegExp(`^${escapeRegex(requestedName)}$`, "i");
  let product = await withSession(
    Product.findOne({ tenant: tenantId, name: exactRegex }),
    session,
  );

  if (!product) {
    const containsRegex = new RegExp(escapeRegex(requestedName), "i");
    product = await withSession(
      Product.findOne({ tenant: tenantId, name: containsRegex }),
      session,
    );
  }

  if (product) {
    return { product, suggestions: [] };
  }

  const candidates = await Product.find({ tenant: tenantId })
    .select("name stock price unitOfMeasure minStock")
    .limit(150)
    .lean();

  const requestedNormalized = normalizeText(requestedName);
  const suggestions = candidates
    .map((candidate) => ({
      name: candidate.name,
      score: levenshteinDistance(requestedNormalized, candidate.name),
      contains: normalizeText(candidate.name).includes(requestedNormalized),
    }))
    .sort((a, b) => {
      if (a.contains !== b.contains) return a.contains ? -1 : 1;
      return a.score - b.score;
    })
    .slice(0, 3)
    .map((item) => item.name);

  return { product: null, suggestions };
};

const findClientByName = async (tenantId, rawName) => {
  const requested = (rawName || "").toString().trim();
  if (!requested) return { client: null, suggestions: [] };

  const exactRegex = new RegExp(`^${escapeRegex(requested)}$`, "i");
  let matchedClient = await Client.findOne({
    tenant: tenantId,
    isActive: { $ne: false },
    $or: [{ name: exactRegex }, { phone: exactRegex }],
  });

  if (!matchedClient) {
    const containsRegex = new RegExp(escapeRegex(requested), "i");
    matchedClient = await Client.findOne({
      tenant: tenantId,
      isActive: { $ne: false },
      $or: [{ name: containsRegex }, { phone: containsRegex }],
    });
  }

  if (matchedClient) return { client: matchedClient, suggestions: [] };

  const candidates = await Client.find({
    tenant: tenantId,
    isActive: { $ne: false },
  })
    .select("name phone")
    .limit(200)
    .lean();

  const requestedNormalized = normalizeText(requested);
  const suggestions = candidates
    .map((candidate) => {
      const label = (candidate.name || candidate.phone || "").toString();
      const normalized = normalizeText(label);
      return {
        name: label,
        score: levenshteinDistance(requestedNormalized, normalized),
        contains: normalized.includes(requestedNormalized),
      };
    })
    .filter((item) => Boolean(item.name))
    .sort((a, b) => {
      if (a.contains !== b.contains) return a.contains ? -1 : 1;
      return a.score - b.score;
    })
    .slice(0, 3)
    .map((item) => item.name);

  return { client: null, suggestions };
};

const formatMoney = (value) => `$${Number(value || 0).toFixed(2)}`;

const safeJsonParse = (raw) => {
  try {
    return JSON.parse((raw || "").replace(/```json|```/g, "").trim());
  } catch (_error) {
    return null;
  }
};

const toObjectId = (value) => {
  if (!value) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (mongoose.Types.ObjectId.isValid(value)) {
    return new mongoose.Types.ObjectId(value);
  }
  return null;
};

const pruneConversationHistory = (client) => {
  const cutoff = Date.now() - MEMORY_WINDOW_MS;
  const current = Array.isArray(client.conversationHistory)
    ? client.conversationHistory
    : [];
  const recent = current.filter((item) => {
    const timestamp = new Date(item.createdAt || 0).getTime();
    return Number.isFinite(timestamp) && timestamp >= cutoff;
  });
  if (recent.length > MAX_HISTORY_ITEMS) {
    return recent.slice(recent.length - MAX_HISTORY_ITEMS);
  }
  return recent;
};

const appendConversationEntry = (client, role, message) => {
  if (!message) return;
  const history = pruneConversationHistory(client);
  history.push({
    role,
    message: message.toString().slice(0, 1200),
    createdAt: new Date(),
  });
  client.conversationHistory = history.slice(-MAX_HISTORY_ITEMS);
};

const getConversationContext = (client, limit = 12) => {
  const history = pruneConversationHistory(client).slice(-limit);
  if (history.length === 0) return "Sin contexto previo.";
  return history
    .map((entry) => `${entry.role === "assistant" ? "Asistente" : "Usuario"}: ${entry.message}`)
    .join("\n");
};

const resolveSuggestionSelection = (messageBody, options = []) => {
  const raw = (messageBody || "").toString().trim();
  if (!raw || options.length === 0) return null;
  const normalizedReply = normalizeText(raw);

  const choice = Number(normalizedReply);
  if (Number.isInteger(choice) && choice >= 1 && choice <= options.length) {
    return options[choice - 1];
  }

  const exactByName = options.find((option) => normalizeText(option) === normalizedReply);
  if (exactByName) return exactByName;

  const containsByName = options.find((option) =>
    normalizeText(option).includes(normalizedReply),
  );
  if (containsByName) return containsByName;

  const fuzzy = options
    .map((option) => ({
      option,
      score: levenshteinDistance(option, normalizedReply),
    }))
    .sort((a, b) => a.score - b.score)[0];

  if (fuzzy && fuzzy.score <= 3) return fuzzy.option;
  return null;
};

const formatNumberedSuggestions = (originalName, suggestions = []) => {
  const numbered = suggestions.map((name, index) => `${index + 1}. ${name}`).join("\n");
  return `❌ No encontré "${originalName}".\nQuizás quisiste decir:\n${numbered}\nResponde con el número (1-${suggestions.length}) o escribe el nombre correcto.`;
};

const buildOrderDraft = async (tenantId, orderData = {}) => {
  const requestedClientName = (orderData?.clientName || "").toString().trim();
  if (!requestedClientName) {
    return { ok: false, code: "CLIENT_REQUIRED" };
  }

  const clientLookup = await findClientByName(tenantId, requestedClientName);
  if (!clientLookup.client) {
    return {
      ok: false,
      code: "CLIENT_NOT_FOUND",
      requestedClientName,
      suggestions: clientLookup.suggestions || [],
    };
  }

  const requestedItems = Array.isArray(orderData?.items) ? orderData.items : [];
  if (requestedItems.length === 0) {
    return { ok: false, code: "ITEMS_REQUIRED", client: clientLookup.client };
  }

  const items = [];
  const missingProducts = [];
  const insufficientStock = [];
  let totalAmount = 0;

  for (const item of requestedItems) {
    const quantity = toPositiveNumber(item?.quantity);
    if (!quantity) continue;

    const lookup = await findProductByName(tenantId, item?.product || "");
    if (!lookup.product) {
      missingProducts.push({
        requested: item?.product || "",
        suggestions: lookup.suggestions || [],
      });
      continue;
    }

    if (Number(lookup.product.stock || 0) < quantity) {
      insufficientStock.push({
        name: lookup.product.name,
        requestedQty: quantity,
        availableQty: Number(lookup.product.stock || 0),
      });
      continue;
    }

    const unitPrice = Number(lookup.product.price || 0);
    const subtotal = unitPrice * quantity;
    totalAmount += subtotal;
    items.push({
      productId: lookup.product._id,
      productName: lookup.product.name,
      quantity,
      unitPrice,
      subtotal,
      unitCostAtSale: Number(lookup.product.costPrice) || 0,
    });
  }

  if (items.length === 0) {
    return {
      ok: false,
      code: "NO_VALID_ITEMS",
      client: clientLookup.client,
      missingProducts,
      insufficientStock,
    };
  }

  return {
    ok: true,
    client: clientLookup.client,
    items,
    totalAmount,
    missingProducts,
    insufficientStock,
  };
};

const formatOrderDraftMessage = (draft) => {
  const lines = ["🧾 Resumen de orden:", `Cliente: ${draft.client.name || draft.client.phone}`];
  draft.items.forEach((item, index) => {
    lines.push(
      `${index + 1}. ${item.productName} · ${item.quantity} x ${formatMoney(item.unitPrice)} = ${formatMoney(item.subtotal)}`,
    );
  });
  lines.push(`Total: ${formatMoney(draft.totalAmount)}`);

  if (draft.missingProducts?.length) {
    lines.push(
      `No encontrados: ${draft.missingProducts
        .map((item) =>
          item.suggestions?.length
            ? `${item.requested} (quizás: ${item.suggestions.join(", ")})`
            : item.requested,
        )
        .join(" | ")}`,
    );
  }

  if (draft.insufficientStock?.length) {
    lines.push(
      `Sin stock suficiente: ${draft.insufficientStock
        .map((item) => `${item.name} (${item.requestedQty} solicitado / ${item.availableQty} disponible)`)
        .join(" | ")}`,
    );
  }

  lines.push("¿Confirmo y creo la venta? (Sí/No)");
  return lines.join("\n");
};

const notifyTenantUsers = async (tenantId, payload) => {
  try {
    const users = await User.find({ tenant: tenantId, isActive: true })
      .select("_id")
      .lean();
    if (!users.length) return;

    await Promise.all(
      users.map((user) =>
        createAndDispatchNotification({
          userId: user._id,
          ...payload,
        }),
      ),
    );
  } catch (error) {
    console.error("No se pudo despachar notificaciones de WhatsApp:", error);
  }
};

const resolveOrderIdentifier = (order) => order.orderNumber || String(order._id);

const buildOrderLineItemsText = (order) => {
  if (!Array.isArray(order.items) || order.items.length === 0) return "   - (sin items)";
  return order.items
    .map((item) => {
      const qty = Number(item.quantity || 0);
      const price = Number(item.price || 0);
      const subtotal = qty * price;
      return `   - ${item.product} · ${qty} x ${formatMoney(price)} = ${formatMoney(subtotal)}`;
    })
    .join("\n");
};

const buildInvoiceSuggestionMessage = (order) => {
  const orderRef = resolveOrderIdentifier(order);
  const appUrl = process.env.APP_WEB_URL || process.env.FRONTEND_URL || "";
  const salesLink = appUrl ? `${appUrl.replace(/\/+$/, "")}/sales` : null;
  return [
    "🧾 Factura sugerida:",
    `- Venta: ${orderRef}`,
    "- Puedes generar/enviar factura desde Ventas buscando ese número.",
    salesLink ? `🔗 ${salesLink}` : "",
  ]
    .filter(Boolean)
    .join("\n");
};

const buildClientSalesDetailsMessage = (clientData, orders = []) => {
  const lines = [
    `👤 Cliente: ${clientData.name || clientData.phone}`,
    `📞 Tel: ${clientData.phone || "-"}`,
    `🧾 Ventas encontradas: ${orders.length}`,
  ];

  if (orders.length === 0) {
    lines.push("No hay ventas registradas para este cliente.");
    return lines.join("\n");
  }

  orders.forEach((order, index) => {
    const dateLabel = order.createdAt
      ? new Date(order.createdAt).toLocaleString()
      : "sin fecha";
    lines.push(`\n🔹 Venta ${index + 1}`);
    lines.push(`🧩 Nro: ${resolveOrderIdentifier(order)}`);
    lines.push(`📅 Fecha: ${dateLabel}`);
    lines.push(`💰 Total: ${formatMoney(order.totalAmount)}`);
    lines.push(
      `📌 Estado: ${order.salesStatus || "-"} / ${order.paymentStatus || "-"} / ${order.deliveryStatus || "-"}`,
    );
    lines.push("🛍️ Items:");
    lines.push(buildOrderLineItemsText(order));
  });

  lines.push("\n👉 Si quieres factura, responde: factura 1, factura 2, etc.");
  return lines.join("\n");
};

const handleIncomingMessage = async (phone, messageBody, options = {}) => {
  try {
    const owner = options.tenantId ? null : await getWhatsAppOwnerId();
    const tenantId = options.tenantId || owner?.tenantId;
    let client = await Client.findOne({ tenant: tenantId, phone });
    if (!client) {
      client = await Client.create({ tenant: tenantId, phone, name: "Admin Fint Guard" });
    }

    client.conversationHistory = pruneConversationHistory(client);
    appendConversationEntry(client, "user", messageBody);

    // Si quedó una sugerencia pendiente, aceptamos "1/2/3" o nombre.
    const pendingSuggestionAge =
      client.pendingSuggestion?.createdAt
        ? Date.now() - new Date(client.pendingSuggestion.createdAt).getTime()
        : Number.POSITIVE_INFINITY;

    if (
      client.pendingSuggestion?.options?.length &&
      pendingSuggestionAge <= MEMORY_WINDOW_MS
    ) {
      const selectedName = resolveSuggestionSelection(
        messageBody,
        client.pendingSuggestion.options,
      );

      if (selectedName) {
        const pendingIntent = client.pendingSuggestion.intent;
        const pendingProduct = client.pendingSuggestion.product || {};
        client.pendingSuggestion = null;

        const classification = {
          intent: pendingIntent,
          product: { ...pendingProduct, name: selectedName },
        };
        await client.save();

        if (classification.intent === "CONSULTAR_STOCK") {
          const { product: productoDB } = await findProductByName(
            tenantId,
            classification.product.name,
          );
          if (!productoDB) {
            const msg = `No pude encontrar ${classification.product.name}. Intenta escribirlo completo.`;
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }
          const msg = `📦 *${productoDB.name}*\nStock actual: ${productoDB.stock} ${productoDB.unitOfMeasure || "unidades"}\nStock mínimo: ${productoDB.minStock}`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        if (classification.intent === "ENTRADA_STOCK" || classification.intent === "MERMA_STOCK") {
          client.pendingAction = classification;
          const msg =
            classification.intent === "ENTRADA_STOCK"
              ? `⚠️ Confirma:\n¿Agrego ${classification.product.quantity || 0} unidades de stock al producto *${classification.product.name}* (Motivo: ${classification.product.reason || "Ingreso"})?\n(Sí/No)`
              : `⚠️ Confirma:\n¿Registro la baja de ${classification.product.quantity || 0} unidades de *${classification.product.name}* por merma/pérdida (Motivo: ${classification.product.reason || "Pérdida"})?\n(Sí/No)`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        if (classification.intent === "CONSULTAR_CLIENTE") {
          const { client: matchedClient } = await findClientByName(
            tenantId,
            classification.client?.name || selectedName,
          );
          if (!matchedClient) {
            const msg = "No pude encontrar ese cliente. Intenta con otro nombre.";
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }

          const recentOrders = await Order.find({
            tenant: tenantId,
            client: matchedClient._id,
          })
            .sort({ createdAt: -1 })
            .limit(5)
            .lean();

          const totalSpent = recentOrders.reduce(
            (sum, order) => sum + Number(order.totalAmount || 0),
            0,
          );
          const msg = `👤 Cliente: ${matchedClient.name || matchedClient.phone}\nTel: ${matchedClient.phone || "-"}\nDeuda: ${formatMoney(matchedClient.debt || 0)}\nÚltimas ventas: ${recentOrders.length}\nMonto (últimas 5): ${formatMoney(totalSpent)}`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        if (classification.intent === "DETALLE_VENTAS_CLIENTE") {
          const { client: matchedClient } = await findClientByName(
            tenantId,
            classification.client?.name || selectedName,
          );
          if (!matchedClient) {
            const msg = "No pude encontrar ese cliente para mostrar ventas.";
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }

          const limit = Math.min(
            Math.max(Number(client.pendingSuggestion?.limit) || 5, 1),
            15,
          );
          const orders = await Order.find({
            tenant: tenantId,
            client: matchedClient._id,
          })
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

          const msg = buildClientSalesDetailsMessage(matchedClient, orders);
          client.pendingSuggestion =
            orders.length > 0
              ? {
                  intent: "FACTURA_VENTA",
                  kind: "order",
                  options: orders.map((order) => resolveOrderIdentifier(order)),
                  createdAt: new Date().toISOString(),
                }
              : null;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        if (classification.intent === "NUEVO_PEDIDO") {
          const orderWithSelectedClient = {
            ...(client.pendingSuggestion.order || {}),
            clientName: selectedName,
          };
          const draft = await buildOrderDraft(tenantId, orderWithSelectedClient);
          if (!draft.ok) {
            const msg = "No pude preparar la orden con ese cliente. Repite el pedido indicando cliente y productos.";
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }

          client.pendingAction = {
            intent: "NUEVO_PEDIDO",
            orderDraft: {
              clientId: draft.client._id,
              items: draft.items,
              totalAmount: draft.totalAmount,
              missingProducts: draft.missingProducts,
              insufficientStock: draft.insufficientStock,
            },
          };
          const msg = formatOrderDraftMessage(draft);
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        if (classification.intent === "FACTURA_VENTA") {
          const selectedOrderRef = selectedName;
          const byOrderNumber = await Order.findOne({
            tenant: tenantId,
            orderNumber: selectedOrderRef,
          }).lean();
          const byId = mongoose.Types.ObjectId.isValid(selectedOrderRef)
            ? await Order.findOne({ tenant: tenantId, _id: selectedOrderRef }).lean()
            : null;
          const order = byOrderNumber || byId;
          if (!order) {
            const msg = "No encontré esa venta para sugerir la factura.";
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }

          const msg = buildInvoiceSuggestionMessage(order);
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }
      } else {
        const msg = `No te entendí. Responde con el número de la opción o con el texto de la opción.\n${client.pendingSuggestion.options
          .map((name, index) => `${index + 1}. ${name}`)
          .join("\n")}`;
        appendConversationEntry(client, "assistant", msg);
        await client.save();
        return msg;
      }
    } else if (client.pendingSuggestion) {
      client.pendingSuggestion = null;
      await client.save();
    }

    // --- REGLA 2: ¿HAY UNA ACCIÓN ESPERANDO CONFIRMACIÓN? ---
    if (client.pendingAction) {
      // Usamos a Llama para entender si el usuario dijo "sí", "obvio", "dale" o si canceló
      const confirmPrompt = `El usuario debe confirmar esto: ${JSON.stringify(client.pendingAction)}.
            Su respuesta fue: "${messageBody}".
            ¿Está confirmando o cancelando?
            Responde ÚNICAMENTE con JSON: { "action": "CONFIRMAR" } o { "action": "CANCELAR" } o { "action": "INDECISO" }`;

      const confStr = await processText(confirmPrompt);
      const confData = safeJsonParse(confStr) || { action: "INDECISO" };

      if (confData.action === "CANCELAR") {
        client.pendingAction = null;
        const msg = "❌ Acción cancelada.";
        appendConversationEntry(client, "assistant", msg);
        await client.save();
        return msg;
      }
      if (confData.action === "INDECISO") {
        const msg = "⚠️ Por favor, responde 'Sí' para confirmar o 'No' para cancelar.";
        appendConversationEntry(client, "assistant", msg);
        await client.save();
        return msg;
      }

      // Si confirmó, sacamos la acción de la memoria para ejecutarla abajo
      var classification = client.pendingAction;
      client.pendingAction = null;
      await client.save();
    } else {
      // --- SI NO HAY ACCIÓN PENDIENTE, CLASIFICAMOS EL MENSAJE ---

      // REGLA 3: Router operativo para asistente-gestor.
      const conversationContext = getConversationContext(client);
      const routerPrompt = `
            Eres el asistente virtual operativo de una empresa en Fint Guard.
            Debes ser claro, breve y práctico. Siempre con enfoque en control de stock, ventas y clientes.
            Contexto de conversación reciente (últimos 5 días):
            ${conversationContext}
            Analiza el mensaje y devuelve ÚNICAMENTE JSON:
            1. Crear producto: { "intent": "CREAR_PRODUCTO", "product": { "name": "...", "price": 0, "stock": 0 } }
            2. Crear cliente: { "intent": "CREAR_CLIENTE", "client": { "name": "...", "phone": "...", "taxId": "..." } }
            3. Nuevo pedido (siempre requiere cliente): { "intent": "NUEVO_PEDIDO", "order": { "clientName": "...", "items": [{ "product": "...", "quantity": 1 }] } }
            4. Entrada de stock: { "intent": "ENTRADA_STOCK", "product": { "name": "...", "quantity": 0, "reason": "compra a proveedor" } }
            5. Merma / Pérdida: { "intent": "MERMA_STOCK", "product": { "name": "...", "quantity": 1, "reason": "se pudrió o rompió" } }
            6. Consultar stock: { "intent": "CONSULTAR_STOCK", "product": { "name": "..." } }
            7. Reporte bajo stock: { "intent": "REPORTE_BAJO_STOCK" }
            8. Listar productos: { "intent": "LISTAR_PRODUCTOS", "filters": { "lowStockOnly": false, "limit": 10 } }
            9. Listar clientes: { "intent": "LISTAR_CLIENTES", "filters": { "top": 10 } }
            10. Resumen ventas: { "intent": "RESUMEN_VENTAS", "period": "hoy|semana|mes" }
            11. Métricas negocio: { "intent": "METRICAS_NEGOCIO", "period": "mes" }
            12. Recomendación de reposición: { "intent": "RECOMENDAR_REPOSICION" }
            13. Consultar cliente: { "intent": "CONSULTAR_CLIENTE", "client": { "name": "..." } }
            14. Detalle ventas por cliente: { "intent": "DETALLE_VENTAS_CLIENTE", "client": { "name": "..." }, "limit": 5 }
            15. Sugerir factura de venta: { "intent": "FACTURA_VENTA", "order": { "orderNumber": "VTA-000123" } }
            16. Charla general: { "intent": "CHARLA_GENERAL", "message": "respuesta breve y útil orientada al negocio" }
            `;

      const jsonString = await processText(messageBody, routerPrompt);
      var classification = safeJsonParse(jsonString) || {
        intent: "CHARLA_GENERAL",
        message:
          "No pude clasificar con certeza. Pídeme algo puntual de stock, ventas o clientes.",
      };

      // --- FASE DE CONFIRMACIÓN ---
      // Si detectamos que quiere crear algo, lo guardamos en 'pendingAction' y detenemos la ejecución
      if (classification.intent === "NUEVO_PEDIDO") {
        const draft = await buildOrderDraft(tenantId, classification.order || {});

        if (!draft.ok) {
          if (draft.code === "CLIENT_REQUIRED") {
            const msg =
              "Para crear la venta necesito el cliente. Ejemplo: 'venta para Juan Perez: 2 coca cola y 1 arroz'.";
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }

          if (draft.code === "CLIENT_NOT_FOUND") {
            if (draft.suggestions?.length) {
              client.pendingSuggestion = {
                intent: "NUEVO_PEDIDO",
                kind: "client",
                order: classification.order || {},
                options: draft.suggestions,
                createdAt: new Date().toISOString(),
              };
              const msg = formatNumberedSuggestions(
                draft.requestedClientName || "cliente",
                draft.suggestions,
              );
              appendConversationEntry(client, "assistant", msg);
              await client.save();
              return msg;
            }
            const msg = `No encontré el cliente "${draft.requestedClientName}". Puedo mostrarte clientes si quieres.`;
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }

          if (draft.code === "ITEMS_REQUIRED") {
            const msg = "Indícame al menos un producto con cantidad para armar la venta.";
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }

          if (draft.code === "NO_VALID_ITEMS") {
            const missingText =
              draft.missingProducts?.length > 0
                ? `\nNo encontrados: ${draft.missingProducts
                    .map((item) =>
                      item.suggestions?.length
                        ? `${item.requested} (quizás: ${item.suggestions.join(", ")})`
                        : item.requested,
                    )
                    .join(" | ")}`
                : "";
            const insufficientText =
              draft.insufficientStock?.length > 0
                ? `\nSin stock: ${draft.insufficientStock
                    .map(
                      (item) =>
                        `${item.name} (${item.requestedQty} solicitado / ${item.availableQty} disponible)`,
                    )
                    .join(" | ")}`
                : "";
            const msg = `No pude armar la venta con los productos indicados.${missingText}${insufficientText}`;
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }
        }

        client.pendingAction = {
          intent: "NUEVO_PEDIDO",
          orderDraft: {
            clientId: draft.client._id,
            items: draft.items,
            totalAmount: draft.totalAmount,
            missingProducts: draft.missingProducts,
            insufficientStock: draft.insufficientStock,
          },
        };
        const msg = formatOrderDraftMessage(draft);
        appendConversationEntry(client, "assistant", msg);
        await client.save();
        return msg;
      }

      if (
        classification.intent === "CREAR_CLIENTE" ||
        classification.intent === "CREAR_PRODUCTO" ||
        classification.intent === "ENTRADA_STOCK" ||
        classification.intent === "MERMA_STOCK"
      ) {
        client.pendingAction = classification;

        if (classification.intent === "CREAR_CLIENTE") {
          const nextClient = classification.client || {};
          const msg = `⚠️ Confirma:\n¿Creo el cliente *${nextClient.name || "sin nombre"}* con teléfono *${nextClient.phone || "-"}* y documento *${nextClient.taxId || "-"}*?\n(Sí/No)`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        } else if (classification.intent === "CREAR_PRODUCTO") {
          const product = classification.product || {};
          const msg = `⚠️ Confirma:\n¿Guardo el producto *${product.name || "sin nombre"}* a $${product.price || 0} con ${product.stock || 0} de stock?\n(Sí/No)`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        } else if (classification.intent === "NUEVO_PEDIDO") {
          const detailsItems = Array.isArray(classification.order?.items)
            ? classification.order.items
            : [];
          const detalles = detailsItems
            .map((i) => `${i.quantity}x ${i.product}`)
            .join(", ");
          const msg = `⚠️ Confirma:\n¿Registro la venta de: ${detalles}?\n(Sí/No)`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        } else if (classification.intent === "ENTRADA_STOCK") {
          const product = classification.product || {};
          const msg = `⚠️ Confirma:\n¿Agrego ${product.quantity || 0} unidades de stock al producto *${product.name || "sin nombre"}* (Motivo: ${product.reason || "Ingreso"})?\n(Sí/No)`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        } else if (classification.intent === "MERMA_STOCK") {
          const product = classification.product || {};
          const msg = `⚠️ Confirma:\n¿Registro la baja de ${product.quantity || 0} unidades de *${product.name || "sin nombre"}* por merma/pérdida (Motivo: ${product.reason || "Pérdida"})?\n(Sí/No)`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }
      }
    }

    client.pendingSuggestion = null;

    // --- EJECUCIÓN (Solo llega aquí si se acaba de confirmar o si es una charla/consulta) ---
    switch (classification.intent) {
      case "CREAR_CLIENTE": {
        const payload = classification.client || {};
        const clientName = (payload.name || "").toString().trim();
        const clientPhone = normalizePhone(payload.phone || "");
        const clientTaxId = (payload.taxId || "").toString().trim();

        if (!clientName || !clientPhone) {
          const msg = "❌ Para crear el cliente necesito al menos nombre y teléfono.";
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        const existingClient = await Client.findOne({
          tenant: tenantId,
          phone: clientPhone,
        });

        if (existingClient) {
          const msg = `⚠️ Ya existe un cliente con ese teléfono: ${existingClient.name || existingClient.phone}`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        const newClient = await Client.create({
          tenant: tenantId,
          name: clientName,
          phone: clientPhone,
          taxId: clientTaxId || "",
          isActive: true,
          deletedAt: null,
        });

        await notifyTenantUsers(tenantId, {
          type: "success",
          title: "Cliente creado desde WhatsApp",
          message: `Se creó el cliente ${newClient.name || newClient.phone}.`,
          metadata: {
            source: "WhatsApp",
            clientId: newClient._id,
            phone: newClient.phone,
          },
        });

        const msg = `✅ Cliente creado: ${newClient.name} · ${newClient.phone}`;
        appendConversationEntry(client, "assistant", msg);
        await client.save();
        return msg;
      }

      case "CREAR_PRODUCTO": {
        const { name, price, stock } = classification.product || {};
        const productName = (name || "").toString().trim().toLowerCase();
        const rawStock = Number(stock);
        const stockDelta = Number.isFinite(rawStock) ? rawStock : 0;
        const safePrice = Number(price) || 0;
        const session = await mongoose.startSession();

        if (!productName) {
          return "❌ Debes indicar un nombre de producto válido.";
        }
        if (stockDelta < 0) {
          return "❌ El stock inicial no puede ser negativo.";
        }

        try {
          session.startTransaction();
          const existingProduct = await Product.findOne({
            tenant: tenantId,
            name: productName,
          }).session(session);
          const stockBefore = existingProduct ? existingProduct.stock : 0;

          const producto = await Product.findOneAndUpdate(
            { tenant: tenantId, name: productName },
            { tenant: tenantId, price: safePrice, $inc: { stock: stockDelta } },
            { returnDocument: "after", upsert: true, session },
          );

          if (stockDelta > 0) {
            await StockMovement.create(
              [
                {
                  tenant: tenantId,
                  product: producto._id,
                  type: "ENTRADA",
                  quantity: stockDelta,
                  stockBefore,
                  stockAfter: producto.stock,
                  reason:
                    stockBefore === 0
                      ? "Stock Inicial al crear producto"
                      : "Actualización al crear desde WA",
                },
              ],
              { session },
            );
          }

          await session.commitTransaction();
          session.endSession();

          await notifyTenantUsers(tenantId, {
            type: "success",
            title: "Producto actualizado desde WhatsApp",
            message: `${producto.name} quedó con stock ${producto.stock}.`,
            metadata: {
              source: "WhatsApp",
              productId: producto._id,
              stock: producto.stock,
            },
          });

          const msg = `✅ Guardado: *${producto.name}* ($${producto.price}). Stock actual: ${producto.stock}`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          throw error;
        }
      }

      case "NUEVO_PEDIDO": {
        const draft =
          classification.orderDraft ||
          (await (async () => {
            const built = await buildOrderDraft(tenantId, classification.order || {});
            if (!built.ok) return null;
            return {
              clientId: built.client._id,
              items: built.items,
              totalAmount: built.totalAmount,
              missingProducts: built.missingProducts,
              insufficientStock: built.insufficientStock,
            };
          })());

        if (!draft || !Array.isArray(draft.items) || draft.items.length === 0) {
          const msg =
            "No pude ejecutar la venta porque faltan datos. Indica cliente y productos para reconstruir la orden.";
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        const session = await mongoose.startSession();
        try {
          session.startTransaction();

          let totalAmount = 0;
          const itemsParaGuardar = [];
          const noEncontrados = [];
          const movimientosPendientes = [];

          for (const item of draft.items) {
            const quantity = toPositiveNumber(item?.quantity);
            if (!quantity) continue;

            const productId = toObjectId(item.productId);
            const productoDB = await withSession(
              Product.findOne({ tenant: tenantId, _id: productId }),
              session,
            );

            if (!productoDB) {
              noEncontrados.push(item.productName || "producto");
              continue;
            }

            if (productoDB.stock < quantity) {
              throw new Error(
                `Stock insuficiente para ${productoDB.name}. Disponible: ${productoDB.stock}`,
              );
            }

            const unitPrice = Number(item.unitPrice || productoDB.price || 0);
            totalAmount += unitPrice * quantity;
            itemsParaGuardar.push({
              product: productoDB.name,
              quantity,
              price: unitPrice,
              productId: productoDB._id,
              unitCostAtSale:
                Number(item.unitCostAtSale) || Number(productoDB.costPrice) || 0,
            });

            const stockAnterior = productoDB.stock;
            productoDB.stock -= quantity;
            await productoDB.save({ session });

            movimientosPendientes.push({
              tenant: tenantId,
              product: productoDB._id,
              type: "SALIDA",
              quantity,
              stockBefore: stockAnterior,
              stockAfter: productoDB.stock,
              reason: "Venta por WhatsApp",
            });
          }

          if (itemsParaGuardar.length === 0) {
            await session.abortTransaction();
            session.endSession();
            return "❌ Productos no encontrados en el sistema.";
          }

          const [newOrder] = await Order.create(
            [
              {
                tenant: tenantId,
                client: draft.clientId,
                items: itemsParaGuardar,
                totalAmount,
                status: "Entregado",
                salesStatus: "Confirmada",
                paymentStatus: "Pagado",
                deliveryStatus: "Entregada",
                confirmedAt: new Date(),
                paidAt: new Date(),
                deliveredAt: new Date(),
                stockApplied: true,
                stockAppliedAt: new Date(),
                source: "WhatsApp",
              },
            ],
            { session },
          );

          const movementsWithOrder = movimientosPendientes.map((movement) => ({
            ...movement,
            order: newOrder._id,
          }));

          if (movementsWithOrder.length > 0) {
            await StockMovement.insertMany(movementsWithOrder, { session });
          }

          await session.commitTransaction();
          session.endSession();

          let resp = `✅ Venta registrada (Total: $${totalAmount})\n`;
          if (noEncontrados.length > 0) {
            resp += `⚠️ Faltó: ${noEncontrados.join(", ")}`;
          }

          if (typeof options.sendInvoicePdf === "function") {
            try {
              const [clientData, storeData] = await Promise.all([
                Client.findOne({ _id: draft.clientId, tenant: tenantId }).lean(),
                Setting.findOne({ tenant: tenantId })
                  .select("storeName taxId phone email")
                  .lean(),
              ]);

              const pdfPath = await generateInvoicePdf({
                order: {
                  ...newOrder.toObject(),
                  items: itemsParaGuardar,
                  totalAmount,
                },
                client: clientData || {},
                store: storeData || {},
              });

              await options.sendInvoicePdf({
                pdfPath,
                caption: `Factura ${resolveOrderIdentifier(newOrder)} · Total ${formatMoney(totalAmount)}`,
              });
              resp += "\n🧾 Factura PDF enviada.";
            } catch (invoiceError) {
              console.error("No se pudo enviar la factura PDF:", invoiceError);
              resp += "\n⚠️ La venta se guardó, pero no pude enviar la factura PDF.";
            }
          }

          await notifyTenantUsers(tenantId, {
            type: "success",
            title: "Venta creada desde WhatsApp",
            message: `Se registró la venta ${resolveOrderIdentifier(newOrder)} por ${formatMoney(
              totalAmount,
            )}.`,
            metadata: {
              source: "WhatsApp",
              orderId: newOrder._id,
              orderNumber: newOrder.orderNumber || null,
              totalAmount,
            },
          });

          appendConversationEntry(client, "assistant", resp.trim());
          await client.save();
          return resp;
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          throw error;
        }
      }

      case "ENTRADA_STOCK": {
        const { name, quantity, reason } = classification.product || {};
        const qty = toPositiveNumber(quantity);
        if (!qty) {
          return "❌ La cantidad debe ser mayor a cero.";
        }

        const session = await mongoose.startSession();
        try {
          session.startTransaction();

          const { product: productoDB, suggestions } = await findProductByName(
            tenantId,
            name,
            session,
          );

          if (!productoDB) {
            await session.abortTransaction();
            session.endSession();
            if (suggestions.length > 0) {
              client.pendingSuggestion = {
                intent: "ENTRADA_STOCK",
                product: { name, quantity: qty, reason },
                options: suggestions,
                createdAt: new Date().toISOString(),
              };
              const msg = formatNumberedSuggestions(name, suggestions);
              appendConversationEntry(client, "assistant", msg);
              await client.save();
              return msg;
            }
            const msg = `❌ Producto no encontrado: ${name}. Si quieres crearlo, dímelo.`;
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }

          const stockAnterior = productoDB.stock;
          productoDB.stock += qty;
          await productoDB.save({ session });

          await StockMovement.create(
            [
              {
                tenant: tenantId,
                product: productoDB._id,
                type: "ENTRADA",
                quantity: qty,
                stockBefore: stockAnterior,
                stockAfter: productoDB.stock,
                reason: reason || "Entrada manual de stock",
                source: "WhatsApp",
              },
            ],
            { session },
          );

          await session.commitTransaction();
          session.endSession();
          await notifyTenantUsers(tenantId, {
            type: "info",
            title: "Ingreso de stock desde WhatsApp",
            message: `${productoDB.name}: +${qty} (${reason || "Entrada manual de stock"}).`,
            metadata: {
              source: "WhatsApp",
              productId: productoDB._id,
              movementType: "ENTRADA",
              quantity: qty,
            },
          });
          const msg = `✅ Stock actualizado: *${productoDB.name}* tiene ahora ${productoDB.stock} unidades.`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          throw error;
        }
      }

      case "MERMA_STOCK": {
        const { name, quantity, reason } = classification.product || {};
        const qty = toPositiveNumber(quantity);
        if (!qty) {
          return "❌ La cantidad debe ser mayor a cero.";
        }

        const session = await mongoose.startSession();
        try {
          session.startTransaction();

          const { product: productoDB, suggestions } = await findProductByName(
            tenantId,
            name,
            session,
          );

          if (!productoDB) {
            await session.abortTransaction();
            session.endSession();
            if (suggestions.length > 0) {
              client.pendingSuggestion = {
                intent: "MERMA_STOCK",
                product: { name, quantity: qty, reason },
                options: suggestions,
                createdAt: new Date().toISOString(),
              };
              const msg = formatNumberedSuggestions(name, suggestions);
              appendConversationEntry(client, "assistant", msg);
              await client.save();
              return msg;
            }
            const msg = `❌ Producto no encontrado: ${name}.`;
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }

          const stockAnterior = productoDB.stock;
          if (stockAnterior < qty) {
            await session.abortTransaction();
            session.endSession();
            return `❌ Stock insuficiente para ${productoDB.name}. Disponible: ${stockAnterior}.`;
          }

          productoDB.stock -= qty;
          await productoDB.save({ session });

          await StockMovement.create(
            [
              {
                tenant: tenantId,
                product: productoDB._id,
                type: "MERMA",
                quantity: qty,
                stockBefore: stockAnterior,
                stockAfter: productoDB.stock,
                reason: reason || "Reporte de merma/perdida",
                source: "WhatsApp",
              },
            ],
            { session },
          );

          await session.commitTransaction();
          session.endSession();
          await notifyTenantUsers(tenantId, {
            type: "warning",
            title: "Merma registrada desde WhatsApp",
            message: `${productoDB.name}: -${qty} (${reason || "Reporte de merma/perdida"}).`,
            metadata: {
              source: "WhatsApp",
              productId: productoDB._id,
              movementType: "MERMA",
              quantity: qty,
            },
          });
          const msg = `✅ Baja registrada: *${productoDB.name}* bajo a ${productoDB.stock} unidades.`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          throw error;
        }
      }

      case "CONSULTAR_STOCK": {
        const { name } = classification.product || {};
        if (!name) return "Por favor, especifica el nombre del producto.";

        const { product: productoDB, suggestions } = await findProductByName(
          tenantId,
          name,
        );

        if (productoDB) {
          const msg = `📦 *${productoDB.name}*\nStock actual: ${productoDB.stock} ${productoDB.unitOfMeasure || "unidades"}\nStock mínimo: ${productoDB.minStock}`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        } else {
          if (suggestions.length > 0) {
            client.pendingSuggestion = {
              intent: "CONSULTAR_STOCK",
              product: { name },
              options: suggestions,
              createdAt: new Date().toISOString(),
            };
            const msg = formatNumberedSuggestions(name, suggestions);
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }
          const msg = `❌ No encontré ningún producto llamado "${name}".`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }
      }

      case "REPORTE_BAJO_STOCK": {
        // Busca todos los productos donde el stock actual sea menor o igual al stock mínimo
        const productos = await Product.find({
          tenant: tenantId,
          $expr: { $lte: ["$stock", "$minStock"] },
        });

        if (productos.length === 0) {
          return "✅ ¡Todo excelente! Ningún producto está por debajo del stock mínimo.";
        }

        let msj = "⚠️ *Alerta de bajo stock*:\n";
        productos.forEach((p) => {
          msj += `- ${p.name}: ${p.stock} (Mínimo: ${p.minStock})\n`;
        });
        appendConversationEntry(client, "assistant", msj.trim());
        await client.save();
        return msj;
      }

      case "CONSULTAR_CLIENTE": {
        const requestedName = (classification?.client?.name || "").toString().trim();
        if (!requestedName) {
          const msg = "Indícame el nombre o teléfono del cliente para buscarlo.";
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        const lookup = await findClientByName(tenantId, requestedName);
        if (!lookup.client) {
          if (lookup.suggestions?.length) {
            client.pendingSuggestion = {
              intent: "CONSULTAR_CLIENTE",
              kind: "client",
              client: { name: requestedName },
              options: lookup.suggestions,
              createdAt: new Date().toISOString(),
            };
            const msg = formatNumberedSuggestions(requestedName, lookup.suggestions);
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }
          const msg = `No encontré el cliente "${requestedName}".`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        const recentOrders = await Order.find({
          tenant: tenantId,
          client: lookup.client._id,
        })
          .sort({ createdAt: -1 })
          .limit(10)
          .lean();

        const totalSpent = recentOrders.reduce(
          (sum, order) => sum + Number(order.totalAmount || 0),
          0,
        );
        const lastOrderDate = recentOrders[0]?.createdAt
          ? new Date(recentOrders[0].createdAt).toLocaleString()
          : "Sin compras";

        const msg = `👤 Cliente: ${lookup.client.name || lookup.client.phone}\nTel: ${lookup.client.phone || "-"}\nEmail: ${lookup.client.email || "-"}\nEmpresa: ${lookup.client.company || "-"}\nDeuda: ${formatMoney(lookup.client.debt || 0)}\nÓrdenes recientes: ${recentOrders.length}\nMonto en últimas 10: ${formatMoney(totalSpent)}\nÚltima compra: ${lastOrderDate}`;
        appendConversationEntry(client, "assistant", msg);
        await client.save();
        return msg;
      }

      case "DETALLE_VENTAS_CLIENTE": {
        const requestedName = (classification?.client?.name || "").toString().trim();
        const limit = Math.min(Math.max(Number(classification?.limit) || 5, 1), 15);
        if (!requestedName) {
          const msg =
            "Indícame el cliente para mostrar ventas. Ejemplo: 'detalle ventas de Juan Perez'.";
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        const lookup = await findClientByName(tenantId, requestedName);
        if (!lookup.client) {
          if (lookup.suggestions?.length) {
            client.pendingSuggestion = {
              intent: "DETALLE_VENTAS_CLIENTE",
              kind: "client",
              client: { name: requestedName },
              limit,
              options: lookup.suggestions,
              createdAt: new Date().toISOString(),
            };
            const msg = formatNumberedSuggestions(requestedName, lookup.suggestions);
            appendConversationEntry(client, "assistant", msg);
            await client.save();
            return msg;
          }
          const msg = `No encontré al cliente "${requestedName}".`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        const orders = await Order.find({
          tenant: tenantId,
          client: lookup.client._id,
        })
          .sort({ createdAt: -1 })
          .limit(limit)
          .lean();

        const msg = buildClientSalesDetailsMessage(lookup.client, orders);
        client.pendingSuggestion =
          orders.length > 0
            ? {
                intent: "FACTURA_VENTA",
                kind: "order",
                options: orders.map((order) => resolveOrderIdentifier(order)),
                createdAt: new Date().toISOString(),
              }
            : null;
        appendConversationEntry(client, "assistant", msg);
        await client.save();
        return msg;
      }

      case "FACTURA_VENTA": {
        const requestedOrderRef = (classification?.order?.orderNumber || "").toString().trim();
        if (!requestedOrderRef) {
          const msg =
            "Indícame el número de venta. Ejemplo: 'factura VTA-000123' o pide detalle de ventas del cliente.";
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        const order = await Order.findOne({
          tenant: tenantId,
          $or: [
            { orderNumber: requestedOrderRef },
            ...(mongoose.Types.ObjectId.isValid(requestedOrderRef)
              ? [{ _id: requestedOrderRef }]
              : []),
          ],
        }).lean();

        if (!order) {
          const msg = `No encontré la venta "${requestedOrderRef}".`;
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }

        const msg = buildInvoiceSuggestionMessage(order);
        appendConversationEntry(client, "assistant", msg);
        await client.save();
        return msg;
      }

      case "LISTAR_PRODUCTOS": {
        const onlyLowStock = Boolean(classification?.filters?.lowStockOnly);
        const limit = Math.min(
          Math.max(Number(classification?.filters?.limit) || 10, 1),
          30,
        );
        const filter = {
          tenant: tenantId,
          isActive: { $ne: false },
        };

        const products = onlyLowStock
          ? await Product.find({
              ...filter,
              $expr: { $lte: ["$stock", "$minStock"] },
            })
              .sort({ stock: 1, name: 1 })
              .limit(limit)
          : await Product.find(filter).sort({ updatedAt: -1 }).limit(limit);

        if (products.length === 0) {
          return onlyLowStock
            ? "No hay productos en estado de bajo stock."
            : "No hay productos cargados.";
        }

        let message = onlyLowStock
          ? `⚠️ *Bajo stock* (${products.length}):\n`
          : `📦 *Productos* (${products.length}):\n`;
        for (const product of products) {
          message += `🔹 ${product.name}\n   📊 Stock: ${product.stock} ${product.unitOfMeasure || "un"}\n   💵 Precio: ${formatMoney(product.price)}\n`;
        }
        const response = message.trim();
        appendConversationEntry(client, "assistant", response);
        await client.save();
        return response;
      }

      case "LISTAR_CLIENTES": {
        const top = Math.min(Math.max(Number(classification?.filters?.top) || 10, 1), 30);
        const clients = await Client.find({
          tenant: tenantId,
          isActive: { $ne: false },
        })
          .sort({ updatedAt: -1 })
          .limit(top)
          .lean();

        if (clients.length === 0) return "No hay clientes registrados.";

        let message = `👥 *Clientes recientes* (${clients.length}):\n`;
        for (const clientItem of clients) {
          const label = clientItem.name || clientItem.phone;
          message += `🔹 ${label}${clientItem.phone ? ` · ${clientItem.phone}` : ""}\n`;
        }
        const response = message.trim();
        appendConversationEntry(client, "assistant", response);
        await client.save();
        return response;
      }

      case "RESUMEN_VENTAS": {
        const period = (classification?.period || "mes").toString().toLowerCase();
        const now = new Date();
        const fromDate = new Date(now);

        if (period === "hoy") {
          fromDate.setHours(0, 0, 0, 0);
        } else if (period === "semana") {
          fromDate.setDate(now.getDate() - 7);
        } else {
          fromDate.setDate(now.getDate() - 30);
        }

        const orders = await Order.find({
          tenant: tenantId,
          createdAt: { $gte: fromDate },
          salesStatus: { $ne: "Cancelada" },
        }).lean();

        if (orders.length === 0) return "No hay ventas en ese período.";

        const revenue = orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0);
        const avgTicket = revenue / orders.length;
        const response = `📈 *Resumen de ventas (${period})*\n🔹 Operaciones: ${orders.length}\n🔹 Facturación: ${formatMoney(revenue)}\n🔹 Ticket promedio: ${formatMoney(avgTicket)}`;
        appendConversationEntry(client, "assistant", response);
        await client.save();
        return response;
      }

      case "METRICAS_NEGOCIO": {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

        const [currentMonthOrders, previousMonthOrders, lowStockCount, activeClients] =
          await Promise.all([
            Order.find({
              tenant: tenantId,
              createdAt: { $gte: monthStart },
              salesStatus: { $ne: "Cancelada" },
            }).lean(),
            Order.find({
              tenant: tenantId,
              createdAt: { $gte: previousMonthStart, $lt: monthStart },
              salesStatus: { $ne: "Cancelada" },
            }).lean(),
            Product.countDocuments({
              tenant: tenantId,
              isActive: { $ne: false },
              $expr: { $lte: ["$stock", "$minStock"] },
            }),
            Client.countDocuments({ tenant: tenantId, isActive: { $ne: false } }),
          ]);

        const currentRevenue = currentMonthOrders.reduce(
          (sum, order) => sum + Number(order.totalAmount || 0),
          0,
        );
        const previousRevenue = previousMonthOrders.reduce(
          (sum, order) => sum + Number(order.totalAmount || 0),
          0,
        );
        const growth =
          previousRevenue > 0
            ? ((currentRevenue - previousRevenue) / previousRevenue) * 100
            : currentRevenue > 0
              ? 100
              : 0;

        const response = `📊 *Métricas del negocio*\n🔹 Ventas del mes: ${currentMonthOrders.length}\n🔹 Facturación del mes: ${formatMoney(currentRevenue)}\n🔹 Variación vs mes anterior: ${growth.toFixed(1)}%\n🔹 Productos en bajo stock: ${lowStockCount}\n🔹 Clientes activos: ${activeClients}`;
        appendConversationEntry(client, "assistant", response);
        await client.save();
        return response;
      }

      case "RECOMENDAR_REPOSICION": {
        const tenantObjectId = toObjectId(tenantId);
        if (!tenantObjectId) {
          return "No pude calcular recomendaciones por un problema de identificación de la empresa.";
        }

        const since = new Date();
        since.setDate(since.getDate() - 30);

        const salesByProduct = await Order.aggregate([
          {
            $match: {
              tenant: tenantObjectId,
              createdAt: { $gte: since },
              salesStatus: { $ne: "Cancelada" },
            },
          },
          { $unwind: "$items" },
          {
            $group: {
              _id: "$items.productId",
              soldQty: { $sum: "$items.quantity" },
            },
          },
          { $match: { _id: { $ne: null }, soldQty: { $gt: 0 } } },
          { $sort: { soldQty: -1 } },
          { $limit: 30 },
        ]);

        if (salesByProduct.length === 0) {
          return "Todavía no hay ventas suficientes para recomendar reposición.";
        }

        const productIds = salesByProduct.map((item) => item._id);
        const products = await Product.find({
          tenant: tenantId,
          _id: { $in: productIds },
        })
          .select("name stock minStock unitOfMeasure")
          .lean();

        const productMap = new Map(products.map((p) => [String(p._id), p]));
        const recommendations = salesByProduct
          .map((item) => {
            const product = productMap.get(String(item._id));
            if (!product) return null;
            const avgDaily = Number(item.soldQty || 0) / 30;
            const coverDays = avgDaily > 0 ? Number(product.stock || 0) / avgDaily : 999;
            return {
              name: product.name,
              stock: Number(product.stock || 0),
              minStock: Number(product.minStock || 0),
              coverDays,
              unit: product.unitOfMeasure || "un",
            };
          })
          .filter(Boolean)
          .filter((item) => item.coverDays <= 10 || item.stock <= item.minStock)
          .sort((a, b) => a.coverDays - b.coverDays)
          .slice(0, 5);

        if (recommendations.length === 0) {
          return "✅ Tu reposición viene bien. No veo urgencias para los próximos 10 días.";
        }

        let message = "🧠 *Reposición recomendada*:\n";
        for (const item of recommendations) {
          message += `🔹 ${item.name}\n   📦 Stock: ${item.stock} ${item.unit}\n   ⏱️ Cobertura: ~${item.coverDays.toFixed(1)} días\n`;
        }
        message += "Sugerencia: prioriza primero los de menor cobertura.";
        const response = message.trim();
        appendConversationEntry(client, "assistant", response);
        await client.save();
        return response;
      }

      case "CHARLA_GENERAL":
      default:
        {
          const msg =
          classification.message ||
          "Estoy para ayudarte con stock, ventas, clientes, métricas y recomendaciones.";
          appendConversationEntry(client, "assistant", msg);
          await client.save();
          return msg;
        }
    }
  } catch (error) {
    console.error("Error IA:", error);
    return "❌ Error procesando solicitud.";
  }
};

module.exports = { handleIncomingMessage };
