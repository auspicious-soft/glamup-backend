import { Router } from 'express';
import { authMiddleware } from '../middleware/authMiddleware';
import { createService } from '../controllers/admin/adminController';

const router = Router();

// Protected route - Create a new service (admin only)
router.post('/services', authMiddleware, createService);

export default router;