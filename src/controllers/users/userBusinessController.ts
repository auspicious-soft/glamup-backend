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
} from "../../utils/user/usercontrollerUtils";
import User from "../../models/user/userSchema";
import GlobalCategory from "../../models/globalCategory/globalCategorySchema";

// Helper function to validate and process global categories
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

// Business Profile functions
export const createBusinessProfile = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

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
      businessProfilePic,
      address,
      country,
      selectedCategories,
      businessHours,
    } = req.body;

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
        "country Calling code is required",
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
      if (processedCategoriesResult === null) return;
      processedCategories = processedCategoriesResult;
    }

    // Process business hours
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

    return successResponse(
      res,
      "Business profile created successfully",
      { businessProfile: newBusinessProfile[0] },
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

    const businessProfile = await UserBusinessProfile.findOne({
      _id: profileId,
      ownerId: userId,
      isDeleted: false,
      status: "active",
    });

    if (!businessProfile) {
      return errorResponseHandler(
        "Business profile not found or you don't have permission to access it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

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
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { profileId } = req.params;

    if (!(await validateObjectId(profileId, "Business profile", res, session)))
      return;

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
      businessProfilePic,
      address,
      country,
      selectedCategories,
      businessHours,
    } = req.body;

    let processedCategories: any = (existingProfile as any).selectedCategories;
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
      if (processedCategoriesResult === null) return;
      processedCategories = processedCategoriesResult;
    }

    let processedBusinessHours =
      existingProfile.businessHours as unknown as BusinessHours;

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

    const updatedProfile = await UserBusinessProfile.findByIdAndUpdate(
      profileId,
      {
        $set: {
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
          ...(businessProfilePic && { businessProfilePic }),
          ...(address && { address }),
          ...(country !== undefined && { country }),
          ...(selectedCategories && { selectedCategories: processedCategories }),
          ...(businessHours && { businessHours: processedBusinessHours }),
        },
      },
      { new: true, session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(
      res,
      "Business profile updated successfully",
      { businessProfile: updatedProfile },
      httpStatusCode.OK
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

