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
    
    const { 
      fullName, 
      email, 
      phoneNumber, 
      countryCode, 
      countryCallingCode,
      profilePicture
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
    
    if (profilePicture !== undefined) {
      clientUpdateData.profilePic = profilePicture;
      userUpdateData.profilePic = profilePicture;
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



