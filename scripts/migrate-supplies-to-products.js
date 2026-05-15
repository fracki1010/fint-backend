/**
 * Migración: Convierte todos los Supplies en Products con type: "raw_material"
 *
 * Uso: node scripts/migrate-supplies-to-products.js
 *
 * Lee la colección raw 'supplies' de MongoDB (sin requerir el modelo eliminado)
 * y crea/actualiza Products equivalentes.
 */
const mongoose = require("mongoose");
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

async function migrate() {
  const uri = process.env.MONGODB_URI || "mongodb://localhost:27017/fint";
  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  console.log("✅ Conectado a MongoDB");

  // Read from raw supplies collection (model was deleted)
  const supplies = await db.collection("supplies").find({}).toArray();
  console.log(`📦 ${supplies.length} supplies encontrados`);

  let created = 0;
  let updated = 0;
  let errors = [];

  for (const s of supplies) {
    try {
      const existing = await db.collection("products").findOne({
        tenant: s.tenant,
        name: s.name,
        isActive: { $ne: false },
      });

      const productData = {
        tenant: s.tenant,
        sku: s.sku || undefined,
        name: s.name,
        description: `Migrado desde Supply (${s._id})`,
        unitOfMeasure: s.unit || "unidad",
        stock: s.currentStock || 0,
        minStock: s.minStock || 0,
        costPrice: s.referenceCost || 0,
        price: 0,
        type: "raw_material",
        isActive: s.isActive !== false,
        deletedAt: s.deletedAt || null,
      };

      if (existing) {
        await db.collection("products").updateOne(
          { _id: existing._id },
          { $set: productData }
        );
        updated++;
      } else {
        productData.createdAt = new Date();
        productData.updatedAt = new Date();
        await db.collection("products").insertOne(productData);
        created++;
      }
    } catch (err) {
      errors.push({ name: s.name, error: err.message });
    }
  }

  // Migrate SupplyMovements to StockMovements
  const movements = await db.collection("supplymovements").find({}).toArray();
  let movMigrated = 0;

  for (const m of movements) {
    try {
      // Find the corresponding product by supply name
      const supply = supplies.find((s) => s._id.toString() === (m.supply?.toString() || ""));
      if (!supply) continue;

      const product = await db.collection("products").findOne({
        tenant: supply.tenant,
        name: supply.name,
      });
      if (!product) continue;

      // Avoid duplicates
      const exists = await db.collection("stockmovements").findOne({
        tenant: product.tenant,
        product: product._id,
        reason: m.reason,
        createdAt: m.createdAt,
      });
      if (exists) continue;

      await db.collection("stockmovements").insertOne({
        tenant: product.tenant,
        product: product._id,
        type: m.type === "IN" ? "ENTRADA" : "SALIDA",
        quantity: m.quantity,
        stockBefore: m.stockBefore,
        stockAfter: m.stockAfter,
        reason: m.reason,
        source: m.sourceType || "Sistema",
        createdBy: m.createdBy,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt || m.createdAt,
      });
      movMigrated++;
    } catch {
      // skip individual errors
    }
  }

  console.log(`\n✅ Resultados:`);
  console.log(`   Products creados: ${created}`);
  console.log(`   Products actualizados: ${updated}`);
  console.log(`   Movements migrados: ${movMigrated}`);
  if (errors.length) {
    console.log(`   Errores: ${errors.length}`);
    errors.forEach((e) => console.log(`     - ${e.name}: ${e.error}`));
  }

  await mongoose.disconnect();
}

migrate().catch(console.error);
