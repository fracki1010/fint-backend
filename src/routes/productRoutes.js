const express = require("express");
const router = express.Router();
const productController = require("../controllers/productController");
const validateRequest = require("../middlewares/validateRequest");
const {
  idParam,
  createProductBody,
  updateProductBody,
  includeInactiveQuery,
} = require("../validators/schemas");

router.get("/", validateRequest({ query: includeInactiveQuery }), productController.getProducts);
router.get(
  "/lookup/:code",
  productController.lookupProductByCode,
);
router.get(
  "/:id",
  validateRequest({ params: idParam, query: includeInactiveQuery }),
  productController.getProductById,
);
router.post("/", validateRequest({ body: createProductBody }), productController.createProduct);
router.put(
  "/:id",
  validateRequest({ params: idParam, body: updateProductBody }),
  productController.updateProduct,
);
router.delete("/:id", validateRequest({ params: idParam }), productController.deleteProduct);
router.post("/import", productController.importProducts);

module.exports = router;
