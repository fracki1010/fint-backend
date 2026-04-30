const express = require("express");

const recipeController = require("../controllers/recipeController");
const validateRequest = require("../middlewares/validateRequest");
const { idParam } = require("../validators/schemas");

const router = express.Router();

router.get("/", recipeController.getRecipes);
router.post("/", recipeController.createRecipe);
router.get("/:id", validateRequest({ params: idParam }), recipeController.getRecipeById);
router.patch("/:id", validateRequest({ params: idParam }), recipeController.updateRecipe);
router.delete("/:id", validateRequest({ params: idParam }), recipeController.deleteRecipe);
router.post("/:id/produce", validateRequest({ params: idParam }), recipeController.produceRecipe);

module.exports = router;
