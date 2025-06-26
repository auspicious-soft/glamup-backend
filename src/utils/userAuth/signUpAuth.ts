import { customAlphabet } from "nanoid";
import { passwordResetTokenModel } from "../../models/password-token-schema";
import twilio from "twilio";
import { configDotenv } from "dotenv";
import User from "../../models/user/userSchema";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import crypto from "crypto";
import { sendEmailVerificationMail, sendPasswordResetEmail } from "../mails/mail";

configDotenv();
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

// Find user by email or phone
export const findUserByEmailOrPhone = async (email?: string, phoneNumber?: string) => {
  if (!email && !phoneNumber) return null;
  
  const query: any = { isDeleted: false, isActive: true };
  if (email && phoneNumber) {
    query.$or = [{ email }, { phoneNumber }];
  } else if (email) {
    query.email = email;
  } else if (phoneNumber) {
    query.phoneNumber = phoneNumber;
  }
  
  return await User.findOne(query);
};

// Generate OTP and expiry
export const generateOTP = (length = 6) => {
  const genOtp = customAlphabet('0123456789', length);
  const otp = genOtp();
  const otpExpiry = new Date();
  otpExpiry.setMinutes(otpExpiry.getMinutes() + 10);
  
  return { otp, otpExpiry };
};

// Generate verification token
export const generateVerificationToken = async () => {
  const token = crypto.randomBytes(32).toString('hex');
  const hashedToken = await bcrypt.hash(token, 10);
  
  return { token, hashedToken };
};

// Hash password
export const hashPassword = async (password: string) => {
  return await bcrypt.hash(password, 10);
};

// Verify password
export const verifyPassword = async (plainPassword: string, hashedPassword: string) => {
  return await bcrypt.compare(plainPassword, hashedPassword);
};

// Generate JWT token
export const generateJwtToken = (userId: string) => {
  return jwt.sign(
    { id: userId },
    process.env.AUTH_SECRET as string,
    { expiresIn: '1d' }
  );
};

// Send OTP via preferred method
export const sendOTP = async (email: string | undefined, phoneNumber: string | undefined, countryCode: string | undefined, otp: string, preferredMethod: string = 'email') => {
  if (preferredMethod === 'email' && email) {
    return await sendEmailVerificationMail(email, otp, 'eng');
  } else if (phoneNumber && countryCode) {
    return await generateOtpWithTwilio(`${countryCode}${phoneNumber}`, otp);
  }
  return null;
};

// Send OTP via preferred method
export const sendResetOTP = async (email: string | undefined, phoneNumber: string | undefined, countryCode: string | undefined, otp: string, preferredMethod: string = 'email') => {
  if (preferredMethod === 'email' && email) {
    return await sendPasswordResetEmail(email, otp, 'en');
  } else if (phoneNumber && countryCode) {
    return await generateOtpWithTwilio(`${countryCode}${phoneNumber}`, otp);
  }
  return null;
};

// Remove sensitive data from user object
export const removeSensitiveData = (user: any) => {
  const userObj = user.toObject ? user.toObject() : user;
  const { 
    password, 
    otp, 
    resetPasswordToken, 
    ...userWithoutSensitive 
  } = userObj;
  
  return userWithoutSensitive;
};

// Success response
export const successResponse = (res: Response, message: string, data: any = null, statusCode = httpStatusCode.OK) => {
  return res.status(statusCode).json({
    success: true,
    message,
    ...(data && { data }),
  });
};

export const generatePasswordResetTokenByPhoneWithTwilio = async (phoneNumber: string, token: string) => {
  try {
    // Use the token passed as parameter instead of generating a new one
    const message = `Your verification code is: ${token}. It is valid for 1 hour.`;

    // In production, use the actual phone number
    // For development, we'll log the token to console
    console.log(`SMS to ${phoneNumber}: ${message}`);

    // Uncomment this in production with proper Twilio credentials
    /*
    const res = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER as string,
      to: phoneNumber,
    });
    console.log('Twilio response: ', res);
    */

    return {
      success: true,
      message: "Verification code sent via SMS",
    };
  } catch (error) {
    console.error("Error sending verification code via Twilio:", error);
    return {
      success: false,
      message: "Failed to send verification code via SMS",
      error,
    };
  }
};

export const generateOtpWithTwilio = async (phoneNumber: string, otp: string) => {
  try {
    // For development, we'll log the OTP to console
    console.log(`WhatsApp to ${phoneNumber}: Your OTP is: ${otp}`);

    // Uncomment this in production with proper Twilio credentials
    /*
    await twilioClient.messages.create({
      body: `Your OTP is: ${otp}`,
      from: `whatsapp:${process.env.FROMPHONENUMBER}`,
      to: `whatsapp:${phoneNumber}`,
    });
    */

    return {
      success: true,
      message: "OTP is sent via Whatsapp",
    };
  } catch (error) {
    console.error("Error sending OTP via Twilio:", error);
    return {
      success: false,
      message: "Failed to send OTP via Whatsapp",
      error,
    };
  }
};
