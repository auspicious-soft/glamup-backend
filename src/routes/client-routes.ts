import express from "express";
import { 
  getBusinessServices, 
  getBusinessCategoriesWithServices, 
  getBusinessCategoryServices 
} from "../controllers/client/clientController";
import { getBusinessesByGlobalCategory } from "controllers/globalCategory/globalCategoryController";

const router = express.Router();

// Public routes for client access
router.get("/business/:businessId/services", getBusinessServices);
router.get("/business/:businessId/categories-with-services", getBusinessCategoriesWithServices);
router.get("/category-services", getBusinessCategoryServices);
router.get("/:categoryId/businesses", getBusinessesByGlobalCategory);

export default router;
