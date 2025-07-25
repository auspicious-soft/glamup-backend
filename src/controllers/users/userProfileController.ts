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
import { Readable } from "stream";
import Busboy from "busboy";
import { createS3Client, getS3FullUrl, uploadStreamToS3ofUser } from "../../config/s3";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import RegisteredTeamMember from "models/registeredTeamMember/registeredTeamMemberSchema";

// Helper function to handle file upload to S3
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

        uploadPromise = uploadStreamToS3ofUser(
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

export const getUserProfile = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    const user = await User.findById(userId).select(
      "fullName email phoneNumber countryCode countryCallingCode profilePic isVerified verificationMethod isActive isDeleted authType role businessRole identifierId "
    );

    if (!user) {
      return errorResponseHandler(
        "User not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    let businessProfile = null;

    if (user.businessRole === "team-member") {
      // Find the team membership
      const teamMembership = await RegisteredTeamMember.findOne({
        userId: userId,
        isDeleted: false,
        isActive: true,
      });

      if (teamMembership && teamMembership.businessId) {
        // Find the business by businessId
        businessProfile = await UserBusinessProfile.findOne({
          _id: teamMembership.businessId,
          isDeleted: false,
          status: "active",
        }).select("_id businessName");
      }
    } else {
      // Default: owner or other roles
      businessProfile = await UserBusinessProfile.findOne({
        ownerId: userId,
        isDeleted: false,
        status: "active",
      }).select("_id businessName");
    }

    const profileData = {
      userId: user._id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      countryCode: user.countryCode,
      countryCallingCode: user.countryCallingCode,
      profilePicture: user.profilePic,
      isVerified: user.isVerified,
      verificationMethod: user.verificationMethod,
      isActive: user.isActive,
      isDeleted: user.isDeleted,
      authType: user.authType,
      role: user.role,
      businessRole: user.businessRole,
      identifierId: user.identifierId,
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

    // Handle profile picture upload if it's a multipart request
    let profilePicUrl = user.profilePic;
    let profilePicUpdated = false;
    const isDefaultImage = profilePicUrl.includes("dummyUserPic.png");
    
    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      try {
        // Upload new profile picture
        const uploadResult = await uploadProfilePictureToS3(req, user.email);
        
        // Update profile picture URL if new one was uploaded
        if (uploadResult) {
          // If user already has a custom profile picture (not the default one),
          // we should delete the old one from S3
          if (!isDefaultImage) {
            try {
              const s3Client = createS3Client();
              // Extract the key from the full URL
              const oldKey = profilePicUrl.split('amazonaws.com/')[1];
              
              if (oldKey && oldKey.startsWith('users/')) {
                const deleteParams = {
                  Bucket: process.env.AWS_BUCKET_NAME as string,
                  Key: oldKey
                };
                
                await s3Client.send(new DeleteObjectCommand(deleteParams));
                console.log("Successfully deleted old profile picture:", oldKey);
              }
              
              // Only mark as updated if both upload and deletion (if needed) were successful
              profilePicUrl = uploadResult;
              profilePicUpdated = true;
              console.log("New profile picture URL:", profilePicUrl);
            } catch (deleteError) {
              console.error("Error deleting old profile picture:", deleteError);
              // Don't update profile pic if deletion fails
            }
          } else {
            // For default image, no deletion needed
            profilePicUrl = uploadResult;
            profilePicUpdated = true;
            console.log("New profile picture URL:", profilePicUrl);
          }
        }
      } catch (uploadError) {
        console.error("Error uploading profile picture:", uploadError);
        // Don't update profile pic if upload fails
      }
    }

    const { fullName, email, phoneNumber, countryCode, countryCallingCode } = req.body;

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
    if (countryCallingCode !== undefined) {
      updateData.countryCallingCode = countryCallingCode;
    }
    
    // Only update profile picture if the entire process was successful
    if (profilePicUpdated) {
      updateData.profilePic = profilePicUrl;
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
    ).select("fullName email phoneNumber countryCode countryCallingCode profilePic isVerified verificationMethod isActive isDeleted authType role businessRole identifierId");

    if (!updatedUser) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Failed to update user profile",
        httpStatusCode.INTERNAL_SERVER_ERROR,
        res
      );
    }

    
    // --- NEW: Update RegisteredTeamMember if user is a team-member ---
    if (updatedUser.businessRole === "team-member") {
      const teamMemberUpdate: any = {};
      if (fullName !== undefined) teamMemberUpdate.fullName = fullName;
      if (email !== undefined) teamMemberUpdate.email = email;
      if (phoneNumber !== undefined) teamMemberUpdate.phoneNumber = phoneNumber;
      if (countryCode !== undefined) teamMemberUpdate.countryCode = countryCode;
      if (countryCallingCode !== undefined) teamMemberUpdate.countryCallingCode = countryCallingCode;
      if (profilePicUpdated) teamMemberUpdate.profilePic = profilePicUrl;

      await RegisteredTeamMember.updateMany(
        { userId: userId, isDeleted: false },
        { $set: teamMemberUpdate },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    // Get business profile data to match getUserProfile response format
    let businessProfile = null;

    if (user.businessRole === "team-member") {
      // Find the team membership
      const teamMembership = await RegisteredTeamMember.findOne({
        userId: userId,
        isDeleted: false,
        isActive: true,
      });

      if (teamMembership && teamMembership.businessId) {
        // Find the business by businessId
        businessProfile = await UserBusinessProfile.findOne({
          _id: teamMembership.businessId,
          isDeleted: false,
          status: "active",
        }).select("_id businessName");
      }
    } else {
      // Default: owner or other roles
      businessProfile = await UserBusinessProfile.findOne({
        ownerId: userId,
        isDeleted: false,
        status: "active",
      }).select("_id businessName");
    }

    // Format response to match getUserProfile
    const profileData = {
      userId: updatedUser._id,
      fullName: updatedUser.fullName,
      email: updatedUser.email,
      phoneNumber: updatedUser.phoneNumber,
      countryCode: updatedUser.countryCode,
      countryCallingCode: updatedUser.countryCallingCode,
      profilePicture: updatedUser.profilePic,
      isVerified: updatedUser.isVerified,
      verificationMethod: updatedUser.verificationMethod,
      isActive: updatedUser.isActive,
      isDeleted: updatedUser.isDeleted,
      authType: updatedUser.authType,
      role: updatedUser.role,
      businessRole: updatedUser.businessRole,
      identifierId: updatedUser.identifierId,
      business: businessProfile
        ? {
            businessId: businessProfile._id,
            businessName: businessProfile.businessName,
          }
        : null,
    };

    return successResponse(res, "User profile updated successfully", {
      profile: profileData,
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
        isDeleted:true,
        deactivatedAt: new Date()
      },
      { session }
    );

     if (user.businessRole === "team-member") {
      await RegisteredTeamMember.updateMany(
        { userId: userId, isDeleted: false },
        { 
          isActive: false,
          isDeleted: true,
          deactivatedAt: new Date()
        },
        { session }
      );
    }
    
    const businessProfile = await UserBusinessProfile.findOne({
      ownerId: userId,
      status: "active"
    }).session(session);

    if (businessProfile) {
      await UserBusinessProfile.findByIdAndUpdate(
        businessProfile._id,
        { 
          status: "inactive",
          isDeleted:true,
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
        isDeleted:false,
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


