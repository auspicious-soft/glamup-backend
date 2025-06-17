import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import { successResponse, generateJwtToken } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import mongoose from "mongoose";
import RegisteredClient from "../../models/registeredClient/registeredClientSchema";
import User from "../../models/user/userSchema";
import { validateEmail } from "../../utils/user/usercontrollerUtils";
import ClientAppointment from "../../models/clientAppointment/clientAppointmentSchema";
import { getS3FullUrl, uploadStreamToS3ofregisteredClients } from "config/s3";
import { Readable } from "stream";
import Busboy from "busboy";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { createS3Client } from "../../config/s3";

const uploadProfilePictureToS3 = async (req: Request, userEmail: string): Promise<string | null> => {
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

        uploadPromise = uploadStreamToS3ofregisteredClients(
          readableStream,
          filename,
          mimeType,
          userEmail
        );
      }
    );

    busboy.on("field", (fieldname, val) => {
      if (!req.body) req.body = {};
      req.body[fieldname] = val;
    });

    busboy.on("finish", async () => {
      try {
        if (uploadPromise) {
          const imageKey = await uploadPromise;
          const fullUrl = getS3FullUrl(imageKey);
          resolve(fullUrl);
        } else {
          resolve(null);
        }
      } catch (error) {
        reject(error);
      }
    });

    req.pipe(busboy);
  });
};

// Get client profile
export const getClientProfile = async (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return errorResponseHandler(
        "User information is missing from request",
        httpStatusCode.UNAUTHORIZED,
        res
      );
    }
    const userId = typeof req.user === "object" && req.user !== null && "_id" in req.user
      ? (req.user as any)._id
      : req.user;
    
    const user = await User.findById(userId).select(
      "email phoneNumber countryCode countryCallingCode isVerified verificationMethod isActive"
    );
    
    if (!user) {
      return errorResponseHandler(
        "User not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    const clientProfile = await RegisteredClient.findOne({ 
      email: user.email,
      isDeleted: false
    });
    
    if (!clientProfile) {
      return errorResponseHandler(
        "Client profile not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    const appointmentStats = await ClientAppointment.aggregate([
      { $match: { clientId: clientProfile._id, isDeleted: false } },
      { $group: {
          _id: "$status",
          count: { $sum: 1 }
        }
      }
    ]);
    
    const stats = {
      total: 0,
      upcoming: 0,
      completed: 0,
      cancelled: 0,
      pending: 0
    };
    
    appointmentStats.forEach(stat => {
      if (stat._id === "completed") stats.completed = stat.count;
      else if (stat._id === "cancelled") stats.cancelled = stat.count;
      else if (stat._id === "pending") stats.pending = stat.count;
      
      stats.total += stat.count;
    });
    
    const upcomingCount = await ClientAppointment.countDocuments({
      clientId: clientProfile._id,
      status: "pending",
      date: { $gte: new Date() },
      isDeleted: false
    });
    
    stats.upcoming = upcomingCount;
    
    const profileData = {
      clientId: clientProfile._id,
      fullName: clientProfile.fullName,
      email: clientProfile.email,
      phoneNumber: clientProfile.phoneNumber || user.phoneNumber || "",
      countryCode: clientProfile.countryCode || user.countryCode || "",
      countryCallingCode: user.countryCallingCode || "",
      profilePicture: clientProfile.profilePic || "",
      isVerified: user.isVerified || false,
      verificationMethod: user.verificationMethod || "",
      isActive: user.isActive || false,
      appointmentStats: stats
    };
    
    return successResponse(res, "Client profile fetched successfully", {
      profile: profileData
    });
  } catch (error: any) {
    console.error("Error fetching client profile:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message
    });
  }
};

// Update client profile
export const updateClientProfile = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    if (!req.user) {
      return errorResponseHandler(
        "User information is missing from request",
        httpStatusCode.UNAUTHORIZED,
        res
      );
    }
    const userId = typeof req.user === "object" && req.user !== null && "_id" in req.user
      ? (req.user as any)._id
      : req.user;
    
    const user = await User.findById(userId).session(session);
    
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "User not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    const client = await RegisteredClient.findOne({ 
      email: user.email,
      isDeleted: false
    }).session(session);
    
    if (!client) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Client profile not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Handle profile picture upload if it's a multipart request
    let profilePicUrl = client.profilePic;
    let profilePicUpdated = false;
    const isDummyImage = profilePicUrl.includes("dummyClientPicture.png");
    
    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      try {
        // Upload new profile picture
        const uploadResult = await uploadProfilePictureToS3(req, client.email);
        
        if (uploadResult) {
          // If client already has a custom profile picture (not the default one),
          // we should delete the old one from S3
          if (!isDummyImage) {
            try {
              const s3Client = createS3Client();
              // Extract the key from the full URL
              const oldKey = profilePicUrl.split('amazonaws.com/')[1];
              
              if (oldKey && oldKey.startsWith('Registered-Clients/')) {
                const deleteParams = {
                  Bucket: process.env.AWS_BUCKET_NAME as string,
                  Key: oldKey
                };
                
                await s3Client.send(new DeleteObjectCommand(deleteParams));
                console.log("Successfully deleted old client profile picture:", oldKey);
              }
            } catch (deleteError) {
              console.error("Error deleting old profile picture:", deleteError);
              // Continue with the update even if deletion fails
            }
          }
          
          profilePicUrl = uploadResult;
          profilePicUpdated = true;
          console.log("New client profile picture URL:", profilePicUrl);
        }
      } catch (uploadError) {
        console.error("Error uploading profile picture:", uploadError);
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Error uploading profile picture",
          httpStatusCode.INTERNAL_SERVER_ERROR,
          res
        );
      }
    }
    
    const { 
      fullName, 
      email, 
      phoneNumber, 
      countryCode, 
      countryCallingCode
    } = req.body;
    
    const clientUpdateData: any = {};
    const userUpdateData: any = {};
    
    if (fullName !== undefined) {
      clientUpdateData.fullName = fullName;
      userUpdateData.fullName = fullName;
    }
    
    if (email !== undefined && email !== client.email) {
      if (!(await validateEmail(email, res, session))) return;
      
      const existingClient = await RegisteredClient.findOne({ 
        email, 
        _id: { $ne: client._id } 
      }).session(session);
      
      if (existingClient) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Email is already in use by another client",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
      clientUpdateData.email = email;
      userUpdateData.email = email;
    }
    
    if (phoneNumber !== undefined) {
      clientUpdateData.phoneNumber = phoneNumber;
      userUpdateData.phoneNumber = phoneNumber;
    }
    
    if (countryCode !== undefined) {
      clientUpdateData.countryCode = countryCode;
      userUpdateData.countryCode = countryCode;
    }
    
    if (countryCallingCode !== undefined) {
      userUpdateData.countryCallingCode = countryCallingCode;
    }
    
    // Only update profile picture if the upload was successful
    if (profilePicUpdated) {
      clientUpdateData.profilePic = profilePicUrl;
      userUpdateData.profilePic = profilePicUrl;
    }
    
    if (Object.keys(clientUpdateData).length === 0 && Object.keys(userUpdateData).length === 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "No fields to update",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const updatedClient = await RegisteredClient.findByIdAndUpdate(
      client._id,
      { $set: clientUpdateData },
      { new: true, session }
    );
    
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: userUpdateData },
      { new: true, session }
    ).select("fullName email phoneNumber countryCode countryCallingCode profilePic isVerified verificationMethod isActive");
    
    await session.commitTransaction();
    session.endSession();
    
    const profileData = {
      clientId: updatedClient?._id,
      fullName: updatedClient?.fullName,
      email: updatedClient?.email,
      phoneNumber: updatedClient?.phoneNumber || updatedUser?.phoneNumber || "",
      countryCode: updatedClient?.countryCode || updatedUser?.countryCode || "",
      countryCallingCode: updatedUser?.countryCallingCode || "",
      profilePicture: updatedClient?.profilePic || updatedUser?.profilePic || "",
      isVerified: updatedUser?.isVerified || false,
      verificationMethod: updatedUser?.verificationMethod || "",
      isActive: updatedUser?.isActive || false
    };
    
    return successResponse(res, "Client profile updated successfully", {
      profile: profileData
    });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    console.error("Error updating client profile:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message
    });
  }
};

// Deactivate client account
export const deactivateClientAccount = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    if (!req.user) {
      return errorResponseHandler(
        "User information is missing from request",
        httpStatusCode.UNAUTHORIZED,
        res
      );
    }
    const userId = typeof req.user === "object" && req.user !== null && "_id" in req.user
      ? (req.user as any)._id
      : req.user;
    
    
    const user = await User.findById(userId).session(session);
    
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "User not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    const client = await RegisteredClient.findOne({ 
      email: user.email,
      isDeleted: false
    }).session(session);
    
    if (!client) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Client profile not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    await RegisteredClient.findByIdAndUpdate(
      client._id,
      { 
        isActive: false,
        deactivatedAt: new Date()
      },
      { session }
    );
    
    await User.findByIdAndUpdate(
      userId,
      { 
        isActive: false,
        deactivatedAt: new Date()
      },
      { session }
    );
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(res, "Client account deactivated successfully");
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    console.error("Error deactivating client account:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message
    });
  }
};

// Reactivate client account (can be used without being logged in)
export const reactivateClientAccount = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    const { email, phoneNumber } = req.body;
    
    if (!email && !phoneNumber) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Email or phone number is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const query: any = {};
    if (email) query.email = email;
    if (phoneNumber) query.phoneNumber = phoneNumber;
    
    const user = await User.findOne({
      ...query,
      businessRole: "client",
      isActive: false,
      isDeleted: false
    }).session(session);
    
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "No deactivated client account found with the provided details",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    const client = await RegisteredClient.findOne({ 
      email: user.email,
      isDeleted: false
    }).session(session);
    
    if (!client) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Client profile not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    await RegisteredClient.findByIdAndUpdate(
      client._id,
      { 
        isActive: true,
        $unset: { deactivatedAt: "" }
      },
      { session }
    );
    
    await User.findByIdAndUpdate(
      user._id,
      { 
        isActive: true,
        $unset: { deactivatedAt: "" }
      },
      { session }
    );
    
    const token = generateJwtToken(user._id.toString());
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res, 
      "Client account reactivated successfully", 
      { token }
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    console.error("Error reactivating client account:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message
    });
  }
};




