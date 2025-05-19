import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getAllServices, getAllBusinessProfiles, getBusinessProfileById, updateBusinessProfile, createTeamMember, getAllTeamMembers, getTeamMemberById, updateTeamMember, deleteTeamMember, createClient, getAllClients, getClientById, updateClientById, deleteClientById, createCategory, getAllCategories, getCategoryById } from '../controllers/users/userController';
import { createBusinessProfile } from '../controllers/users/userController';

const router = Router();

// Protected routes - require authentication

// Service Routes
router.get('/services', authMiddleware, getAllServices);

// Business Profile Routes
router.post('/business-profile', authMiddleware, createBusinessProfile);
router.get('/business-profiles', authMiddleware, getAllBusinessProfiles);
router.get('/business-profile/:profileId', authMiddleware, getBusinessProfileById);
router.put('/business-profile/:profileId', authMiddleware, updateBusinessProfile);

// Team Member Routes
router.post('/team-member', authMiddleware, createTeamMember);
router.get('/team-members', authMiddleware, getAllTeamMembers);
router.get('/team-member/:memberId', authMiddleware, getTeamMemberById);
router.put('/team-member/:memberId', authMiddleware, updateTeamMember);
router.delete('/team-member/:memberId', authMiddleware, deleteTeamMember);

// Client Routes
router.post('/client', authMiddleware, createClient);
router.get('/clients', authMiddleware, getAllClients);
router.get('/client/:clientId', authMiddleware, getClientById);
router.put('/client/:clientId', authMiddleware, updateClientById);
router.delete('/client/:clientId', authMiddleware, deleteClientById);

// Category Routes
router.post('/category', authMiddleware, createCategory);
router.get('/categories', authMiddleware, getAllCategories);
router.get('/category/:categoryId', authMiddleware, getCategoryById);

export default router;


