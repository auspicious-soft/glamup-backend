import { Router } from 'express';
import { 
  UserLogin, 
  userSignUp, 
  verifySignupOTP, 
  ResetPassword, 
  verifyResetPasswordOTP, 
  updatePassword 
} from '../controllers/auth/userAuthController';
import { reactivateUserAccount } from 'controllers/users/userProfileController';

const router = Router();

// ***************** User Auth Router *******************

router.post('/user/signup', userSignUp);
router.post('/user/verify-otp', verifySignupOTP);

router.post('/user/login', UserLogin);

router.post('/user/reset-password', ResetPassword);
router.post('/user/verify-reset-otp', verifyResetPasswordOTP);
router.post('/user/update-password', updatePassword);

router.post('/user/profile/reactivate', reactivateUserAccount);



export default router;
