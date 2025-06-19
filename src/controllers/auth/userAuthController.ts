import { z } from "zod";
import User from "../../models/user/userSchema";
import { httpStatusCode } from "../../lib/constant";
import { Request, Response } from "express";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
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
  successResponse,
} from "../../utils/userAuth/signUpAuth";
import { sendPasswordResetEmail } from "utils/mails/mail";
import { Readable } from "stream";
import Busboy from "busboy";
import { uploadStreamToS3ofUser, getS3FullUrl } from "../../config/s3";
import mongoose from "mongoose";
import RegisteredTeamMember from "../../models/registeredTeamMember/registeredTeamMemberSchema";
import UserBusinessProfile from "../../models/business/userBusinessProfileSchema";

// Helper function to handle file upload to S3
const uploadProfilePictureToS3 = async (
  req: Request
): Promise<{ key: string; fullUrl: string } | null> => {
  return new Promise((resolve, reject) => {
    if (!req.headers["content-type"]?.includes("multipart/form-data")) {
      resolve(null);
      return;
    }

    const busboy = Busboy({ headers: req.headers });
    let uploadPromise: Promise<string> | null = null;

    busboy.on(
      "file",
      async (fieldname: string, fileStream: any, fileInfo: any) => {
        console.log("File received:", {
          fieldname,
          filename: fileInfo.filename,
          mimeType: fileInfo.mimeType,
        }); // Debug log
        if (fieldname !== "profilePic") {
          fileStream.resume();
          return;
        }

        const { filename, mimeType } = fileInfo;

        const readableStream = new Readable();
        readableStream._read = () => {};

        fileStream.on("data", (chunk: any) => {
          readableStream.push(chunk);
        });

        fileStream.on("end", () => {
          readableStream.push(null);
        });

        // Wait for email to be parsed from fields
        if (!req.body?.email || typeof req.body.email !== "string") {
          reject(new Error("Email is required for profile picture upload"));
          return;
        }

        uploadPromise = uploadStreamToS3ofUser(
          readableStream,
          filename,
          mimeType,
          req.body.email
        );
      }
    );

    busboy.on("field", (fieldname, val) => {
      console.log("Field received:", { fieldname, value: val }); // Debug log
      if (!req.body) req.body = {};
      req.body[fieldname] = val;
    });

    busboy.on("finish", async () => {
      try {
        if (uploadPromise) {
          const imageKey = await uploadPromise;
          const fullUrl = getS3FullUrl(imageKey);
          resolve({ key: imageKey, fullUrl });
        } else {
          resolve(null);
        }
      } catch (error) {
        reject(error);
      }
    });

    busboy.on("error", (error) => {
      console.error("Busboy error:", error);
      reject(error);
    });

    req.pipe(busboy);
  });
};

export const userSignUp = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    let profilePicKey = "";
    let profilePicUrl = "";
    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      try {
        const uploadResult = await uploadProfilePictureToS3(req);
        if (uploadResult) {
          profilePicKey = uploadResult.key;
          profilePicUrl = uploadResult.fullUrl;
        }
      } catch (uploadError) {
        console.error("Error uploading profile picture:", uploadError);
      }
    }

    const {
      fullName,
      email,
      password,
      phoneNumber,
      countryCode,
      countryCallingCode,
    } = req.body;
    const requiredFields = {
      fullName,
      email,
      password,
      phoneNumber,
      countryCode,
      countryCallingCode,
    };
    const missingFields = Object.entries(requiredFields)
      .filter(([_, value]) => !value)
      .map(([key]) => key);

    if (missingFields.length > 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        `${missingFields.join(", ")} is Required`,
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Invalid email format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const existingUser = await findUserByEmailOrPhone(email, phoneNumber);
    if (existingUser) {
      await session.abortTransaction();
      session.endSession();
      const message =
        existingUser.email === email
          ? "User with this email already exists"
          : "User with this phone number already exists";
      return errorResponseHandler(message, httpStatusCode.BAD_REQUEST, res);
    }

    const { otp, otpExpiry } = generateOTP();
    const { token: verificationToken, hashedToken: hashedVerificationToken } =
      await generateVerificationToken();

    const newUser = await User.create({
      fullName,
      email,
      password: await hashPassword(password),
      phoneNumber,
      countryCode,
      countryCallingCode,
      profilePic:
        profilePicUrl ||
        "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/dummyUserPic.png",
      profilePicKey: profilePicKey || "",
      otp: {
        code: otp,
        expiresAt: otpExpiry,
        verificationToken: hashedVerificationToken,
      },
    });

    const token = generateJwtToken(newUser._id.toString());

    const preferredMethod = req.body.verificationMethod || "email";
    await sendOTP(email, phoneNumber, countryCode, otp, preferredMethod);

    await session.commitTransaction();
    session.endSession();

    const userWithoutSensitive = removeSensitiveData(newUser);

    return successResponse(
      res,
      `User registered successfully. OTP sent to your ${preferredMethod}.`,
      { ...userWithoutSensitive, verificationToken },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
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
      return errorResponseHandler(
        "Email is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (!fcmToken) {
      return errorResponseHandler(
        "FCM token is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const user = await findUserByEmailOrPhone(email);
    if (!user) {
      return errorResponseHandler(
        "User not found",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (!user.isVerified) {
      return errorResponseHandler(
        "User is not verified",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const isPasswordValid = await verifyPassword(password, user.password);
    if (!isPasswordValid) {
      return errorResponseHandler(
        "Invalid password",
        httpStatusCode.BAD_REQUEST,
        res
      );
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
      $push: { fcmToken: fcmToken },
    });

    const token = generateJwtToken(user._id.toString());

    const userWithoutSensitive = removeSensitiveData(user);

    return successResponse(res, "User logged in successfully", {
      ...userWithoutSensitive,
      token,
    });
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
      return errorResponseHandler(
        "Email or phone number is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const user = await findUserByEmailOrPhone(email, phoneNumber);
    if (!user) {
      return errorResponseHandler(
        "User not found",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const { otp, otpExpiry } = generateOTP();
    const { token: resetToken, hashedToken: hashedResetToken } =
      await generateVerificationToken();

    await User.findByIdAndUpdate(user._id, {
      otp: { code: otp, expiresAt: otpExpiry },
      resetPasswordToken: {
        token: hashedResetToken,
        expiresAt: otpExpiry,
      },
    });

    //     if (email) {
    //   await sendPasswordResetEmail(email, otp, Array.isArray(user.languages) ? user.languages[0] || "en" : user.languages || "en");
    // }

    const preferredMethod = req.body.verificationMethod || "email";
    await sendResetOTP(email, phoneNumber, countryCode, otp, preferredMethod);

    console.log(otp, "OTP");
    return successResponse(res, `OTP sent to your ${preferredMethod}.`, {
      resetToken,
    });
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
      return errorResponseHandler(
        "User not found",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (!user.otp || !user.otp.expiresAt || new Date() > user.otp.expiresAt) {
      return errorResponseHandler(
        "OTP has expired",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (user.otp.code !== otp) {
      return errorResponseHandler(
        "Invalid OTP",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const isTokenValid = await verifyPassword(
      verificationToken,
      user.otp.verificationToken
    );
    if (!isTokenValid) {
      return errorResponseHandler(
        "Invalid verification token",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    await User.findByIdAndUpdate(user._id, {
      isVerified: true,
      otp: {
        code: null,
        expiresAt: null,
        verificationToken: null,
      },
    });

    const updatedUser = await User.findById(user._id);
    if (!updatedUser) {
      return errorResponseHandler(
        "User not found after update",
        httpStatusCode.INTERNAL_SERVER_ERROR,
        res
      );
    }
    const token = generateJwtToken(updatedUser._id.toString());

    const userWithoutSensitive = removeSensitiveData(updatedUser);

    return successResponse(res, "User verified successfully", {
      ...userWithoutSensitive,
      token,
    });
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
      return errorResponseHandler(
        "User not found",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (!user.otp || !user.otp.expiresAt || new Date() > user.otp.expiresAt) {
      return errorResponseHandler(
        "OTP has expired",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (user.otp.code !== otp) {
      return errorResponseHandler(
        "Invalid OTP",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (!user.resetPasswordToken || !user.resetPasswordToken.token) {
      return errorResponseHandler(
        "Reset token is invalid or missing",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const isTokenValid = await verifyPassword(
      resetToken,
      user.resetPasswordToken.token
    );
    if (!isTokenValid) {
      return errorResponseHandler(
        "Invalid reset token",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const tokenExpiry = new Date();
    tokenExpiry.setMinutes(tokenExpiry.getMinutes() + 5);

    await User.findByIdAndUpdate(user._id, {
      otp: {
        code: null,
        expiresAt: null,
        verificationToken: null,
      },
      resetPasswordToken: {
        token: user.resetPasswordToken.token,
        expiresAt: tokenExpiry,
      },
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
      return errorResponseHandler(
        "User not found",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (
      !user.resetPasswordToken ||
      !user.resetPasswordToken.expiresAt ||
      new Date() > user.resetPasswordToken.expiresAt
    ) {
      return errorResponseHandler(
        "Reset token has expired",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const isTokenValid = await verifyPassword(
      resetToken,
      user.resetPasswordToken.token
    );
    if (!isTokenValid) {
      return errorResponseHandler(
        "Invalid reset token",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    await User.findByIdAndUpdate(user._id, {
      password: await hashPassword(newPassword),
      resetPasswordToken: {
        token: null,
        expiresAt: null,
      },
      otp: {
        code: null,
        expiresAt: null,
        verificationToken: null,
      },
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
    if (typeof req.user === "string") {
      userId = req.user;
    } else if (req.user && typeof req.user === "object" && "id" in req.user) {
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
      return errorResponseHandler(
        "User not found",
        httpStatusCode.NOT_FOUND,
        res
      );
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
      $pull: { fcmToken: fcmToken },
    });

    return successResponse(res, "User logged out successfully", {
      success: true,
    });
  } catch (error: any) {
    console.error("Logout error:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const joinExistingBusiness = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { businessId } = req.body;

    // Get userId from the token instead of request body
    let userId: string | undefined;
    if (typeof req.user === "string") {
      userId = req.user;
    } else if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    } else if (req.user && typeof req.user === "object" && "_id" in req.user) {
      userId = (req.user as any)._id.toString();
    }

    if (!userId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "User authentication failed",
        httpStatusCode.UNAUTHORIZED,
        res
      );
    }

    if (!businessId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Business ID is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Validate business ID
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Invalid business ID format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Check if business exists
    const business = await UserBusinessProfile.findOne({
      _id: businessId,
      isDeleted: false,
      status: "active",
    }).session(session);

    if (!business) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Business not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Check if user exists
    const user = await User.findOne({
      _id: userId,
      isDeleted: false,
      isActive: true,
    }).session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "User not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Check if user is already a team member of this business
    const existingTeamMember = await RegisteredTeamMember.findOne({
      userId: userId,
      businessId: businessId,
      isDeleted: false,
    }).session(session);

    if (existingTeamMember) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "User is already a team member of this business",
        httpStatusCode.CONFLICT,
        res
      );
    }

    // Create new registered team member
    const newTeamMember = await RegisteredTeamMember.create(
      [
        {
          fullName: user.fullName,
          email: user.email,
          phoneNumber: user.phoneNumber || "",
          countryCode: user.countryCode || "+91",
          countryCallingCode: user.countryCallingCode || "IN",
          password: user.password,
          profilePic:
            user.profilePic ||
            "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/DummyTeamMemberPic.png",
          businessId: businessId,
          userId: userId,
          isVerified: user.isVerified,
          verificationMethod: user.verificationMethod || "email",
        },
      ],
      { session }
    );

    // Update user's business role to team-member
    await User.findByIdAndUpdate(
      userId,
      { businessRole: "team-member" },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    // Remove sensitive data before sending response
    const { password, ...teamMemberResponse } = newTeamMember[0].toObject();

    return successResponse(
      res,
      "Successfully joined business as team member",
      { teamMember: teamMemberResponse },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    console.error("Join business error:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
  }
};

export const resendVerificationCode = async (req: Request, res: Response) => {
  // Rate limit configuration
  const MAX_ATTEMPTS = 3;
  const TIME_WINDOW_MINUTES = 5;
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { email, phoneNumber, verificationMethod } = req.body;

    // Validate input: either email or phoneNumber is required
    if (!email && !phoneNumber) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Email or phone number is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Find user by email or phone number
    const user = await findUserByEmailOrPhone(email, phoneNumber);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "User not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Check if user is already verified
    if (user.isVerified) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "User is already verified",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Initialize otpResendAttempts if not present
    if (!user.otpResendAttempts) {
      user.otpResendAttempts = new mongoose.Types.DocumentArray([]);
    }

    // Filter attempts within the last 5 minutes
    const now = new Date();
    const timeWindowStart = new Date(
      now.getTime() - TIME_WINDOW_MINUTES * 60 * 1000
    );
    const recentAttempts = user.otpResendAttempts.filter(
      (attempt) => attempt.timestamp > timeWindowStart
    );

    // Check if user has exceeded the maximum attempts
    if (recentAttempts.length >= MAX_ATTEMPTS) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        `Maximum resend attempts reached. Please try again after ${TIME_WINDOW_MINUTES} minutes.`,
        httpStatusCode.TOO_MANY_REQUESTS,
        res
      );
    }

    // Generate new OTP and verification token
    const { otp, otpExpiry } = generateOTP();
    const { token: verificationToken, hashedToken: hashedVerificationToken } =
      await generateVerificationToken();

    // Add new attempt timestamp
    const updatedAttempts = [
      ...recentAttempts.map((a) => ({ timestamp: a.timestamp })),
      { timestamp: now },
    ];

    // Update user with new OTP, verification token, and resend attempts
    await User.findByIdAndUpdate(
      user._id,
      {
        otp: {
          code: otp,
          expiresAt: otpExpiry,
          verificationToken: hashedVerificationToken,
        },
        otpResendAttempts: updatedAttempts,
      },
      { session }
    );

    // Send new OTP via preferred method (default to email if not specified)
    const preferredMethod = verificationMethod || "email";
    await sendOTP(email, phoneNumber, user.countryCode, otp, preferredMethod);

    await session.commitTransaction();
    session.endSession();

    return successResponse(
      res,
      `New OTP sent to your ${preferredMethod}`,
      { verificationToken },
      httpStatusCode.OK
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    console.error("Resend verification code error:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};
