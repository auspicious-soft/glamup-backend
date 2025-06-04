
import { cancelAppointment, createAppointment, getAppointmentById, getAppointmentsByDate, getPendingAppointments, getTeamMemberAppointments, updateAppointment } from 'controllers/users/userAppointmentController';
import { createBusinessProfile, getAllBusinessProfiles, getBusinessProfileById, updateBusinessProfile } from 'controllers/users/userBusinessController';
import { createCategory, deleteCategories, getAllCategories, getBusinessCategories, getCategoryById, updateCategory } from 'controllers/users/userCategoryController';
import { createClient, deleteClients, getAllClients, getClientById, updateClientById } from 'controllers/users/userClientController';
import { createPackage, getAllPackages, getPackageById, updatePackage, deletePackage, deletePackages } from 'controllers/users/userPackageController';
import { deactivateUserAccount, getUserProfile, updateUserPassword, updateUserProfile } from 'controllers/users/userProfileController';
import { addServiceToGlobalCategory, createService, deleteService,  getAllServices, getCategoriesWithServices, getServiceById, updateService } from 'controllers/users/userServicesController';
import { createTeamMember,  deleteTeamMembers,  getAllTeamMembers, getTeamMemberById, updateTeamMember } from 'controllers/users/userTeamMemberController';

import { Router } from 'express';

const router = Router();

// User Profile Routes
router.get('/profile', getUserProfile);
router.put('/profile', updateUserProfile);
router.put('/update-password', updateUserPassword);
router.post('/profile/deactivate', deactivateUserAccount);

// Business Profile Routes
router.post('/business-profile', createBusinessProfile);
router.get('/business-profiles', getAllBusinessProfiles);
router.get('/business-profile/:profileId', getBusinessProfileById);
router.put('/business-profile/:profileId', updateBusinessProfile);
// Public Business Routes
router.get('/business/:businessId/categories', getBusinessCategories);

// Team Member Routes
router.post('/team-member', createTeamMember);
router.get('/team-members', getAllTeamMembers);
router.route('/team-member/:memberId')
  .get(getTeamMemberById)
  .put(updateTeamMember);
router.route('/team-members/delete').delete(deleteTeamMembers);

// Client Routes
router.post('/client', createClient);
router.get('/clients', getAllClients);
router.route('/client/:clientId')
  .get(getClientById)
  .put(updateClientById);
router.route("/clients/delete").delete(deleteClients);

// Category Routes
router.post('/category', createCategory);
router.get('/categories', getAllCategories);
router.route('/category/:categoryId')
  .get(getCategoryById)
  .put(updateCategory)

  router.delete('/categories', deleteCategories);

// Service Routes
router.post('/service', createService);
router.get('/services', getAllServices);
router.route('/service/:serviceId')
.get(getServiceById)
.put(updateService)
.delete(deleteService);
router.get('/categories-with-services', getCategoriesWithServices);

// Package Routes
router.post('/package', createPackage);
router.get('/packages', getAllPackages);
router.get('/package/:packageId', getPackageById);
router.put('/package/:packageId', updatePackage);
router.delete('/package/:packageId', deletePackage);
router.delete('/packages', deletePackages);


// Appointment Routes
router.post('/appointment', createAppointment);
router.get('/appointments/by-date', getAppointmentsByDate);
router.get('/appointments/pending', getPendingAppointments); // New endpoint for pending appointments
router.get('/team-member/appointments/:teamMemberId', getTeamMemberAppointments);
router.route('/appointment/:appointmentId').put(updateAppointment).get(getAppointmentById);
router.post('/appointment/:appointmentId/cancel', cancelAppointment); 

// Add service to global category (for business-specific use)
router.post('/global-category/:categoryId/service', addServiceToGlobalCategory);

export default router;





