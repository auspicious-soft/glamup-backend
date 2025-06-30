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
import { getS3FullUrl, uploadStreamToS3ofregisteredClients } from "config/s3";
import { Readable } from "stream";
import Busboy from "busboy";


const uploadProfilePictureToS3 = async (req: Request): Promise<{ key: string, fullUrl: string } | null> => {
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
        console.log("File received:", { fieldname, filename: fileInfo.filename, mimeType: fileInfo.mimeType }); // Debug log
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

        uploadPromise = uploadStreamToS3ofregisteredClients(
          readableStream,
          filename,
          mimeType,
          req.body.email
        );
      }
    );

    busboy.on("field", (fieldname, val) => {
      console.log("Field received:", { fieldname, value: val });
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

export const clientSignUp = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    // Handle profile picture upload if it's a multipart request
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

    const { fullName, email, password, phoneNumber, countryCode, countryCallingCode } = req.body;
    
    const requiredFields = {
      fullName,
      email,
      password,
      phoneNumber,
      countryCode,
      countryCallingCode
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
    
        const registrationExpiresAt = new Date(Date.now() + 10 * 60 * 1000);

    // Create new client in RegisteredClient table
    const newClient = await RegisteredClient.create(
      [
        {
          fullName,
          email,
          password: hashedPassword,
          phoneNumber,
          countryCode,
          countryCallingCode,
          profilePic: profilePicUrl || "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/dummyClientPicture.png",
          profilePicKey: profilePicKey || "",
            registrationExpiresAt,
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
          countryCallingCode,
          profilePic: profilePicUrl || "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/dummyClientPicture.png",
          profilePicKey: profilePicKey || "",
          businessRole: "client", // Set role as client
          otp: {
            code: otp,
            expiresAt: otpExpiry,
            verificationToken: hashedVerificationToken,
          },
           registrationExpiresAt,
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
