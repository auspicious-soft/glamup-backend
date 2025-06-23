import express from "express";
import { 
  getBusinessServices, 
  getBusinessCategoriesWithServices, 
  getBusinessCategoryServices,
  getBusinessesWithAppointments,
  getRecommendedBusinesses,
  getBusinessesWithinRadius
} from "../controllers/client/clientController";
import { 
  createClientAppointment, 
  getClientAppointments, 
  getClientAppointmentById, 
  cancelClientAppointment, 
  rescheduleClientAppointment, 
  getClientUpcomingAppointments
} from "../controllers/client/clientAppointmentController";
import {
  getClientProfile,
  updateClientProfile,
  deactivateClientAccount,
} from "../controllers/client/clientProfileController";
import { getBusinessesByGlobalCategory } from "controllers/globalCategory/globalCategoryController";
 

const router = express.Router();

// Public routes for client access (no auth required)
router.get("/business/:businessId/services", getBusinessServices);
router.get("/business/:businessId/categories-with-services", getBusinessCategoriesWithServices);
router.get("/category-services", getBusinessCategoryServices);
router.get("/:categoryId/businesses", getBusinessesByGlobalCategory);

// Client appointment routes (auth required)
router.post("/appointment", createClientAppointment);
router.get("/:clientId/appointments", getClientAppointments);
router.get("/appointment/:appointmentId", getClientAppointmentById);
router.post("/appointment/:appointmentId/cancel", cancelClientAppointment);
router.post("/appointment/:appointmentId/reschedule", rescheduleClientAppointment);
router.get("/upcoming-appointments/:clientId", getClientUpcomingAppointments)
router.get("/businesses-with-appointments", getBusinessesWithAppointments )
router.get("/recommended-businesses/:clientId",getRecommendedBusinesses)
router.get("/businesses-within-radius", getBusinessesWithinRadius)
// Client profile routes (auth required)
router.get("/profile", getClientProfile);
router.put("/profile", updateClientProfile);
router.post("/profile/deactivate", deactivateClientAccount);

export default router;






