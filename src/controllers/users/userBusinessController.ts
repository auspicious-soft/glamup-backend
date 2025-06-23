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
  extractUserId,
} from "../../utils/user/usercontrollerUtils";
import User from "../../models/user/userSchema";
import GlobalCategory from "../../models/globalCategory/globalCategorySchema";
import { Readable } from "stream";
import Busboy from "busboy";
import { 
  createS3Client, 
  getS3FullUrl, 
  uploadStreamToS3BusinessProfile, 
  AWS_BUCKET_NAME,
  AWS_REGION
} from "../../config/s3";
import { DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import RegisteredTeamMember from "models/registeredTeamMember/registeredTeamMemberSchema";
import Service from "models/services/servicesSchema";
import Package from "models/package/packageSchema";
import mongoose from "mongoose";

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
): Promise<{ formData: any; uploadResults: { key: string; fullUrl: string }[] }> => {
  return new Promise((resolve, reject) => {
    const formData: any = {};
    const fileStreams: { stream: Readable; filename: string; mimeType: string }[] = [];
    const busboy = Busboy({ headers: req.headers });

    busboy.on("field", (fieldname, val) => {
      try {
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

    busboy.on("file", (fieldname, fileStream, fileInfo) => {
      if (fieldname !== "businessProfilePic" && fieldname !== "businessProfilePic[]") {
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

      fileStreams.push({ stream: readableStream, filename, mimeType });
    });

    busboy.on("finish", async () => {
      try {
        const emailForUpload = formData.email || businessEmail;
        if (!emailForUpload) {
          throw new Error("Email is required for S3 upload");
        }

        const uploadPromises = fileStreams.map(({ stream, filename, mimeType }) =>
          uploadStreamToS3BusinessProfile(stream, filename, mimeType, emailForUpload)
        );

        const keys = await Promise.all(uploadPromises);
        const uploadResults = keys.map((key) => ({
          key,
          fullUrl: getS3FullUrl(key),
        }));
        resolve({ formData, uploadResults });
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


export const uploadProfilePictureToS3 = async (req: Request, businessEmail: string): Promise<{ key: string; fullUrl: string }[] | null> => {
  return new Promise((resolve, reject) => {
    if (!req.headers["content-type"]?.includes("multipart/form-data")) {
      console.log("No multipart/form-data content-type, skipping upload");
      resolve(null);
      return;
    }

    const fileStreams: { stream: Readable; filename: string; mimeType: string }[] = [];
    const busboy = Busboy({ headers: req.headers });

    busboy.on("file", (fieldname: string, fileStream: any, fileInfo: any) => {
      if (fieldname !== "businessProfilePic" && fieldname !== "businessProfilePic[]") {
        console.log(`Ignoring file with fieldname: ${fieldname}`);
        fileStream.resume();
        return;
      }

      const { filename, mimeType } = fileInfo;
      console.log(`Processing file: ${filename}, mimeType: ${mimeType}`);

      const readableStream = new Readable();
      readableStream._read = () => {};

      fileStream.on("data", (chunk: any) => {
        readableStream.push(chunk);
      });

      fileStream.on("end", () => {
        readableStream.push(null);
      });

      fileStreams.push({ stream: readableStream, filename, mimeType });
    });

    busboy.on("field", (fieldname, val) => {
      if (!req.body) req.body = {};
      req.body[fieldname] = val;
    });

    busboy.on("finish", async () => {
      try {
        console.log(`Found ${fileStreams.length} files to upload`);
        if (fileStreams.length > 0) {
          const uploadPromises = fileStreams.map(({ stream, filename, mimeType }) =>
            uploadStreamToS3BusinessProfile(stream, filename, mimeType, businessEmail)
          );
          const keys = await Promise.all(uploadPromises);
          const uploadResults = keys.map((key) => ({
            key,
            fullUrl: getS3FullUrl(key),
          }));
          console.log("Upload results:", uploadResults);
          resolve(uploadResults);
        } else {
          console.log("No files uploaded");
          resolve(null);
        }
      } catch (error) {
        console.error("Error in uploadProfilePictureToS3:", error);
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

    const emailFromBody = req.body?.email || "";
    console.log(req.body?.email,"email")
    const { formData, uploadResults } = await parseFormDataAndUpload(req, "");

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
        coordinates,
    } = formData;


    let processedAddress = address;
if (typeof processedAddress === "string") {
  try {
    processedAddress = JSON.parse(processedAddress);
  } catch (e) {
    processedAddress = {};
  }
}

    if (!email) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Email is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

        const dummyProfilePicUrl = "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/DummyBusinessProfilePic.png";


let businessProfilePic: string[] = [];

if (uploadResults && uploadResults.length > 0) {
  businessProfilePic = uploadResults.map((img) => img.key);
} else {
  businessProfilePic = [dummyProfilePicUrl];
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

let processedCoordinates = null;
    if (coordinates) {
      try {
        const coords = JSON.parse(coordinates); 
        const { latitude, longitude } = coords;

        if (!latitude || !longitude) {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            "Coordinates must include latitude and longitude",
            httpStatusCode.BAD_REQUEST,
            res
          );
        }

        const lat = parseFloat(latitude);
        const lon = parseFloat(longitude);

        if (
          isNaN(lat) ||
          isNaN(lon) ||
          lat < -90 ||
          lat > 90 ||
          lon < -180 ||
          lon > 180
        ) {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            "Invalid coordinates provided",
            httpStatusCode.BAD_REQUEST,
            res
          );
        }

        processedCoordinates = {
          type: "Point",
          coordinates: [lon, lat],
        };
      } catch (error) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Invalid coordinates format",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
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
      address: processedAddress,
      country,
      coordinates: processedCoordinates, 
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
     businessProfilePic: businessProfilePic.map(url => 
  url === dummyProfilePicUrl ? url : getS3FullUrl(url)
),
      coordinates: processedCoordinates
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
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Validate user authentication
    const userId = extractUserId(req);
    if (!userId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Invalid user authentication",
        httpStatusCode.UNAUTHORIZED,
        res
      );
    }

    // Validate profileId
    const { profileId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Invalid Business profile ID format",
        httpStatusCode.BAD_REQUEST,
        res
      );
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

    // Handle profile picture uploads if it's a multipart request
    let businessProfilePic = existingProfile.businessProfilePic || [];
    let imagesUploaded = false;
    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      try {
        const isDummyImage = businessProfilePic.includes("https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/DummyBusinessProfilePic.png");
        const businessEmail = existingProfile.email || userId.toString();

        const s3Client = createS3Client();
        const folderPrefix = `business-profiles/${businessEmail}/profile-pictures/`;

        let folderExists = false;
        if (!isDummyImage && businessProfilePic.length > 0) {
          folderExists = true;
        } else {
          try {
            const listParams = {
              Bucket: AWS_BUCKET_NAME,
              Prefix: folderPrefix,
              MaxKeys: 1,
            };
            const listResult = await s3Client.send(new ListObjectsV2Command(listParams));
            folderExists = !!(listResult.Contents && listResult.Contents.length > 0);
          } catch (error) {
            console.error("Error checking S3 folder:", error);
            folderExists = false;
          }
        }

        const uploadResults = await uploadProfilePictureToS3(req, businessEmail);

        if (uploadResults && uploadResults.length > 0) {
          imagesUploaded = true;
          // Delete old images if they exist and are not the dummy image
          if (!isDummyImage && businessProfilePic.length > 0) {
            try {
              const deletePromises = businessProfilePic.map((url) => {
                // Extract key from full URL if necessary
                const key = url.replace(`https://${AWS_BUCKET_NAME}.s3.${AWS_REGION}.amazonaws.com/`, "");
                const deleteParams = {
                  Bucket: AWS_BUCKET_NAME,
                  Key: key,
                };
                return s3Client.send(new DeleteObjectCommand(deleteParams));
              });
              await Promise.all(deletePromises);
              console.log("Deleted old images from S3");
            } catch (deleteError) {
              console.error("Error deleting old profile pictures:", deleteError);
            }
          }

          // Update businessProfilePic with full S3 URLs
          businessProfilePic = uploadResults.map((result) => result.fullUrl);
          console.log("New businessProfilePic (full URLs):", businessProfilePic);
        }
      } catch (uploadError: any) {
        console.error("Profile picture upload error:", uploadError);
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Unable to process profile images. Please try again with different images or formats.",
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


    
    let processedAddress = address;
if (typeof processedAddress === "string") {
  try {
    processedAddress = JSON.parse(processedAddress);
  } catch (e) {
    processedAddress = {};
  }
}

    // Process categories
    let processedCategories: any = existingProfile.selectedCategories;
    if (
      selectedCategories &&
      Array.isArray(selectedCategories) &&
      selectedCategories.length > 0
    ) {
      for (const categoryId of selectedCategories) {
        if (!mongoose.Types.ObjectId.isValid(categoryId)) {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            `Invalid category ID format: ${categoryId}`,
            httpStatusCode.BAD_REQUEST,
            res
          );
        }
      }

      const categories = await GlobalCategory.find({
        _id: { $in: selectedCategories },
        isActive: true,
        isDeleted: false,
      }).session(session);

      if (categories.length !== selectedCategories.length) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "One or more selected global categories do not exist or are inactive",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }

      processedCategories = categories.map((category) => ({
        categoryId: category._id as mongoose.Types.ObjectId,
        name: category.name,
      }));
    }

 // Process business hours
let processedBusinessHours = existingProfile.businessHours as unknown as BusinessHours;
if (typeof businessHours === "string") {
  try {
    processedBusinessHours = JSON.parse(businessHours);
    // Validate the parsed structure
    const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
    for (const day of days) {
      if (processedBusinessHours[day]) {
        const dayData = processedBusinessHours[day];
        const daySchedule: DaySchedule = {
          isOpen: dayData.isOpen !== undefined ? dayData.isOpen : processedBusinessHours[day].isOpen,
          timeSlots: [],
        };
        if (dayData.timeSlots && Array.isArray(dayData.timeSlots)) {
          for (const slot of dayData.timeSlots) {
            if (slot.open && slot.close) {
              daySchedule.timeSlots.push({ open: slot.open, close: slot.close });
            }
          }
        }
        if (daySchedule.timeSlots.length === 0 && processedBusinessHours[day].timeSlots) {
          daySchedule.timeSlots = processedBusinessHours[day].timeSlots;
        }
        processedBusinessHours[day] = daySchedule;
      }
    }
  } catch (e) {
    console.error("Error parsing businessHours:", e);
    processedBusinessHours = existingProfile.businessHours as unknown as BusinessHours;
  }
} else if (typeof businessHours === "object" && businessHours !== null) {
  processedBusinessHours = businessHours;
  // Validate the object structure
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  for (const day of days) {
    if (processedBusinessHours[day]) {
      const dayData = processedBusinessHours[day];
      const daySchedule: DaySchedule = {
        isOpen: dayData.isOpen !== undefined ? dayData.isOpen : processedBusinessHours[day].isOpen,
        timeSlots: [],
      };
      if (dayData.timeSlots && Array.isArray(dayData.timeSlots)) {
        for (const slot of dayData.timeSlots) {
          if (slot.open && slot.close) {
            daySchedule.timeSlots.push({ open: slot.open, close: slot.close });
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

    // Prepare update data
   const updateData: any = {
      ...(businessName && { businessName }),
      ...(businessDescription !== undefined && { businessDescription }),
      ...(phoneNumber && { phoneNumber }),
      ...(countryCode && { countryCode }),
      ...(countryCallingCode && { countryCallingCode }),
      ...(email !== undefined && { email }),
      ...(websiteLink !== undefined && { websiteLink }),
      ...(facebookLink !== undefined && { facebookLink }),
      ...(instagramLink !== undefined && { instagramLink }),
      ...(messengerLink !== undefined && { messengerLink }),
      ...(imagesUploaded && { businessProfilePic }),
      ...(address && { address: processedAddress }),
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

    await session.commitTransaction();
    session.endSession();

    const responseData = {
      businessProfile: {
        ...updatedProfile.toObject(),
        businessProfilePic: updatedProfile.businessProfilePic.map((url) =>
          url.includes("https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/DummyBusinessProfilePic.png")
            ? url
            : url
        ),
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

    if (session && session.inTransaction()) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    if (session) {
      session.endSession();
    }

    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message || "An error occurred while updating the business profile",
    });
  }
};

export const updateBusinessGlobalCategories = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Get user ID from authentication
    const userId = extractUserId(req);
    if (!userId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Invalid user authentication",
        httpStatusCode.UNAUTHORIZED,
        res
      );
    }

    // Get the business profile
    const businessProfile = await UserBusinessProfile.findOne({
      ownerId: userId,
      isDeleted: false,
    }).session(session);

    if (!businessProfile) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Business profile not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    const { selectedCategories } = req.body;

    if (!Array.isArray(selectedCategories)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Selected categories must be provided as an array",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Get current categories to track changes
    const currentCategories = businessProfile.selectedCategories || [];
    const currentCategoryIds = currentCategories.map((cat) => cat.categoryId.toString());

    let processedCategories: { categoryId: mongoose.Types.ObjectId; name: string }[] = [];
    let newCategoryIds: string[] = [];

    // Only process categories if the array is not empty
    if (selectedCategories.length > 0) {
      // Validate that all category IDs are valid ObjectIds
      for (const categoryId of selectedCategories) {
        if (!mongoose.Types.ObjectId.isValid(categoryId)) {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            `Invalid category ID format: ${categoryId}`,
            httpStatusCode.BAD_REQUEST,
            res
          );
        }
      }

      // Check if all categories exist
      const categories = await GlobalCategory.find({
        _id: { $in: selectedCategories },
        isActive: true,
        isDeleted: false,
      }).session(session);

      if (categories.length !== selectedCategories.length) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "One or more selected global categories do not exist or are inactive",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }

      // Process categories
      processedCategories = categories.map((category) => ({
        categoryId: category._id as mongoose.Types.ObjectId,
        name: category.name,
      }));

      newCategoryIds = processedCategories.map((cat) => cat.categoryId.toString());
    }

    // Find categories that are being removed
    const removedCategoryIds = currentCategoryIds.filter((id) => !newCategoryIds.includes(id));

    // Update the business profile with new categories (or empty array)
    const updatedProfile = await UserBusinessProfile.findByIdAndUpdate(
      businessProfile._id,
      { $set: { selectedCategories: processedCategories } },
      { new: true, session }
    );

    if (!updatedProfile) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Failed to update business profile categories",
        httpStatusCode.INTERNAL_SERVER_ERROR,
        res
      );
    }

    // Handle services and packages for removed categories
    if (removedCategoryIds.length > 0) {
      await Service.updateMany(
        {
          businessId: businessProfile._id,
          categoryId: { $in: removedCategoryIds },
          isGlobalCategory: true,
          isDeleted: false,
        },
        { $set: { isActive: false } },
        { session }
      );

      await Package.updateMany(
        {
          businessId: businessProfile._id,
          categoryId: { $in: removedCategoryIds },
          isGlobalCategory: true,
          isDeleted: false,
        },
        { $set: { isActive: false } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    // Prepare response
    const responseData = {
      businessProfile: {
        ...updatedProfile.toObject(),
        businessProfilePic: updatedProfile.businessProfilePic.map((url) =>
          updatedProfile.businessProfilePic.includes(
            "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/DummyBusinessProfilePic.png"
          )
            ? url
            : getS3FullUrl(url)
        ),
      },
    };

    return successResponse(
      res,
      selectedCategories.length === 0
        ? "All global categories have been removed from your business profile"
        : "Business global categories updated successfully",
      responseData,
      httpStatusCode.OK
    );
  } catch (error: any) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    console.error("Error in updateBusinessGlobalCategories:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message || "An error occurred while updating global categories",
      parsedError.code || httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
  }
};

export const deleteBusinessProfileImage = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Log incoming request
    console.log('Incoming request:', {
      profileId: req.params.profileId,
      imageKey: req.query.imageKey,
      userId: req.user, // Assuming extractUserId attaches user to req
    });

    // Validate user authentication
    const userId = extractUserId(req);
    if (!userId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Invalid user authentication",
        httpStatusCode.UNAUTHORIZED,
        res
      );
    }

    // Validate profileId
    const { profileId } = req.params;
    if (!mongoose.Types.ObjectId.isValid(profileId)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Invalid Business profile ID format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Get imageKey from query parameter
    const imageKey = req.query.imageKey as string;
    if (!imageKey) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Image key is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
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
        "Business profile not found or you don't have permission to modify it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Log businessProfilePic for debugging
    console.log('Current businessProfilePic:', existingProfile.businessProfilePic);

    // Check if the imageKey (full URL) exists in businessProfilePic
    if (!existingProfile.businessProfilePic.includes(imageKey)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        `Image with URL ${imageKey} not found in business profile`,
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Prevent deletion of the dummy image
    const dummyImageUrl = "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/DummyBusinessProfilePic.png";
    if (imageKey === dummyImageUrl) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Cannot delete the default dummy image",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Extract S3 key for deletion
    let s3Key = imageKey;
    const bucketUrlPrefix = `https://${AWS_BUCKET_NAME}.s3.eu-north-1.amazonaws.com/`;
    if (imageKey.startsWith(bucketUrlPrefix)) {
      s3Key = imageKey.replace(bucketUrlPrefix, '');
      console.log(`Converted full URL to S3 key for deletion: ${s3Key}`);
    } else {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Invalid image URL format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Delete the image from S3
    try {
      const s3Client = createS3Client();
      const deleteParams = {
        Bucket: AWS_BUCKET_NAME,
        Key: s3Key,
      };
      await s3Client.send(new DeleteObjectCommand(deleteParams));
      console.log(`Successfully deleted image from S3: ${s3Key}`);
    } catch (s3Error) {
      console.error("Error deleting image from S3:", s3Error);
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Failed to delete image from S3",
        httpStatusCode.INTERNAL_SERVER_ERROR,
        res
      );
    }

    // Update businessProfilePic by removing the deleted image URL
    let updatedBusinessProfilePic = existingProfile.businessProfilePic.filter(
      (url) => url !== imageKey
    );

    // If no images remain, set to dummy image
    if (updatedBusinessProfilePic.length === 0) {
      updatedBusinessProfilePic = [dummyImageUrl];
    }

    // Update the business profile in the database
    const updatedProfile = await UserBusinessProfile.findByIdAndUpdate(
      profileId,
      { $set: { businessProfilePic: updatedBusinessProfilePic } },
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

    // Prepare response with array of full S3 URLs
    const responseData = {
      businessProfile: {
        ...updatedProfile.toObject(),
        businessProfilePic: updatedProfile.businessProfilePic,
      },
    };

    return successResponse(
      res,
      "Image deleted successfully",
      responseData,
      httpStatusCode.OK
    );
  } catch (error: any) {
    console.error("Error in deleteBusinessProfileImage:", error);

    if (session && session.inTransaction()) {
      try {
        await session.abortTransaction();
      } catch (abortError) {
        console.error("Error aborting transaction:", abortError);
      }
    }

    if (session) {
      session.endSession();
    }

    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message || "An error occurred while deleting the image",
    });
  }
};