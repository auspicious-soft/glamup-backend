import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import {
  generateOTP,
  generateVerificationToken,
  hashPassword,
  generateJwtToken,
  sendOTP,
  successResponse,
} from "../../utils/userAuth/signUpAuth";
import RegisteredClient from "../../models/registeredClient/registeredClientSchema";
import User from "../../models/user/userSchema";
import mongoose from "mongoose";
export const clientSignUp = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { fullName, email, password, phoneNumber, countryCode, profilePic } =
      req.body;
    // Validate required fields
    const requiredFields = {
      fullName,
      email,
      password,
      phoneNumber,
      countryCode,
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
    // Validate email format
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
    // Check if client already exists in RegisteredClient
    const existingClient = await RegisteredClient.findOne({
      $or: [{ email }, { phoneNumber }],
    }).session(session);
    if (existingClient) {
      await session.abortTransaction();
      session.endSession();
      const message =
        existingClient.email === email
          ? "Client with this email already exists"
          : "Client with this phone number already exists";
      return errorResponseHandler(message, httpStatusCode.BAD_REQUEST, res);
    }
    // Check if user already exists in User table
    const existingUser = await User.findOne({
      $or: [{ email }, { phoneNumber }],
    }).session(session);
    if (existingUser) {
      await session.abortTransaction();
      session.endSession();
      const message =
        existingUser.email === email
          ? "User with this email already exists"
          : "User with this phone number already exists";
      return errorResponseHandler(message, httpStatusCode.BAD_REQUEST, res);
    }
    // Generate OTP and verification token
    const { otp, otpExpiry } = generateOTP();
    const { token: verificationToken, hashedToken: hashedVerificationToken } =
      await generateVerificationToken();
    const hashedPassword = await hashPassword(password);
    // Create new client in RegisteredClient table
    const newClient = await RegisteredClient.create(
      [
        {
          fullName,
          email,
          password: hashedPassword,
          phoneNumber,
          countryCode,
          profilePic: profilePic || "https://example.com/default-client.png",
        },
      ],
      { session }
    );
    // Create entry in User table with businessRole as client
    const newUser = await User.create(
      [
        {
          fullName,
          email,
          password: hashedPassword,
          phoneNumber,
          countryCode,
          profilePic: profilePic || "https://example.com/default-avatar.png",
          businessRole: "client", // Set role as client
          otp: {
            code: otp,
            expiresAt: otpExpiry,
            verificationToken: hashedVerificationToken,
          },
        },
      ],
      { session }
    );
    // Generate JWT token
    const token = generateJwtToken(newClient[0]._id.toString());
    
    // Send OTP
    const preferredMethod = req.body.verificationMethod || "email";
    await sendOTP(email, phoneNumber, countryCode, otp, preferredMethod);
    await session.commitTransaction();
    session.endSession();
    // Remove sensitive data before sending response
    const clientResponse = newClient[0].toObject() as Omit<typeof newClient[0], "password" | "otp"> & { password?: string; otp?: any };
    delete clientResponse.password;
    delete clientResponse.otp;
    return successResponse(
      res,
      `Client registered successfully. OTP sent to your ${preferredMethod}.`,
      { client: clientResponse, verificationToken },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    console.error("Client signup error:", error);
    const parsedError = errorParser(error);
    return res
      .status(parsedError.code)
      .json({ success: false, message: parsedError.message });
  }
};
