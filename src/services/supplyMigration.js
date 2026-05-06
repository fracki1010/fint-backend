/**
 * Core migration logic: Supply → Product (type: raw_material).
 *
 * Pure-ish function — accepts model references for testability.
 * Returns { created, skipped, errors } — never throws.
 */
async function migrateSupplyToProduct({ dryRun = false, models = {} } = {}) {
  const SupplyModel = models.Supply || require("../models/supply.model").Supply;
  const ProductModel = models.Product || require("../models/product.model").Product;

  const supplies = await SupplyModel.find({ isActive: true, deletedAt: null }).lean();
  const results = { created: [], skipped: [], errors: [] };

  for (const supply of supplies) {
    try {
      // Skip if a Product with same tenant + name already exists
      const existing = await ProductModel.findOne({
        tenant: supply.tenant,
        name: supply.name,
      }).lean();

      if (existing) {
        results.skipped.push({
          supplyId: supply._id.toString(),
          name: supply.name,
          reason: `Product already exists (${existing._id})`,
        });
        continue;
      }

      const productData = {
        tenant: supply.tenant,
        name: supply.name,
        sku: supply.sku || undefined,
        barcode: supply.barcode || undefined,
        type: "raw_material",
        price: 0,
        costPrice: supply.referenceCost ?? 0,
        stock: supply.currentStock ?? 0,
        minStock: supply.minStock ?? 0,
        unitOfMeasure: supply.unit || "unidad",
        isActive: true,
      };

      if (!dryRun) {
        const product = await ProductModel.create(productData);
        results.created.push({
          supplyId: supply._id.toString(),
          productId: product._id.toString(),
          name: supply.name,
        });
      } else {
        results.created.push({
          supplyId: supply._id.toString(),
          productId: "(dry-run)",
          name: supply.name,
        });
      }
    } catch (err) {
      results.errors.push({
        supplyId: supply._id.toString(),
        name: supply.name,
        error: err.message,
      });
    }
  }

  return results;
}

module.exports = { migrateSupplyToProduct };
