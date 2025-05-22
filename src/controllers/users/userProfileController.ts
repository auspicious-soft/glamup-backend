import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import { successResponse, verifyPassword, hashPassword } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import User from "../../models/user/userSchema";
import UserBusinessProfile from "../../models/business/userBusinessProfileSchema";
import { validateUserAuth, validateEmail } from "../../utils/user/usercontrollerUtils";
import mongoose from "mongoose";

export const getUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    const user = await User.findById(userId).select(
      "fullName email phoneNumber countryCode profilePicture"
    );

    if (!user) {
      return errorResponseHandler(
        "User not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    const businessProfile = await UserBusinessProfile.findOne({
      ownerId: userId,
      isDeleted: false,
      status: "active",
    }).select("_id businessName");

    const profileData = {
      userId: user._id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      countryCode: user.countryCode,
      profilePicture: user.profilePic,
      business: businessProfile
        ? {
            businessId: businessProfile._id,
            businessName: businessProfile.businessName,
          }
        : null,
    };

    return successResponse(res, "User profile fetched successfully", {
      profile: profileData,
    });
  } catch (error: any) {
    console.error("Error fetching user profile:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const updateUserProfile = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { fullName, email, phoneNumber, countryCode } = req.body;

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

    const updateData: any = {};
    
    if (fullName !== undefined) {
      updateData.fullName = fullName;
    }

    if (email !== undefined && email !== user.email) {
      if (!(await validateEmail(email, res, session))) return;
      
      const existingUserWithEmail = await User.findOne({ 
        email, 
        _id: { $ne: userId } 
      }).session(session);
      
      if (existingUserWithEmail) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Email is already in use by another user",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
      updateData.email = email;
    }

    if (phoneNumber !== undefined && phoneNumber !== user.phoneNumber) {
      const existingUserWithPhone = await User.findOne({ 
        phoneNumber, 
        _id: { $ne: userId } 
      }).session(session);
      
      if (existingUserWithPhone) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Phone number is already in use by another user",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
      updateData.phoneNumber = phoneNumber;
    }

    if (countryCode !== undefined) {
      updateData.countryCode = countryCode;
    }

    if (Object.keys(updateData).length === 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "No fields to update",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true, session }
    ).select("fullName email phoneNumber countryCode profilePicture");

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "User profile updated successfully", {
      profile: updatedUser
    });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    console.error("Error updating user profile:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const updateUserPassword = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return errorResponseHandler(
        "Current password and new password are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const user = await User.findById(userId);
    if (!user) {
      return errorResponseHandler(
        "User not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    const isPasswordValid = await verifyPassword(currentPassword, user.password);
    if (!isPasswordValid) {
      return errorResponseHandler(
        "Current password is incorrect",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (currentPassword === newPassword) {
      return errorResponseHandler(
        "New password must be different from current password",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    const hashedPassword = await hashPassword(newPassword);
    await User.findByIdAndUpdate(userId, {
      password: hashedPassword
    });

    return successResponse(res, "Password updated successfully");
  } catch (error: any) {
    console.error("Error updating password:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const deactivateUserAccount = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { password } = req.body;

    if (!password) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Password is required to deactivate account",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

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

    const isPasswordValid = await verifyPassword(password, user.password);
    if (!isPasswordValid) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Password is incorrect",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    await User.findByIdAndUpdate(
      userId,
      { 
        isActive: false,
        deactivatedAt: new Date()
      },
      { session }
    );

    const businessProfile = await UserBusinessProfile.findOne({
      ownerId: userId,
      status: "active"
    }).session(session);

    if (businessProfile) {
      await UserBusinessProfile.findByIdAndUpdate(
        businessProfile._id,
        { 
          status: "inactive",
          deactivatedAt: new Date()
        },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    return successResponse(
      res, 
      "Account deactivated successfully. " + 
      (businessProfile ? "Associated business profile has also been deactivated." : "")
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    console.error("Error deactivating account:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const reactivateUserAccount = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { email, password } = req.body;

    if (!email || !password) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Email and password are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    const user = await User.findOne({ 
      email, 
      isActive: false 
    }).session(session);

    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "No deactivated account found with this email",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    const isPasswordValid = await verifyPassword(password, user.password);
    if (!isPasswordValid) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Password is incorrect",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    await User.findByIdAndUpdate(
      user._id,
      { 
        isActive: true,
        deactivatedAt: null
      },
      { session }
    );

    const businessProfile = await UserBusinessProfile.findOne({
      ownerId: user._id,
      status: "inactive"
    }).session(session);

    if (businessProfile) {
      await UserBusinessProfile.findByIdAndUpdate(
        businessProfile._id,
        { 
          status: "active",
          deactivatedAt: null
        },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    return successResponse(
      res, 
      "Account reactivated successfully. " + 
      (businessProfile ? "Associated business profile has also been reactivated." : "")
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    console.error("Error reactivating account:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};
