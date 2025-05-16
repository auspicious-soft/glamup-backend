// import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { z } from 'zod';
import User from '../../models/user/userSchema';
import { httpStatusCode } from '../../lib/constant';
import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { generateOtpWithTwilio } from '../../utils/userAuth/signUpAuth';
import { sendEmailVerificationMail } from '../../utils/mails/mail';
import { customAlphabet } from 'nanoid';
import crypto from 'crypto';

const userSignupSchema = z.object({
  fullName: z.string().min(1, "Full name is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  countryCode: z.string().min(1, "Country code is required"),
  phoneNumber: z.string().min(1, "Phone number is required"),
});

export const userSignUp = async (req: Request, res: Response) => {
  try {
    const result = userSignupSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "Validation failed",
        errors: result.error.errors,
      });
    }
    const UserData = result.data;
    const { fullName, email, password, phoneNumber, countryCode } = result.data;

    const existingUser = await User.findOne({ $or: [{ email }, { phoneNumber }] });
    if (existingUser) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: existingUser.email === email 
          ? "User with this email already exists" 
          : "User with this phone number already exists",
      });
    }

    // Generate OTP
    const genOtp = customAlphabet('0123456789', 6);
    const otp = genOtp();
    const otpExpiry = new Date();
    otpExpiry.setMinutes(otpExpiry.getMinutes() + 10);
    
    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const hashedVerificationToken = await bcrypt.hash(verificationToken, 10);

    const newUser = await User.create({
      ...UserData,
      password: await bcrypt.hash(password, 10),
      otp: {
        code: otp, 
        expiresAt: otpExpiry,
        verificationToken: hashedVerificationToken
      }
    });

    const token = jwt.sign(
      { id: newUser._id },
      process.env.AUTH_SECRET as string,
      { expiresIn: '1d' }
    );
    
    const preferredMethod = req.body.verificationMethod || 'email';
    if (preferredMethod === 'email') {
      await sendEmailVerificationMail(email, otp, 'eng');
    } else {
      await generateOtpWithTwilio(`${countryCode}${phoneNumber}`, otp);
    }

    const { password: _removed, ...userWithoutSensitive } = newUser.toObject();

    return res.status(httpStatusCode.CREATED).json({
      success: true,
      message: `User registered successfully. OTP sent to your ${preferredMethod}.`,
      data: { 
        ...userWithoutSensitive, 
        token,
        verificationToken // Send this to client for OTP verification
      }
    });
  } catch (error: any) {
    console.error("Signup error:", error);
    return res.status(httpStatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      error: error.message || "Unexpected error occurred",
    });
  }
};

export const UserLogin = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "Email is required",
      });
    }
    
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "User not found",
      });
    }
    
    if (!user.isVerified) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "User is not verified",
      });
    }
    
    // Compare password using bcrypt
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "Invalid password",
      });
    }
    
    const token = jwt.sign(
      { id: user._id },
      process.env.AUTH_SECRET as string,
      { expiresIn: '1d' }
    );

  const userObj = user.toObject();
const { 
  password: _removedPassword, 
  otp: _removedOtp, 
  resetPasswordToken: _removedResetToken, 
  ...userWithoutSensitive 
} = userObj;

    return res.status(httpStatusCode.OK).json({
      success: true,
      message: "User logged in successfully",
      data: { ...userWithoutSensitive, token },
    });
  } catch (error: any) {
    console.error("Login error:", error);
    return res.status(httpStatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      error: error.message || "Unexpected error occurred",
    });
  }
};

export const ResetPassword = async (req: Request, res: Response) => {
  try {
    const { email, phoneNumber, countryCode } = req.body;
    if (!email && !phoneNumber) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "Email or phone number is required",
      });
    }
    
    const user = await User.findOne({ $or: [{ email }, { phoneNumber }] });
    if (!user) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "User not found",
      });
    }
    
    // Generate OTP
    const genOtp = customAlphabet('0123456789', 6);
    const otp = genOtp();
    const otpExpiry = new Date();
    otpExpiry.setMinutes(otpExpiry.getMinutes() + 10);
    
    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const hashedResetToken = await bcrypt.hash(resetToken, 10);

    // Update user with OTP and reset token
    await User.findByIdAndUpdate(user._id, {
      otp: { code: otp, expiresAt: otpExpiry },
      resetPasswordToken: {
        token: hashedResetToken,
        expiresAt: otpExpiry
      }
    });

    const preferredMethod = req.body.verificationMethod || 'email';
    if (preferredMethod === 'email') {
      await sendEmailVerificationMail(email, otp, 'eng');
    } else {
      await generateOtpWithTwilio(`${countryCode}${phoneNumber}`, otp);
    }

    console.log(otp,"OTP")
    return res.status(httpStatusCode.OK).json({
      success: true,
      message: `OTP sent to your ${preferredMethod}.`,
      data: { resetToken } // Send this to client for OTP verification
    });
  } catch (error: any) {
    console.error("Reset password error:", error);
    return res.status(httpStatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      error: error.message || "Unexpected error occurred",
    });
  }
};

export const verifySignupOTP = async (req: Request, res: Response) => {
  try {
    const { otp, phoneNumber, verificationToken } = req.body;
    
    if (!otp || !phoneNumber || !verificationToken) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "OTP, phone number, and verification token are required",
      });
    }

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "User not found",
      });
    }

    if (!user.otp || !user.otp.expiresAt || new Date() > user.otp.expiresAt) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "OTP has expired",
      });
    }

    if (user.otp.code !== otp) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    const isTokenValid = await bcrypt.compare(verificationToken, user.otp.verificationToken);
    if (!isTokenValid) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "Invalid verification token",
      });
    }

    await User.findByIdAndUpdate(user._id, {
      isVerified: true,
      otp: { 
        code: null, 
        expiresAt: null, 
        verificationToken: null 
      }
    });

    return res.status(httpStatusCode.OK).json({
      success: true,
      message: "User verified successfully",
    });
  } catch (error: any) {
    console.error("OTP verification error:", error);
    return res.status(httpStatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      error: error.message || "Unexpected error occurred",
    });
  }
};

export const verifyResetPasswordOTP = async (req: Request, res: Response) => {
  try {
    const { otp, phoneNumber, resetToken } = req.body;
    
    if (!otp || !phoneNumber || !resetToken) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "OTP, phone number, and reset token are required",
      });
    }

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "User not found",
      });
    }

    // Check if OTP is expired
    if (!user.otp || !user.otp.expiresAt || new Date() > user.otp.expiresAt) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "OTP has expired",
      });
    }

    // Verify OTP
    if (user.otp.code !== otp) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    // Verify reset token
    if (!user.resetPasswordToken || !user.resetPasswordToken.token) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "Reset token is invalid or missing",
      });
    }
    const isTokenValid = await bcrypt.compare(resetToken, user.resetPasswordToken.token);
    if (!isTokenValid) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "Invalid reset token",
      });
    }

    // Clear OTP but keep reset token valid for password update
    // Set a short expiry for the reset token (e.g., 5 minutes)
    const tokenExpiry = new Date();
    tokenExpiry.setMinutes(tokenExpiry.getMinutes() + 5);
    
    await User.findByIdAndUpdate(user._id, {
      otp: { 
        code: null, 
        expiresAt: null,
        verificationToken: null
      },
      resetPasswordToken: {
        token: user.resetPasswordToken?.token || null,
        expiresAt: tokenExpiry // Update with shorter expiry
      }
    });

    return res.status(httpStatusCode.OK).json({
      success: true,
      message: "OTP verified successfully. You can now reset your password within 5 minutes.",
      data: { resetToken } // Keep sending the token for the next step
    });
  } catch (error: any) {
    console.error("OTP verification error:", error);
    return res.status(httpStatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      error: error.message || "Unexpected error occurred",
    });
  }
};

export const updatePassword = async (req: Request, res: Response) => {
  try {
    const { phoneNumber, newPassword } = req.body;
    
    if (!phoneNumber ||  !newPassword) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "Phone number, reset token, and new password are required",
      });
    }

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "User not found",
      });
    }


    // Update password and completely clear reset token and OTP
    await User.findByIdAndUpdate(user._id, {
      password: await bcrypt.hash(newPassword, 10),
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

    return res.status(httpStatusCode.OK).json({
      success: true,
      message: "Password updated successfully",
    });
  } catch (error: any) {
    console.error("Password update error:", error);
    return res.status(httpStatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Internal server error",
      error: error.message || "Unexpected error occurred",
    });
  }
};


