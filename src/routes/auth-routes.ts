import { Router } from 'express';
import { 
  UserLogin, 
  userSignUp, 
  verifySignupOTP, 
  ResetPassword, 
  verifyResetPasswordOTP, 
  updatePassword 
} from '../controllers/auth/userAuthController';

const router = Router();

// Signup and verification
router.post('/user/signup', userSignUp);
router.post('/user/verify-otp', verifySignupOTP);

// Login
router.post('/user/login', UserLogin);

// Password reset flow
router.post('/user/reset-password', ResetPassword);
router.post('/user/verify-reset-otp', verifyResetPasswordOTP);
router.post('/user/update-password', updatePassword);

export default router;
