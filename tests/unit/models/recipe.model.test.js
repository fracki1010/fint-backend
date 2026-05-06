const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const Recipe = require("../../../src/models/recipe.model");
const { Product } = require("../../../src/models/product.model");
const { Supply } = require("../../../src/models/supply.model");

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoServer.getUri());
});

afterEach(async () => {
  const collections = await mongoose.connection.db.collections();
  for (const col of collections) {
    await col.drop().catch(() => {});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe("Recipe ingredient schema", () => {
  let tenantId;

  beforeEach(() => {
    tenantId = new mongoose.Types.ObjectId();
  });

  it("allows ingredient with product ref instead of supply", async () => {
    const product = await Product.create({
      tenant: tenantId,
      name: "Harina 000",
      type: "raw_material",
      price: 0,
      stock: 100,
      costPrice: 50,
    });

    const recipe = await Recipe.create({
      tenant: tenantId,
      name: "Masa Básica",
      ingredients: [{ product: product._id, quantity: 2 }],
      isActive: true,
    });

    expect(recipe).toBeTruthy();
    expect(recipe.ingredients).toHaveLength(1);
    expect(recipe.ingredients[0].product.toString()).toBe(product._id.toString());
    expect(recipe.ingredients[0].supply).toBeNull();
  });

  it("still accepts legacy supply ref", async () => {
    const supply = await Supply.create({
      tenant: tenantId,
      name: "Harina 000",
      unit: "kg",
      currentStock: 100,
      isActive: true,
    });

    const recipe = await Recipe.create({
      tenant: tenantId,
      name: "Masa Legacy",
      ingredients: [{ supply: supply._id, quantity: 2 }],
      isActive: true,
    });

    expect(recipe).toBeTruthy();
    expect(recipe.ingredients).toHaveLength(1);
    expect(recipe.ingredients[0].supply.toString()).toBe(supply._id.toString());
    expect(recipe.ingredients[0].product).toBeNull();
  });

  it("allows ingredient with both supply and product (transition state)", async () => {
    const supply = await Supply.create({
      tenant: tenantId,
      name: "Agua",
      unit: "litro",
      currentStock: 50,
      isActive: true,
    });

    const product = await Product.create({
      tenant: tenantId,
      name: "Agua Purificada",
      type: "raw_material",
      price: 0,
      stock: 50,
    });

    const recipe = await Recipe.create({
      tenant: tenantId,
      name: "Masa Dual",
      ingredients: [
        { supply: supply._id, product: product._id, quantity: 1 },
      ],
      isActive: true,
    });

    expect(recipe.ingredients[0].supply.toString()).toBe(supply._id.toString());
    expect(recipe.ingredients[0].product.toString()).toBe(product._id.toString());
  });

  it("allows ingredient with neither supply nor product (migration transition state)", async () => {
    // During migration, ingredients may temporarily have only quantity
    const recipe = await Recipe.create({
      tenant: tenantId,
      name: "Transition Recipe",
      ingredients: [{ quantity: 5 }],
      isActive: true,
    });

    expect(recipe.ingredients).toHaveLength(1);
    expect(recipe.ingredients[0].supply).toBeNull();
    expect(recipe.ingredients[0].product).toBeNull();
  });
});
