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

    const existingBusiness = await findUserBusiness(userId, session);

    if (existingBusiness) {
      await session.abortTransaction();
      session.endSession();
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "You already have a business profile",
      });
    }

    // Process selected categories
    let processedCategories: any[] = [];
    if (
      selectedCategories &&
      Array.isArray(selectedCategories) &&
      selectedCategories.length > 0
    ) {
      const processedCategoriesResult = await validateAndProcessCategories(
        selectedCategories,
        res,
        session
      );
      if (processedCategoriesResult === null) return;
      processedCategories = processedCategoriesResult;
    }

    const defaultTimeSlot: TimeSlot = { open: "09:00", close: "17:00" };

    const processedBusinessHours: BusinessHours = {
      monday: { isOpen: true, timeSlots: [defaultTimeSlot] },
      tuesday: { isOpen: true, timeSlots: [defaultTimeSlot] },
      wednesday: { isOpen: true, timeSlots: [defaultTimeSlot] },
      thursday: { isOpen: true, timeSlots: [defaultTimeSlot] },
      friday: { isOpen: true, timeSlots: [defaultTimeSlot] },
      saturday: { isOpen: true, timeSlots: [defaultTimeSlot] },
      sunday: { isOpen: false, timeSlots: [defaultTimeSlot] },
    };

    const newBusinessProfile = await UserBusinessProfile.create(
      [
        {
          businessName,
          businessDescription,
          PhoneNumber: phoneNumber,
          countryCode,
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

    // Update the user's businessRole to "owner"
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

    // Find the business profile with owner check
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
      const processedCategoriesResult = await validateAndProcessCategories(
        selectedCategories,
        res,
        session
      );
      if (processedCategoriesResult === null) return;
      processedCategories = processedCategoriesResult;
    }

    let processedBusinessHours =
      existingProfile.businessHours as unknown as BusinessHours;

    if (businessHours) {
      const days = [
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
      ] as const;

      for (const day of days) {
        if (businessHours[day]) {
          const dayData = businessHours[day] as Partial<DaySchedule>;

          if (dayData.isOpen !== undefined) {
            processedBusinessHours[day].isOpen = dayData.isOpen;
          }

          if (dayData.timeSlots && Array.isArray(dayData.timeSlots)) {
            const validTimeSlots = dayData.timeSlots.filter(
              (slot) =>
                slot.open &&
                slot.close &&
                typeof slot.open === "string" &&
                typeof slot.close === "string"
            );

            if (validTimeSlots.length > 0) {
              processedBusinessHours[day].timeSlots = validTimeSlots;
            }
          }
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

    return successResponse(res, "Business profile updated successfully", {
      businessProfile: updatedProfile,
    });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

