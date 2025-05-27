import { getAllGlobalCategories , getGlobalCategoryById, createGlobalCategory, updateGlobalCategory, deleteGlobalCategory } from "controllers/globalCategory/globalCategoryController";
import express from "express";

const router = express.Router();

// Public routes (no authentication required)
router.get("/", getAllGlobalCategories);
router.get("/:id", getGlobalCategoryById);

// Admin-only routes
router.post("/", createGlobalCategory);
router.put("/:id", updateGlobalCategory);
router.delete("/:id", deleteGlobalCategory);

export default router;