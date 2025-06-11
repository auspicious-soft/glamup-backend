import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import { successResponse } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import UserBusinessProfile, {
  BusinessHours,
  DaySchedule,
  TimeSlot,
} from "../../models/business/userBusinessProfileSchema";
import {
  validateUserAuth,
  findUserBusiness,
  validateObjectId,
  validateAndProcessCategories,
  startSession,
  handleTransactionError,
  validateBusinessProfileAccess,
} from "../../utils/user/usercontrollerUtils";
import User from "../../models/user/userSchema";
import GlobalCategory from "../../models/globalCategory/globalCategorySchema";
import { Readable } from "stream";
import Busboy from "busboy";
import { 
  createS3Client, 
  getS3FullUrl, 
  uploadStreamToS3BusinessProfile, 
  AWS_BUCKET_NAME 
} from "../../config/s3";
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import RegisteredTeamMember from "models/registeredTeamMember/registeredTeamMemberSchema";

const validateAndProcessGlobalCategories = async (
  categoryIds: string[],
  res: Response,
  session?: any
): Promise<any[] | null> => {
  try {
    // Find all the global categories by their IDs
    const categories = session
      ? await GlobalCategory.find({ 
          _id: { $in: categoryIds }, 
          isActive: true, 
          isDeleted: false 
        }).session(session)
      : await GlobalCategory.find({ 
          _id: { $in: categoryIds }, 
          isActive: true, 
          isDeleted: false 
        });

    // Check if all requested categories were found
    if (categories.length !== categoryIds.length) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      errorResponseHandler(
        "One or more selected categories are invalid or inactive",
        httpStatusCode.BAD_REQUEST,
        res
      );
      return null;
    }

    // Format the categories for storage
    return categories.map(category => ({
      categoryId: category._id,
      name: category.name,
      isActive: true
    }));
  } catch (error) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    const parsedError = errorParser(error);
    errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
    return null;
  }
};

const parseFormDataAndUpload = async (
  req: Request,
  businessEmail: string
): Promise<{ formData: any; uploadResult: { key: string; fullUrl: string } | null }> => {
  return new Promise((resolve, reject) => {
    const formData: any = {};
    let uploadPromise: Promise<string> | null = null;

    if (!req.headers["content-type"]?.includes("multipart/form-data")) {
      resolve({ formData, uploadResult: null });
      return;
    }

    const busboy = Busboy({ headers: req.headers });

    busboy.on("field", (fieldname, val) => {
      try {
        // Parse JSON fields like arrays and objects
        if (["selectedCategories", "businessHours", "address"].includes(fieldname)) {
          try {
            formData[fieldname] = JSON.parse(val);
          } catch (e) {
            formData[fieldname] = val;
          }
        } else {
          formData[fieldname] = val;
        }
      } catch (error) {
        console.error(`Error parsing field ${fieldname}:`, error);
        formData[fieldname] = val;
      }
    });

    busboy.on("file", async (fieldname, fileStream, fileInfo) => {
      if (fieldname !== "businessProfilePic") {
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

      uploadPromise = uploadStreamToS3BusinessProfile(
        readableStream,
        filename,
        mimeType,
        businessEmail
      );
    });

    busboy.on("finish", async () => {
      try {
        const uploadResult = uploadPromise
          ? { key: await uploadPromise, fullUrl: getS3FullUrl(await uploadPromise) }
          : null;
        resolve({ formData, uploadResult });
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

const uploadProfilePictureToS3 = async (req: Request, businessEmail: string): Promise<{ key: string, fullUrl: string } | null> => {
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
        if (fieldname !== "businessProfilePic") {
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

        // Use the provided business email
        uploadPromise = uploadStreamToS3BusinessProfile(
          readableStream,
          filename,
          mimeType,
          businessEmail
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

// Business Profile functions
export const createBusinessProfile = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) {
      await session.abortTransaction();
      session.endSession();
      return;
    }

    if (!req.headers["content-type"]?.includes("multipart/form-data")) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Request must be multipart/form-data",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Extract email from request body or fallback to empty string
    const emailFromBody = req.body?.email || "";
    const { formData, uploadResult } = await parseFormDataAndUpload(req, emailFromBody);

    const {
      businessName,
      businessDescription,
      phoneNumber,
      countryCode,
      countryCallingCode,
      email,
      websiteLink,
      facebookLink,
      instagramLink,
      messengerLink,
      address,
      country,
      selectedCategories,
      businessHours,
    } = formData;

    let businessProfilePic: string | undefined;
    if (uploadResult) {
      businessProfilePic = uploadResult.key;
    }

    if (!businessName) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Business name is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (!countryCallingCode) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Country calling code is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const existingBusiness = await findUserBusiness(userId, session);
    if (existingBusiness) {
      await session.abortTransaction();
      session.endSession();
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "You already have a business profile",
      });
    }

    let processedCategories: any[] = [];
    if (
      selectedCategories &&
      Array.isArray(selectedCategories) &&
      selectedCategories.length > 0
    ) {
      const processedCategoriesResult = await validateAndProcessGlobalCategories(
        selectedCategories,
        res,
        session
      );
      if (processedCategoriesResult === null) {
        await session.abortTransaction();
        session.endSession();
        return;
      }
      processedCategories = processedCategoriesResult;
    }

    let processedBusinessHours: BusinessHours = {
      monday: { isOpen: true, timeSlots: [{ open: "09:00", close: "17:00" }] },
      tuesday: { isOpen: true, timeSlots: [{ open: "09:00", close: "17:00" }] },
      wednesday: { isOpen: true, timeSlots: [{ open: "09:00", close: "17:00" }] },
      thursday: { isOpen: true, timeSlots: [{ open: "09:00", close: "17:00" }] },
      friday: { isOpen: true, timeSlots: [{ open: "09:00", close: "17:00" }] },
      saturday: { isOpen: true, timeSlots: [{ open: "09:00", close: "17:00" }] },
      sunday: { isOpen: false, timeSlots: [{ open: "09:00", close: "17:00" }] },
    };

    if (businessHours && typeof businessHours === "object") {
      const days = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ];

      for (const day of days) {
        if (businessHours[day]) {
          const dayData = businessHours[day];
          const daySchedule: DaySchedule = {
            isOpen: dayData.isOpen !== undefined ? dayData.isOpen : processedBusinessHours[day].isOpen,
            timeSlots: [],
          };

          if (dayData.timeSlots && Array.isArray(dayData.timeSlots)) {
            for (const slot of dayData.timeSlots) {
              if (slot.open && slot.close) {
                daySchedule.timeSlots.push({
                  open: slot.open,
                  close: slot.close,
                });
              }
            }
          }

          if (daySchedule.timeSlots.length === 0 && processedBusinessHours[day].timeSlots) {
            daySchedule.timeSlots = processedBusinessHours[day].timeSlots;
          }

          processedBusinessHours[day] = daySchedule;
        }
      }
    }

    const newBusinessProfile = await UserBusinessProfile.create(
      [
        {
          businessName,
          businessDescription,
          PhoneNumber: phoneNumber,
          countryCode,
          countryCallingCode,
          email,
          websiteLink,
          facebookLink,
          instagramLink,
          messengerLink,
          businessProfilePic,
          address,
          country,
          selectedCategories: processedCategories,
          businessHours: processedBusinessHours,
          ownerId: userId,
          status: "active",
        },
      ],
      { session }
    );

    await User.findByIdAndUpdate(
      userId,
      { businessRole: "owner" },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    const responseData = {
      businessProfile: {
        ...newBusinessProfile[0].toObject(),
        businessProfilePicUrl: businessProfilePic ? getS3FullUrl(businessProfilePic) : undefined,
      },
    };

    return successResponse(
      res,
      "Business profile created successfully",
      responseData,
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getAllBusinessProfiles = async (req: Request, res: Response) => {
  try {
    const businessProfiles = await UserBusinessProfile.find({
      isDeleted: false,
      status: "active",
    })
      .select(
        "businessName businessProfilePic PhoneNumber countryCode email businessDescription " +
          "websiteLink facebookLink instagramLink messengerLink country selectedCategories"
      )
      .sort({ createdAt: -1 });

    return successResponse(res, "Business profiles fetched successfully", {
      businessProfiles,
    });
  } catch (error: any) {
    console.error("Error fetching business profiles:", error);
    return errorResponseHandler(
      "Failed to fetch business profiles",
      httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
  }
};

export const getBusinessProfileById = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    const { profileId } = req.params;

    if (!(await validateObjectId(profileId, "Business profile", res))) return;

    // Use the helper function to validate access and get the business profile
    const businessProfile = await validateBusinessProfileAccess(userId, profileId, res);
    if (!businessProfile) return;

    return successResponse(res, "Business profile fetched successfully", {
      businessProfile,
    });
  } catch (error: any) {
    console.error("Error fetching business profile:", error);
    return errorResponseHandler(
      "Failed to fetch business profile",
      httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
  }
};

export const updateBusinessProfile = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    // Validate user authentication
    const userId = await validateUserAuth(req, res, session);
    if (!userId) {
      await session.abortTransaction();
      session.endSession();
      return;
    }

    // Validate profileId
    const { profileId } = req.params;
    if (!(await validateObjectId(profileId, "Business profile", res, session))) {
      await session.abortTransaction();
      session.endSession();
      return;
    }

    // Find existing business profile
    const existingProfile = await UserBusinessProfile.findOne({
      _id: profileId,
      ownerId: userId,
      isDeleted: false,
    }).session(session);

    if (!existingProfile) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Business profile not found or you don't have permission to update it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Handle profile picture upload if it's a multipart request
    let businessProfilePic = existingProfile.businessProfilePic;
    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      try {
        const isDummyImage = businessProfilePic.includes("DummyBusinessProfilePic.png");
        const businessEmail = existingProfile.email || userId.toString();
        
        const s3Client = createS3Client();
        const folderPrefix = `business-profiles/${businessEmail}/profile-pictures/`;
        
        let folderExists = false;
        if (!isDummyImage) {
          folderExists = true;
        } else {
          try {
            const listParams = {
              Bucket: AWS_BUCKET_NAME,
              Prefix: folderPrefix,
              MaxKeys: 1
            };
            
            const listResult = await s3Client.send(new ListObjectsV2Command(listParams));
            folderExists = !!(listResult.Contents && listResult.Contents.length > 0);
          } catch (error) {
            console.error("Error checking S3 folder:", error);
            folderExists = false;
          }
        }
        
        const uploadResult = await uploadProfilePictureToS3(req, businessEmail);
        
        if (uploadResult) {
          if (!isDummyImage) {
            try {
              const deleteParams = {
                Bucket: AWS_BUCKET_NAME,
                Key: businessProfilePic
              };
              
              await s3Client.send(new DeleteObjectCommand(deleteParams));
            } catch (deleteError) {
              console.error("Error deleting old profile picture:", deleteError);
            }
          }
          
          businessProfilePic = uploadResult.key;
        }
      } catch (uploadError: any) {
        console.error("Profile picture upload error:", uploadError);
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Unable to process profile image. Please try again with a different image or format.",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
    }

    const {
      businessName,
      businessDescription,
      phoneNumber,
      countryCode,
      countryCallingCode,
      email,
      websiteLink,
      facebookLink,
      instagramLink,
      messengerLink,
      address,
      country,
      selectedCategories,
      businessHours,
    } = req.body || {};

    // Process categories
    let processedCategories: any = existingProfile.selectedCategories;
    if (
      selectedCategories &&
      Array.isArray(selectedCategories) &&
      selectedCategories.length > 0
    ) {
      const processedCategoriesResult = await validateAndProcessGlobalCategories(
        selectedCategories,
        res,
        session
      );
      if (processedCategoriesResult === null) {
        await session.abortTransaction();
        session.endSession();
        return;
      }
      processedCategories = processedCategoriesResult;
    }

    // Process business hours
    let processedBusinessHours = existingProfile.businessHours as unknown as BusinessHours;
    if (businessHours && typeof businessHours === "object") {
      const days = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ];

      for (const day of days) {
        if (businessHours[day]) {
          const dayData = businessHours[day];
          const daySchedule: DaySchedule = {
            isOpen:
              dayData.isOpen !== undefined
                ? dayData.isOpen
                : processedBusinessHours[day].isOpen,
            timeSlots: [],
          };

          if (dayData.timeSlots && Array.isArray(dayData.timeSlots)) {
            for (const slot of dayData.timeSlots) {
              if (slot.open && slot.close) {
                daySchedule.timeSlots.push({
                  open: slot.open,
                  close: slot.close,
                });
              }
            }
          }

          if (
            daySchedule.timeSlots.length === 0 &&
            processedBusinessHours[day].timeSlots
          ) {
            daySchedule.timeSlots = processedBusinessHours[day].timeSlots;
          }

          processedBusinessHours[day] = daySchedule;
        }
      }
    }

    // Prepare update data
    const updateData: any = {
      ...(businessName && { businessName }),
      ...(businessDescription !== undefined && { businessDescription }),
      ...(phoneNumber && { PhoneNumber: phoneNumber }),
      ...(countryCode && { countryCode }),
      ...(countryCallingCode && { countryCallingCode }),
      ...(email !== undefined && { email }),
      ...(websiteLink !== undefined && { websiteLink }),
      ...(facebookLink !== undefined && { facebookLink }),
      ...(instagramLink !== undefined && { instagramLink }),
      ...(messengerLink !== undefined && { messengerLink }),
      ...(businessProfilePic !== existingProfile.businessProfilePic && { businessProfilePic }),
      ...(address && { address }),
      ...(country !== undefined && { country }),
      ...(selectedCategories && { selectedCategories: processedCategories }),
      ...(businessHours && { businessHours: processedBusinessHours }),
    };

    // Update business profile
    const updatedProfile = await UserBusinessProfile.findByIdAndUpdate(
      profileId,
      { $set: updateData },
      { new: true, session }
    );

    if (!updatedProfile) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Failed to update business profile",
        httpStatusCode.INTERNAL_SERVER_ERROR,
        res
      );
    }

    // Commit transaction
    await session.commitTransaction();
    session.endSession();

    // Prepare response with full S3 URL
    const responseData = {
      businessProfile: {
        ...updatedProfile.toObject(),
        businessProfilePicUrl: getS3FullUrl(updatedProfile.businessProfilePic),
      },
    };

    return successResponse(
      res,
      "Business profile updated successfully",
      responseData,
      httpStatusCode.OK
    );
  } catch (error: any) {
    console.error("Error in updateBusinessProfile:", error);
    return handleTransactionError(session, error, res);
  }
};

