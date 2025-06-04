import { z } from 'zod';
import User from '../../models/user/userSchema';
import { httpStatusCode } from '../../lib/constant';
import { Request, Response } from 'express';
import { errorResponseHandler, errorParser } from '../../lib/errors/error-response-handler';
import { 
  findUserByEmailOrPhone, 
  generateOTP, 
  generateVerificationToken, 
  hashPassword, 
  verifyPassword, 
  generateJwtToken, 
  sendOTP,
  sendResetOTP, 
  removeSensitiveData, 
  successResponse 
} from '../../utils/userAuth/signUpAuth';
import { sendPasswordResetEmail } from 'utils/mails/mail';

export const userSignUp = async (req: Request, res: Response) => {
  try {
    const { fullName, email, password, phoneNumber, countryCode, profilePic, countryCallingCode } = req.body;
    const requiredFields = { fullName, email, password, phoneNumber, countryCode, profilePic, countryCallingCode };
    const missingFields = Object.entries(requiredFields)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      return errorResponseHandler(
        ` ${missingFields.join(', ')} is Required`,
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return errorResponseHandler("Invalid email format", httpStatusCode.BAD_REQUEST, res);
    }

    const existingUser = await findUserByEmailOrPhone(email, phoneNumber);
    if (existingUser) {
      const message = existingUser.email === email 
        ? "User with this email already exists" 
        : "User with this phone number already exists";
      return errorResponseHandler(message, httpStatusCode.BAD_REQUEST, res);
    }

    const { otp, otpExpiry } = generateOTP();
    const { token: verificationToken, hashedToken: hashedVerificationToken } = await generateVerificationToken();

    const newUser = await User.create({
      fullName,
      email,
      password: await hashPassword(password),
      phoneNumber,
      countryCode,
      countryCallingCode,
      profilePic,
      otp: {
        code: otp, 
        expiresAt: otpExpiry,
        verificationToken: hashedVerificationToken
      }
    });

    const token = generateJwtToken(newUser._id.toString());
    
    const preferredMethod = req.body.verificationMethod || 'email';
    await sendOTP(email, phoneNumber, countryCode, otp, preferredMethod);

    const userWithoutSensitive = removeSensitiveData(newUser);

    return successResponse(
      res, 
      `User registered successfully. OTP sent to your ${preferredMethod}.`,
      { ...userWithoutSensitive, verificationToken },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    console.error("Signup error:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const UserLogin = async (req: Request, res: Response) => {
  try {
    const { email, password, fcmToken } = req.body;
    if (!email) {
      return errorResponseHandler("Email is required", httpStatusCode.BAD_REQUEST, res);
    }
    
    if (!fcmToken) {
      return errorResponseHandler("FCM token is required", httpStatusCode.BAD_REQUEST, res);
    }
    
    const user = await findUserByEmailOrPhone(email);
    if (!user) {
      return errorResponseHandler("User not found", httpStatusCode.BAD_REQUEST, res);
    }

    if (!user.isVerified) {
      return errorResponseHandler("User is not verified", httpStatusCode.BAD_REQUEST, res);
    }
    
    const isPasswordValid = await verifyPassword(password, user.password);
    if (!isPasswordValid) {
      return errorResponseHandler("Invalid password", httpStatusCode.BAD_REQUEST, res);
    }
    
    // Check if the FCM token already exists in the user's tokens array
    if (user.fcmToken && user.fcmToken.includes(fcmToken)) {
      return errorResponseHandler(
        "User is already logged in on this device",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Add the new FCM token to the user's tokens array
    await User.findByIdAndUpdate(user._id, {
      $push: { fcmToken: fcmToken }
    });
    
    const token = generateJwtToken(user._id.toString());

    const userWithoutSensitive = removeSensitiveData(user);

    return successResponse(
      res,
      "User logged in successfully",
      { ...userWithoutSensitive, token }
    );
  } catch (error: any) {
    console.error("Login error:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const ResetPassword = async (req: Request, res: Response) => {
  try {
    const { email, phoneNumber, countryCode } = req.body;
    if (!email && !phoneNumber) {
      return errorResponseHandler("Email or phone number is required", httpStatusCode.BAD_REQUEST, res);
    }
    
    const user = await findUserByEmailOrPhone(email, phoneNumber);
    if (!user) {
      return errorResponseHandler("User not found", httpStatusCode.BAD_REQUEST, res);
    }
    
    const { otp, otpExpiry } = generateOTP();
    const { token: resetToken, hashedToken: hashedResetToken } = await generateVerificationToken();

    await User.findByIdAndUpdate(user._id, {
      otp: { code: otp, expiresAt: otpExpiry },
      resetPasswordToken: {
        token: hashedResetToken,
        expiresAt: otpExpiry
      }
    });

    //     if (email) {
    //   await sendPasswordResetEmail(email, otp, Array.isArray(user.languages) ? user.languages[0] || "en" : user.languages || "en");
    // }

    const preferredMethod = req.body.verificationMethod || 'email';
    await sendResetOTP(email, phoneNumber, countryCode, otp, preferredMethod);

    console.log(otp, "OTP");
    return successResponse(
      res,
      `OTP sent to your ${preferredMethod}.`,
      { resetToken }
    );
  } catch (error: any) {
    console.error("Reset password error:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const verifySignupOTP = async (req: Request, res: Response) => {
  try {
    const { otp, phoneNumber, email, verificationToken } = req.body;
    
    if (!otp || (!phoneNumber && !email) || !verificationToken) {
      return errorResponseHandler(
        "OTP, verification token, and either phone number or email are required", 
        httpStatusCode.BAD_REQUEST, 
        res
      );
    }

    const user = await findUserByEmailOrPhone(email, phoneNumber);
    if (!user) {
      return errorResponseHandler("User not found", httpStatusCode.BAD_REQUEST, res);
    }

    if (!user.otp || !user.otp.expiresAt || new Date() > user.otp.expiresAt) {
      return errorResponseHandler("OTP has expired", httpStatusCode.BAD_REQUEST, res);
    }

    if (user.otp.code !== otp) {
      return errorResponseHandler("Invalid OTP", httpStatusCode.BAD_REQUEST, res);
    }

    const isTokenValid = await verifyPassword(verificationToken, user.otp.verificationToken);
    if (!isTokenValid) {
      return errorResponseHandler("Invalid verification token", httpStatusCode.BAD_REQUEST, res);
    }

    await User.findByIdAndUpdate(user._id, {
      isVerified: true,
      otp: { 
        code: null, 
        expiresAt: null, 
        verificationToken: null 
      }
    });

    const updatedUser = await User.findById(user._id);
    if (!updatedUser) {
      return errorResponseHandler("User not found after update", httpStatusCode.INTERNAL_SERVER_ERROR, res);
    }
    const token = generateJwtToken(updatedUser._id.toString());

    const userWithoutSensitive = removeSensitiveData(updatedUser);

    return successResponse(
      res,
      "User verified successfully",
      { ...userWithoutSensitive, token }
    );
  } catch (error: any) {
    console.error("OTP verification error:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const verifyResetPasswordOTP = async (req: Request, res: Response) => {
  try {
    const { otp, phoneNumber, email, resetToken } = req.body;
    
    if (!otp || (!phoneNumber && !email) || !resetToken) {
      return errorResponseHandler(
        "OTP, reset token, and either phone number or email are required", 
        httpStatusCode.BAD_REQUEST, 
        res
      );
    }

    const user = await findUserByEmailOrPhone(email, phoneNumber);
    if (!user) {
      return errorResponseHandler("User not found", httpStatusCode.BAD_REQUEST, res);
    }

    if (!user.otp || !user.otp.expiresAt || new Date() > user.otp.expiresAt) {
      return errorResponseHandler("OTP has expired", httpStatusCode.BAD_REQUEST, res);
    }

    if (user.otp.code !== otp) {
      return errorResponseHandler("Invalid OTP", httpStatusCode.BAD_REQUEST, res);
    }

    if (!user.resetPasswordToken || !user.resetPasswordToken.token) {
      return errorResponseHandler("Reset token is invalid or missing", httpStatusCode.BAD_REQUEST, res);
    }
    
    const isTokenValid = await verifyPassword(resetToken, user.resetPasswordToken.token);
    if (!isTokenValid) {
      return errorResponseHandler("Invalid reset token", httpStatusCode.BAD_REQUEST, res);
    }

    const tokenExpiry = new Date();
    tokenExpiry.setMinutes(tokenExpiry.getMinutes() + 5);
    
    await User.findByIdAndUpdate(user._id, {
      otp: { 
        code: null, 
        expiresAt: null,
        verificationToken: null
      },
      resetPasswordToken: {
        token: user.resetPasswordToken.token,
        expiresAt: tokenExpiry
      }
    });

    return successResponse(
      res,
      "OTP verified successfully. You can now reset your password within 5 minutes.",
      { resetToken }
    );
  } catch (error: any) {
    console.error("OTP verification error:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const updatePassword = async (req: Request, res: Response) => {
  try {
    const { phoneNumber, email, resetToken, newPassword } = req.body;
    
    if ((!phoneNumber && !email) || !resetToken || !newPassword) {
      return errorResponseHandler(
        "Reset token, new password, and either phone number or email are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const user = await findUserByEmailOrPhone(email, phoneNumber);
    if (!user) {
      return errorResponseHandler("User not found", httpStatusCode.BAD_REQUEST, res);
    }

    if (!user.resetPasswordToken || !user.resetPasswordToken.expiresAt || 
        new Date() > user.resetPasswordToken.expiresAt) {
      return errorResponseHandler("Reset token has expired", httpStatusCode.BAD_REQUEST, res);
    }

    const isTokenValid = await verifyPassword(resetToken, user.resetPasswordToken.token);
    if (!isTokenValid) {
      return errorResponseHandler("Invalid reset token", httpStatusCode.BAD_REQUEST, res);
    }

    await User.findByIdAndUpdate(user._id, {
      password: await hashPassword(newPassword),
      resetPasswordToken: { 
        token: null, 
        expiresAt: null 
      },
      otp: {
        code: null,
        expiresAt: null,
        verificationToken: null
      }
    });

    return successResponse(res, "Password updated successfully");
  } catch (error: any) {
    console.error("Password update error:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const userLogout = async (req: Request, res: Response) => {
  try {
    const { fcmToken } = req.body;
    
    if (!fcmToken) {
      return errorResponseHandler(
        "FCM token is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Get user from auth middleware
    let userId: string | undefined;
    if (typeof req.user === 'string') {
      userId = req.user;
    } else if (req.user && typeof req.user === 'object' && 'id' in req.user) {
      userId = (req.user as any).id;
    }
    if (!userId) {
      return errorResponseHandler(
        "User authentication failed",
        httpStatusCode.UNAUTHORIZED,
        res
      );
    }

    // Find the user
    const user = await User.findById(userId);
    if (!user) {
      return errorResponseHandler("User not found", httpStatusCode.NOT_FOUND, res);
    }

    // Check if the FCM token exists in the user's tokens array
    if (!user.fcmToken || !user.fcmToken.includes(fcmToken)) {
      return errorResponseHandler(
        "Invalid FCM token for this user",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Remove the FCM token from the array
    await User.findByIdAndUpdate(userId, {
      $pull: { fcmToken: fcmToken }
    });

    return successResponse(
      res,
      "User logged out successfully",
      { success: true }
    );
  } catch (error: any) {
    console.error("Logout error:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

