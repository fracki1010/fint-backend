const mongoose = require("mongoose");
const { processText } = require("../services/groqService");
const Client = require("../models/client.model");
const { Product } = require("../models/product.model");
const Order = require("../models/order.model");
const StockMovement = require("../models/stockMovement.model");
const User = require("../models/user.model");

let cachedWhatsAppOwner = null;
const MEMORY_WINDOW_MS = 5 * 24 * 60 * 60 * 1000;
const MAX_HISTORY_ITEMS = 80;

const toPositiveNumber = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};

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
      } else {
        const msg = `No te entendí. Responde con el número de la opción o con el nombre del producto.\n${client.pendingSuggestion.options
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
            2. Nuevo pedido: { "intent": "NUEVO_PEDIDO", "order": { "clientName": "...", "items": [{ "product": "...", "quantity": 1 }] } }
            3. Entrada de stock: { "intent": "ENTRADA_STOCK", "product": { "name": "...", "quantity": 0, "reason": "compra a proveedor" } }
            4. Merma / Pérdida: { "intent": "MERMA_STOCK", "product": { "name": "...", "quantity": 1, "reason": "se pudrió o rompió" } }
            5. Consultar stock: { "intent": "CONSULTAR_STOCK", "product": { "name": "..." } }
            6. Reporte bajo stock: { "intent": "REPORTE_BAJO_STOCK" }
            7. Listar productos: { "intent": "LISTAR_PRODUCTOS", "filters": { "lowStockOnly": false, "limit": 10 } }
            8. Listar clientes: { "intent": "LISTAR_CLIENTES", "filters": { "top": 10 } }
            9. Resumen ventas: { "intent": "RESUMEN_VENTAS", "period": "hoy|semana|mes" }
            10. Métricas negocio: { "intent": "METRICAS_NEGOCIO", "period": "mes" }
            11. Recomendación de reposición: { "intent": "RECOMENDAR_REPOSICION" }
            12. Charla general: { "intent": "CHARLA_GENERAL", "message": "respuesta breve y útil orientada al negocio" }
            `;

      const jsonString = await processText(messageBody, routerPrompt);
      var classification = safeJsonParse(jsonString) || {
        intent: "CHARLA_GENERAL",
        message:
          "No pude clasificar con certeza. Pídeme algo puntual de stock, ventas o clientes.",
      };

      // --- FASE DE CONFIRMACIÓN ---
      // Si detectamos que quiere crear algo, lo guardamos en 'pendingAction' y detenemos la ejecución
      if (
        classification.intent === "CREAR_PRODUCTO" ||
        classification.intent === "NUEVO_PEDIDO" ||
        classification.intent === "ENTRADA_STOCK" ||
        classification.intent === "MERMA_STOCK"
      ) {
        client.pendingAction = classification;

        if (classification.intent === "CREAR_PRODUCTO") {
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

          return `✅ Guardado: *${producto.name}* ($${producto.price}). Stock actual: ${producto.stock}`;
        } catch (error) {
          await session.abortTransaction();
          session.endSession();
          throw error;
        }
      }

      case "NUEVO_PEDIDO": {
        const orderData = classification.order;
        const requestedItems = Array.isArray(orderData?.items) ? orderData.items : [];
        if (requestedItems.length === 0) {
          return "❌ No se detectaron productos en el pedido.";
        }

        const session = await mongoose.startSession();
        try {
          session.startTransaction();

          let totalAmount = 0;
          const itemsParaGuardar = [];
          const noEncontrados = [];
          const movimientosPendientes = [];

          for (const item of requestedItems) {
            const quantity = toPositiveNumber(item?.quantity);
            if (!quantity) continue;

            const { product: productoDB, suggestions } = await findProductByName(
              tenantId,
              item.product,
              session,
            );

            if (!productoDB) {
              if (suggestions.length > 0) {
                noEncontrados.push(
                  `${item.product} (quizás quisiste: ${suggestions.join(", ")})`,
                );
              } else {
                noEncontrados.push(item.product);
              }
              continue;
            }

            if (productoDB.stock < quantity) {
              throw new Error(
                `Stock insuficiente para ${productoDB.name}. Disponible: ${productoDB.stock}`,
              );
            }

            totalAmount += productoDB.price * quantity;
            itemsParaGuardar.push({
              product: productoDB.name,
              quantity,
              price: productoDB.price,
              productId: productoDB._id,
              unitCostAtSale: Number(productoDB.costPrice) || 0,
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
                client: client._id,
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
          return `✅ Stock actualizado: *${productoDB.name}* tiene ahora ${productoDB.stock} unidades.`;
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
          return `✅ Baja registrada: *${productoDB.name}* bajo a ${productoDB.stock} unidades.`;
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
        return msj;
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

        let message = onlyLowStock ? "⚠️ Bajo stock:\n" : "📦 Productos:\n";
        for (const product of products) {
          message += `- ${product.name}: ${product.stock} ${product.unitOfMeasure || "un"} · ${formatMoney(product.price)}\n`;
        }
        return message.trim();
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

        let message = "👥 Clientes recientes:\n";
        for (const clientItem of clients) {
          const label = clientItem.name || clientItem.phone;
          message += `- ${label}${clientItem.phone ? ` · ${clientItem.phone}` : ""}\n`;
        }
        return message.trim();
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
        return `📈 Ventas (${period}):\n- Operaciones: ${orders.length}\n- Facturación: ${formatMoney(revenue)}\n- Ticket promedio: ${formatMoney(avgTicket)}`;
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

        return `📊 Métricas del negocio:\n- Ventas del mes: ${currentMonthOrders.length}\n- Facturación del mes: ${formatMoney(currentRevenue)}\n- Variación vs mes anterior: ${growth.toFixed(1)}%\n- Productos en bajo stock: ${lowStockCount}\n- Clientes activos: ${activeClients}`;
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

        let message = "🧠 Reposición recomendada:\n";
        for (const item of recommendations) {
          message += `- ${item.name}: stock ${item.stock} ${item.unit}, cobertura ~${item.coverDays.toFixed(1)} días\n`;
        }
        message += "Sugerencia: prioriza primero los de menor cobertura.";
        return message.trim();
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
