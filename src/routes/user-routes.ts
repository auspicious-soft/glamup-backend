import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { getAllServices, getAllBusinessProfiles } from '../controllers/users/userController';
import { createBusinessProfile } from '../controllers/users/userController';

const router = Router();

// Protected routes - require authentication
router.get('/services', authMiddleware, getAllServices);
router.post('/business-profile', authMiddleware, createBusinessProfile);
router.get('/business-profiles', authMiddleware, getAllBusinessProfiles);

export default router;
