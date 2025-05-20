
import { createAppointment } from 'controllers/users/userAppointmentController';
import { createBusinessProfile, getAllBusinessProfiles, getBusinessProfileById, updateBusinessProfile } from 'controllers/users/userBusinessController';
import { createCategory, deleteCategory, getAllCategories, getCategoryById, updateCategory } from 'controllers/users/userCategoryController';
import { createClient, deleteClientById, getAllClients, getClientById, updateClientById } from 'controllers/users/userClientController';
import { createPackage, getAllPackages, getPackageById } from 'controllers/users/userPackageController';
import { createService, deleteService, getAllServices, getCategoriesWithServices, getServiceById, updateService } from 'controllers/users/userServicesController';
import { createTeamMember, deleteTeamMember, getAllTeamMembers, getTeamMemberById, updateTeamMember } from 'controllers/users/userTeamMemberController';

import { Router } from 'express';

const router = Router();


// Business Profile Routes
router.post('/business-profile', createBusinessProfile);
router.get('/business-profiles', getAllBusinessProfiles);
router.get('/business-profile/:profileId', getBusinessProfileById);
router.put('/business-profile/:profileId', updateBusinessProfile);


// Team Member Routes
router.post('/team-member', createTeamMember);
router.get('/team-members', getAllTeamMembers);
router.route('/team-member/:memberId')
  .get(getTeamMemberById)
  .put(updateTeamMember)
  .delete(deleteTeamMember);

// Client Routes
router.post('/client', createClient);
router.get('/clients', getAllClients);
router.route('/client/:clientId')
  .get(getClientById)
  .put(updateClientById)
  .delete(deleteClientById);

// Category Routes
router.post('/category', createCategory);
router.get('/categories', getAllCategories);
router.route('/category/:categoryId')
  .get(getCategoryById)
  .put(updateCategory)
  .delete(deleteCategory);

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


// Appointment Routes
router.post('/appointment', createAppointment);

export default router;


