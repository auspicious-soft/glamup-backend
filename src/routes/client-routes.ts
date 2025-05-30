import express from "express";
import { 
  getBusinessServices, 
  getBusinessCategoriesWithServices, 
  getBusinessCategoryServices
} from "../controllers/client/clientController";
import { 
  createClientAppointment, 
  getClientAppointments, 
  getClientAppointmentById, 
  cancelClientAppointment, 
  rescheduleClientAppointment 
} from "../controllers/client/clientAppointmentController";
import {
  getClientProfile,
  updateClientProfile,
  deactivateClientAccount,
} from "../controllers/client/clientProfileController";
import { getBusinessesByGlobalCategory } from "controllers/globalCategory/globalCategoryController";
import { clientAuthMiddleware } from "../middleware/clientAuthMiddleware";

const router = express.Router();

// Public routes for client access (no auth required)
router.get("/business/:businessId/services", getBusinessServices);
router.get("/business/:businessId/categories-with-services", getBusinessCategoriesWithServices);
router.get("/category-services", getBusinessCategoryServices);
router.get("/:categoryId/businesses", getBusinessesByGlobalCategory);

// Client appointment routes (auth required)
router.post("/appointment", createClientAppointment);
router.get("/client/:clientId/appointments", getClientAppointments);
router.get("/appointment/:appointmentId", getClientAppointmentById);
router.post("/appointment/:appointmentId/cancel", cancelClientAppointment);
router.post("/appointment/:appointmentId/reschedule", rescheduleClientAppointment);

// Client profile routes (auth required)
router.get("/profile", getClientProfile);
router.put("/profile", updateClientProfile);
router.post("/profile/deactivate", deactivateClientAccount);

export default router;






