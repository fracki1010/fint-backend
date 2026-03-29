const mongoose = require("mongoose");
const { processText } = require("../services/groqService");
const Client = require("../models/client.model");
const { Product } = require("../models/product.model");
const Order = require("../models/order.model");
const StockMovement = require("../models/stockMovement.model");
const User = require("../models/user.model");

let cachedWhatsAppOwner = null;

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

const handleIncomingMessage = async (phone, messageBody) => {
  try {
    const owner = await getWhatsAppOwnerId();
    const userId = owner.userId;
    const tenantId = owner.tenantId;
    let client = await Client.findOne({ tenant: tenantId, phone });
    if (!client) {
      client = await Client.create({ tenant: tenantId, phone, name: "Admin Fint Guard" });
    }

    // --- REGLA 2: ¿HAY UNA ACCIÓN ESPERANDO CONFIRMACIÓN? ---
    if (client.pendingAction) {
      // Usamos a Llama para entender si el usuario dijo "sí", "obvio", "dale" o si canceló
      const confirmPrompt = `El usuario debe confirmar esto: ${JSON.stringify(client.pendingAction)}.
            Su respuesta fue: "${messageBody}".
            ¿Está confirmando o cancelando?
            Responde ÚNICAMENTE con JSON: { "action": "CONFIRMAR" } o { "action": "CANCELAR" } o { "action": "INDECISO" }`;

      const confStr = await processText(confirmPrompt);
      const confData = JSON.parse(confStr.replace(/```json|```/g, "").trim());

      if (confData.action === "CANCELAR") {
        client.pendingAction = null;
        await client.save();
        return "❌ Acción cancelada.";
      }
      if (confData.action === "INDECISO") {
        return "⚠️ Por favor, responde 'Sí' para confirmar o 'No' para cancelar.";
      }

      // Si confirmó, sacamos la acción de la memoria para ejecutarla abajo
      var classification = client.pendingAction;
      client.pendingAction = null;
      await client.save();
    } else {
      // --- SI NO HAY ACCIÓN PENDIENTE, CLASIFICAMOS EL MENSAJE ---

      // REGLA 3: Prompt modificado para ser CORTOS Y CONCISOS
      const routerPrompt = `
            Eres el asistente de Fint Guard. Sé EXTREMADAMENTE corto y conciso. Cero rodeos.
            Analiza el mensaje y devuelve ÚNICAMENTE JSON:
            1. Crear producto: { "intent": "CREAR_PRODUCTO", "product": { "name": "...", "price": 0, "stock": 0 } }
            2. Nuevo pedido: { "intent": "NUEVO_PEDIDO", "order": { "clientName": "...", "items": [{ "product": "...", "quantity": 1 }] } }
            3. Entrada de stock: { "intent": "ENTRADA_STOCK", "product": { "name": "...", "quantity": 0, "reason": "compra a proveedor" } }
            4. Merma / Pérdida: { "intent": "MERMA_STOCK", "product": { "name": "...", "quantity": 1, "reason": "se pudrió o rompió" } }
            5. Consultar stock: { "intent": "CONSULTAR_STOCK", "product": { "name": "..." } }
            6. Reporte bajo stock: { "intent": "REPORTE_BAJO_STOCK" }
            7. Charla general: { "intent": "CHARLA_GENERAL", "message": "tu respuesta corta y directa" }
            `;

      const jsonString = await processText(messageBody, routerPrompt);
      var classification = JSON.parse(
        jsonString.replace(/```json|```/g, "").trim(),
      );

      // --- FASE DE CONFIRMACIÓN ---
      // Si detectamos que quiere crear algo, lo guardamos en 'pendingAction' y detenemos la ejecución
      if (
        classification.intent === "CREAR_PRODUCTO" ||
        classification.intent === "NUEVO_PEDIDO" ||
        classification.intent === "ENTRADA_STOCK" ||
        classification.intent === "MERMA_STOCK"
      ) {
        client.pendingAction = classification;
        await client.save();

        if (classification.intent === "CREAR_PRODUCTO") {
          return `⚠️ Confirma:\n¿Guardo el producto *${classification.product.name}* a $${classification.product.price} con ${classification.product.stock || 0} de stock?\n(Sí/No)`;
        } else if (classification.intent === "NUEVO_PEDIDO") {
          const detalles = classification.order.items
            .map((i) => `${i.quantity}x ${i.product}`)
            .join(", ");
          return `⚠️ Confirma:\n¿Registro la venta de: ${detalles}?\n(Sí/No)`;
        } else if (classification.intent === "ENTRADA_STOCK") {
          return `⚠️ Confirma:\n¿Agrego ${classification.product.quantity} unidades de stock al producto *${classification.product.name}* (Motivo: ${classification.product.reason || "Ingreso"})?\n(Sí/No)`;
        } else if (classification.intent === "MERMA_STOCK") {
          return `⚠️ Confirma:\n¿Registro la baja de ${classification.product.quantity} unidades de *${classification.product.name}* por merma/pérdida (Motivo: ${classification.product.reason || "Pérdida"})?\n(Sí/No)`;
        }
      }
    }

    // --- EJECUCIÓN (Solo llega aquí si se acaba de confirmar o si es una charla/consulta) ---
    switch (classification.intent) {
      case "CREAR_PRODUCTO": {
        const { name, price, stock } = classification.product || {};
        const productName = (name || "").toString().trim().toLowerCase();
        const stockDelta = Number(stock) || 0;
        const safePrice = Number(price) || 0;
        const session = await mongoose.startSession();

        if (!productName) {
          return "❌ Debes indicar un nombre de producto válido.";
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

            const productoDB = await Product.findOne({
              tenant: tenantId,
              name: new RegExp(item.product, "i"),
            }).session(session);

            if (!productoDB) {
              noEncontrados.push(item.product);
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
        const { name, quantity, reason } = classification.product;
        const qty = toPositiveNumber(quantity);
        if (!qty) {
          return "❌ La cantidad debe ser mayor a cero.";
        }

        const productoDB = await Product.findOne({
          tenant: tenantId,
          name: new RegExp(name, "i"),
        });

        if (productoDB) {
          let stockAnterior = productoDB.stock;
          productoDB.stock += qty;
          await productoDB.save();

          await StockMovement.create({
            tenant: tenantId,
            product: productoDB._id,
            type: "ENTRADA",
            quantity: qty,
            stockBefore: stockAnterior,
            stockAfter: productoDB.stock,
            reason: reason || "Entrada manual de stock",
          });

          return `✅ Stock actualizado: *${productoDB.name}* tiene ahora ${productoDB.stock} unidades.`;
        } else {
          return `❌ Producto no encontrado: ${name}. Si quieres crearlo, dímelo.`;
        }
      }

      case "MERMA_STOCK": {
        const { name, quantity, reason } = classification.product;
        const qty = toPositiveNumber(quantity);
        if (!qty) {
          return "❌ La cantidad debe ser mayor a cero.";
        }

        const productoDB = await Product.findOne({
          tenant: tenantId,
          name: new RegExp(name, "i"),
        });

        if (productoDB) {
          let stockAnterior = productoDB.stock;
          if (stockAnterior < qty) {
            return `❌ Stock insuficiente para ${productoDB.name}. Disponible: ${stockAnterior}.`;
          }

          productoDB.stock -= qty;
          await productoDB.save();

          await StockMovement.create({
            tenant: tenantId,
            product: productoDB._id,
            type: "MERMA",
            quantity: qty,
            stockBefore: stockAnterior,
            stockAfter: productoDB.stock,
            reason: reason || "Reporte de merma/pérdida",
          });

          return `✅ Baja registrada: *${productoDB.name}* bajó a ${productoDB.stock} unidades.`;
        } else {
          return `❌ Producto no encontrado: ${name}.`;
        }
      }

      case "CONSULTAR_STOCK": {
        const { name } = classification.product;
        if (!name) return "Por favor, especifica el nombre del producto.";

        const productoDB = await Product.findOne({
          tenant: tenantId,
          name: new RegExp(name, "i"),
        });

        if (productoDB) {
          return `📦 *${productoDB.name}*\nStock actual: ${productoDB.stock} ${productoDB.unitOfMeasure || "unidades"}\nStock mínimo: ${productoDB.minStock}`;
        } else {
          return `❌ No encontré ningún producto llamado "${name}".`;
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

      case "CHARLA_GENERAL":
      default:
        return classification.message;
    }
  } catch (error) {
    console.error("Error IA:", error);
    return "❌ Error procesando solicitud.";
  }
};

module.exports = { handleIncomingMessage };
