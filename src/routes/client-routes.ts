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
import { getBusinessesByGlobalCategory } from "controllers/globalCategory/globalCategoryController";

const router = express.Router();

// Public routes for client access
router.get("/business/:businessId/services", getBusinessServices);
router.get("/business/:businessId/categories-with-services", getBusinessCategoriesWithServices);
router.get("/category-services", getBusinessCategoryServices);
router.get("/:categoryId/businesses", getBusinessesByGlobalCategory);

// Client appointment routes
router.post("/appointment", createClientAppointment);
router.get("/client/:clientId/appointments", getClientAppointments);
router.get("/appointment/:appointmentId", getClientAppointmentById);
router.post("/appointment/:appointmentId/cancel", cancelClientAppointment);
router.post("/appointment/:appointmentId/reschedule", rescheduleClientAppointment);

export default router;




