const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");

const {
  applyStockForOrder,
  revertStockForOrder,
} = require("../../../src/controllers/orderController");
const { Product } = require("../../../src/models/product.model");
const StockMovement = require("../../../src/models/stockMovement.model");

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongoServer.getUri());
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const collection of Object.values(collections)) {
    await collection.deleteMany({});
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

const mockRes = () => {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  res.locals = { requestId: "test-req-id" };
  return res;
};

describe("applyStockForOrder - presentation math", () => {
  it("deducts quantity * equivalentQty from base stock (100kg, eq=20, sell 3 -> 40)", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const product = await new Product({
      tenant: tenantId,
      name: "Alimento",
      price: 10,
      stock: 100,
      presentations: [
        {
          name: "Bolsa 20kg",
          unitOfMeasure: "kg",
          price: 100,
          equivalentQty: 20,
        },
      ],
    }).save();
    const presentationId = product.presentations[0]._id;

    const session = await mongoose.startSession();
    const order = {
      _id: new mongoose.Types.ObjectId(),
      items: [
        {
          productId: product._id,
          product: "Alimento",
          quantity: 3,
          presentationId,
        },
      ],
    };

    await applyStockForOrder(order, session, "Entrega", "Dashboard", tenantId);

    const updated = await Product.findById(product._id).session(session).lean();
    expect(updated.stock).toBe(40);

    const movements = await StockMovement.find({ order: order._id })
      .session(session)
      .lean();
    expect(movements).toHaveLength(1);
    expect(movements[0].quantity).toBe(60);
    expect(movements[0].presentationName).toBe("Bolsa 20kg");

    await session.endSession();
  });

  it("throws INSUFFICIENT_STOCK when presentation sale exceeds available stock (15kg, eq=20, sell 1)", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const product = await new Product({
      tenant: tenantId,
      name: "Alimento",
      price: 10,
      stock: 15,
      presentations: [
        {
          name: "Bolsa 20kg",
          unitOfMeasure: "kg",
          price: 100,
          equivalentQty: 20,
        },
      ],
    }).save();
    const presentationId = product.presentations[0]._id;

    const session = await mongoose.startSession();
    const order = {
      _id: new mongoose.Types.ObjectId(),
      items: [
        {
          productId: product._id,
          product: "Alimento",
          quantity: 1,
          presentationId,
        },
      ],
    };

    await expect(
      applyStockForOrder(order, session, "Entrega", "Dashboard", tenantId),
    ).rejects.toMatchObject({ status: 409, code: "INSUFFICIENT_STOCK" });

    await session.endSession();
  });

  it("deducts stock for the correct presentation when multiple exist", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const product = await new Product({
      tenant: tenantId,
      name: "Alimento",
      price: 10,
      stock: 200,
      presentations: [
        {
          name: "Bolsa 20kg",
          unitOfMeasure: "kg",
          price: 100,
          equivalentQty: 20,
        },
        {
          name: "Bolsa 50kg",
          unitOfMeasure: "kg",
          price: 200,
          equivalentQty: 50,
        },
      ],
    }).save();
    const pres20 = product.presentations[0]._id;

    const session = await mongoose.startSession();
    const order = {
      _id: new mongoose.Types.ObjectId(),
      items: [
        {
          productId: product._id,
          product: "Alimento",
          quantity: 2,
          presentationId: pres20,
        },
      ],
    };

    await applyStockForOrder(order, session, "Entrega", "Dashboard", tenantId);

    const updated = await Product.findById(product._id).session(session).lean();
    expect(updated.stock).toBe(160);

    const movements = await StockMovement.find({ order: order._id })
      .session(session)
      .lean();
    expect(movements).toHaveLength(1);
    expect(movements[0].quantity).toBe(40);
    expect(movements[0].presentationName).toBe("Bolsa 20kg");

    await session.endSession();
  });

  it("behaves identically for products without presentations", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const product = await new Product({
      tenant: tenantId,
      name: "Simple Product",
      price: 10,
      stock: 50,
    }).save();

    const session = await mongoose.startSession();
    const order = {
      _id: new mongoose.Types.ObjectId(),
      items: [
        {
          productId: product._id,
          product: "Simple Product",
          quantity: 5,
        },
      ],
    };

    await applyStockForOrder(order, session, "Entrega", "Dashboard", tenantId);

    const updated = await Product.findById(product._id).session(session).lean();
    expect(updated.stock).toBe(45);

    const movements = await StockMovement.find({ order: order._id })
      .session(session)
      .lean();
    expect(movements).toHaveLength(1);
    expect(movements[0].quantity).toBe(5);
    expect(movements[0].presentationName).toBeUndefined();

    await session.endSession();
  });
});

describe("revertStockForOrder - presentation math", () => {
  it("reverts quantity * equivalentQty back to base stock when cancelling an order with presentationId", async () => {
    const tenantId = new mongoose.Types.ObjectId();
    const product = await new Product({
      tenant: tenantId,
      name: "Alimento",
      price: 10,
      stock: 100,
      presentations: [
        {
          name: "Bolsa 20kg",
          unitOfMeasure: "kg",
          price: 100,
          equivalentQty: 20,
        },
      ],
    }).save();
    const presentationId = product.presentations[0]._id;

    const session = await mongoose.startSession();
    const order = {
      _id: new mongoose.Types.ObjectId(),
      items: [
        {
          productId: product._id,
          product: "Alimento",
          quantity: 3,
          presentationId,
        },
      ],
    };

    await applyStockForOrder(order, session, "Entrega", "Dashboard", tenantId);
    let updated = await Product.findById(product._id).session(session).lean();
    expect(updated.stock).toBe(40);

    await revertStockForOrder(order, session, "Dashboard", tenantId);
    updated = await Product.findById(product._id).session(session).lean();
    expect(updated.stock).toBe(100);

    const movements = await StockMovement.find({
      order: order._id,
      type: "ENTRADA",
    })
      .session(session)
      .lean();
    expect(movements).toHaveLength(1);
    expect(movements[0].quantity).toBe(60);
    expect(movements[0].presentationName).toBe("Bolsa 20kg");

    await session.endSession();
  });
});
