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
import Service from "../../models/services/servicesSchema";
import mongoose from "mongoose";
import TeamMember from "../../models/team/teamMemberSchema";
import {
  validateUserAuth,
  findUserBusiness,
  validateObjectId,
  buildTeamMemberQuery,
  validateEmail,
  validateAndProcessServices,
  startSession,
  handleTransactionError,
  checkDuplicateTeamMemberEmail,
  validateBusinessForClient,
  checkDuplicateClientEmail,
  buildClientSearchQuery,
  validateClientAccess,
  processClientUpdateData,
} from "../../utils/user/usercontrollerUtils";
import Client from "models/client/clientSchema";
import Category from "models/category/categorySchema";


export const getAllServices = async (req: Request, res: Response) => {
  try {
    const services = await Service.find({ isActive: true }).sort({ name: 1 });
    return successResponse(res, "Services fetched successfully", { services });
  } catch (error: any) {
    console.error("Error fetching services:", error);
    return errorResponseHandler(
      "Failed to fetch services",
      httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
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
      email,
      websiteLink,
      facebookLink,
      instagramLink,
      messengerLink,
      businessProfilePic,
      address,
      country,
      selectedServices,
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

    let processedServices = [];
    if (
      selectedServices &&
      Array.isArray(selectedServices) &&
      selectedServices.length > 0
    ) {
      const processedServicesResult = await validateAndProcessServices(
        selectedServices,
        res,
        session
      );
      if (processedServicesResult === null) return;
      processedServices = processedServicesResult;
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
          selectedServices: processedServices,
          businessHours: processedBusinessHours,
          ownerId: userId,
          status: "active",
        },
      ],
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
          "websiteLink facebookLink instagramLink messengerLink country selectedServices"
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
      selectedServices,
      businessHours,
    } = req.body;

    let processedServices: any = existingProfile.selectedServices;
    if (
      selectedServices &&
      Array.isArray(selectedServices) &&
      selectedServices.length > 0
    ) {
      const processedServicesResult = await validateAndProcessServices(
        selectedServices,
        res,
        session
      );
      if (processedServicesResult === null) return;
      processedServices = processedServicesResult;
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
          ...(selectedServices && { selectedServices: processedServices }),
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

// Team Member functions
export const createTeamMember = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { name, email, phoneNumber, countryCode, gender, birthday } =
      req.body;

    if (!name || !email) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Name and email are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (!(await validateEmail(email, res, session))) return;

    const business = await findUserBusiness(userId, session);
    const businessId = business ? business._id : null;

    if (business) {
      const existingMember = await TeamMember.findOne({
        email,
        businessId: businessId,
        isDeleted: false,
      }).session(session);

      if (existingMember) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "A team member with this email already exists in your business",
          httpStatusCode.CONFLICT,
          res
        );
      }
    }

    const newTeamMember = await TeamMember.create(
      [
        {
          name,
          email,
          phoneNumber,
          countryCode,
          gender,
          birthday,
          businessId: businessId,
          userId: userId,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(
      res,
      "Team member created successfully",
      { teamMember: newTeamMember[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getAllTeamMembers = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const search = req.query.search as string;

    const business = await findUserBusiness(userId);
    const businessId = business ? business._id : null;

    let query: any = { isDeleted: false };

    if (businessId) {
      query.businessId = businessId;
    } else {
      query.userId = userId;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { specialization: { $regex: search, $options: "i" } },
      ];
    }

    const totalTeamMembers = await TeamMember.countDocuments(query);
    const teamMembers = await TeamMember.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(totalTeamMembers / limit);

    return successResponse(res, "Team members fetched successfully", {
      teamMembers,
      pagination: {
        totalTeamMembers,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: any) {
    console.error("Error fetching team members:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const getTeamMemberById = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    const { memberId } = req.params;

    if (!(await validateObjectId(memberId, "Team member", res))) return;

    const business = await findUserBusiness(userId);
    const businessId = business ? business._id : null;

    const query = buildTeamMemberQuery(
      memberId,
      userId,
      businessId as mongoose.Types.ObjectId | null
    );
    const teamMember = await TeamMember.findOne(query);

    if (!teamMember) {
      return errorResponseHandler(
        "Team member not found or you don't have permission to access it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    return successResponse(res, "Team member fetched successfully", {
      teamMember,
    });
  } catch (error: any) {
    console.error("Error fetching team member:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const updateTeamMember = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { memberId } = req.params;

    if (!(await validateObjectId(memberId, "Team member", res, session)))
      return;

    const business = await findUserBusiness(userId, session);
    const businessId = business ? business._id : null;

    const query = buildTeamMemberQuery(
      memberId,
      userId,
      businessId as mongoose.Types.ObjectId | null
    );
    const existingTeamMember = await TeamMember.findOne(query).session(session);

    if (!existingTeamMember) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Team member not found or you don't have permission to update it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    const {
      name,
      email,
      phoneNumber,
      countryCode,
      gender,
      birthday,
      profilePicture,
      role,
      specialization,
      services,
      employmentStatus,
      joinDate,
      permissions,
    } = req.body;

    if (email && email !== existingTeamMember.email) {
      if (!(await validateEmail(email, res, session))) return;

      if (
        businessId instanceof mongoose.Types.ObjectId &&
        (await checkDuplicateTeamMemberEmail(
          email,
          memberId,
          businessId,
          res,
          session
        ))
      ) {
        return;
      }
    }

    const updateData: any = {};

    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (countryCode !== undefined) updateData.countryCode = countryCode;
    if (gender !== undefined) updateData.gender = gender;
    if (birthday !== undefined) updateData.birthday = birthday;
    if (profilePicture !== undefined)
      updateData.profilePicture = profilePicture;
    if (role !== undefined) updateData.role = role;
    if (specialization !== undefined)
      updateData.specialization = specialization;
    if (employmentStatus !== undefined)
      updateData.employmentStatus = employmentStatus;
    if (joinDate !== undefined) updateData.joinDate = joinDate;

    if (services && Array.isArray(services) && services.length > 0) {
      const processedServices = await validateAndProcessServices(
        services,
        res,
        session
      );
      if (processedServices === null) return;
      updateData.services = processedServices;
    }

    if (permissions && typeof permissions === "object") {
      updateData.permissions = {
        ...existingTeamMember.permissions,
        ...permissions,
      };
    }
    const updatedTeamMember = await TeamMember.findByIdAndUpdate(
      memberId,
      { $set: updateData },
      { new: true, session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Team member updated successfully", {
      teamMember: updatedTeamMember,
    });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const deleteTeamMember = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { memberId } = req.params;

    if (!(await validateObjectId(memberId, "Team member", res, session)))
      return;

    const business = await findUserBusiness(userId, session);
    const businessId = business ? business._id : null;

    const query = buildTeamMemberQuery(
      memberId,
      userId,
      businessId as mongoose.Types.ObjectId | null
    );
    const existingTeamMember = await TeamMember.findOne(query).session(session);

    if (!existingTeamMember) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Team member not found or you don't have permission to delete it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    await TeamMember.findByIdAndUpdate(
      memberId,
      { $set: { isDeleted: true } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Team member deleted successfully");
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

// Clients functions
export const createClient = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const businessId = await validateBusinessForClient(userId, res, session);
    if (!businessId) return;

    const {
      name,
      email,
      phoneNumber,
      countryCode,
      profilePicture,
      birthday,
      gender,
      address,
      notes,
      tags,
      preferredServices,
      preferredTeamMembers,
    } = req.body;

    // Validate required fields
    if (!name || !email) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Name and email are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Validate email format
    if (!(await validateEmail(email, res, session))) return;

    // Check for duplicate email - pass empty string as clientId for new clients
    if (await checkDuplicateClientEmail("", email, businessId, res, session)) return;

    const newClient = await Client.create(
      [
        {
          name,
          email,
          phoneNumber: phoneNumber || "",
          countryCode: countryCode || "+91",
          profilePicture: profilePicture || "",
          birthday: birthday || null,
          gender: gender || "prefer_not_to_say",
          address: address || {
            street: "",
            city: "",
            state: "",
            country: "",
            postalCode: "",
          },
          notes: notes || "",
          tags: tags || [],
          businessId: businessId,
          preferredServices: preferredServices || [],
          preferredTeamMembers: preferredTeamMembers || [],
          lastVisit: null,
          isActive: true,
          isDeleted: false,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(
      res,
      "Client created successfully",
      { client: newClient[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getAllClients = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    const businessId = await validateBusinessForClient(userId, res);
    if (!businessId) return;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search as string;

    const query = buildClientSearchQuery(businessId, search);
    
    const totalClients = await Client.countDocuments(query);
    const clients = await Client.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(totalClients / limit);

    return successResponse(res, "Clients fetched successfully", {
      clients,
      pagination: {
        totalClients,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: any) {
    console.error("Error fetching clients:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const getClientById = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    const { clientId } = req.params;
    if (!(await validateObjectId(clientId, "Client", res))) return;

    const businessId = await validateBusinessForClient(userId, res);
    if (!businessId) return;

    const client = await validateClientAccess(clientId, businessId, res);
    if (!client) return;

    return successResponse(res, "Client fetched successfully", {
      client,
    });
  } catch (error: any) {
    console.error("Error fetching client:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const updateClientById = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { clientId } = req.params;
    if (!(await validateObjectId(clientId, "Client", res, session))) return;

    const businessId = await validateBusinessForClient(userId, res, session);
    if (!businessId) return;

    const existingClient = await validateClientAccess(clientId, businessId, res, session);
    if (!existingClient) return;

    const {
      name,
      email,
      phoneNumber,
      countryCode,
      profilePicture,
      birthday,
      gender,
      address,
      notes,
      tags,
      preferredServices,
      preferredTeamMembers,
      isActive,
    } = req.body;

    // If email is being changed, validate it and check for duplicate
    if (email && email !== existingClient.get('email')) {
      if (!(await validateEmail(email, res, session))) return;
      if (await checkDuplicateClientEmail(clientId, email, businessId, res, session)) return;
    }

    // Process preferred services if provided
    let processedServices = undefined;
    if (preferredServices && Array.isArray(preferredServices) && preferredServices.length > 0) {
      processedServices = await validateAndProcessServices(
        preferredServices,
        res,
        session
      );
      if (processedServices === null) return;
    }

    const updateData = processClientUpdateData(
      existingClient, 
      {
        name,
        email,
        phoneNumber,
        countryCode,
        profilePicture,
        birthday,
        gender,
        address,
        notes,
        tags,
        preferredTeamMembers,
        isActive
      },
      processedServices
    );

    const updatedClient = await Client.findByIdAndUpdate(
      clientId,
      { $set: updateData },
      { new: true, session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Client updated successfully", {
      client: updatedClient,
    });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const deleteClientById = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { clientId } = req.params;
    if (!(await validateObjectId(clientId, "Client", res, session))) return;

    const businessId = await validateBusinessForClient(userId, res, session);
    if (!businessId) return;

    const existingClient = await validateClientAccess(clientId, businessId, res, session);
    if (!existingClient) return;

    await Client.findByIdAndUpdate(
      clientId,
      { $set: { isDeleted: true } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Client deleted successfully");
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

// Category functions
export const createCategory = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    // Ensure user has a business profile
    const business = await findUserBusiness(userId, session);
    if (!business || !business._id) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "You need to create a business profile first",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const businessId = business._id;

    const { name, description } = req.body;
    
    if (!name) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Category name is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Check if category with same name already exists for this business
    const existingCategory = await Category.findOne({ 
      name: name.trim(), 
      businessId: businessId,
      isDeleted: false 
    }).session(session);
    
    if (existingCategory) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Category with this name already exists in your business",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const newCategory = await Category.create(
      [
        {
          name: name.trim(),
          description: description || "",
          businessId: businessId,
          isActive: true,
          isDeleted: false
        }
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(
      res,
      "Category created successfully",
      { category: newCategory[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getAllCategories = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    // Ensure user has a business profile
    const business = await findUserBusiness(userId);
    if (!business || !business._id) {
      return errorResponseHandler(
        "You need to create a business profile first",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const businessId = business._id;

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search as string;

    // Build query with business ID to ensure isolation
    let query: any = { 
      businessId: businessId,
      isDeleted: false 
    };

    // Add search functionality if search parameter is provided
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } }
      ];
    }

    // Get total count for pagination
    const totalCategories = await Category.countDocuments(query);
    
    // Get categories with pagination
    const categories = await Category.find(query)
      .sort({ name: 1 }) // Sort alphabetically by name
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(totalCategories / limit);

    return successResponse(res, "Categories fetched successfully", {
      categories,
      pagination: {
        totalCategories,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: any) {
    console.error("Error fetching categories:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

// Add a function to get a single category by ID
export const getCategoryById = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    // Ensure user has a business profile
    const business = await findUserBusiness(userId);
    if (!business || !business._id) {
      return errorResponseHandler(
        "You need to create a business profile first",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const businessId = business._id;
    const { categoryId } = req.params;

    if (!(await validateObjectId(categoryId, "Category", res))) return;

    // Find the category with business ID check to ensure isolation
    const category = await Category.findOne({
      _id: categoryId,
      businessId: businessId,
      isDeleted: false
    });

    if (!category) {
      return errorResponseHandler(
        "Category not found or you don't have permission to access it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    return successResponse(res, "Category fetched successfully", { category });
  } catch (error: any) {
    console.error("Error fetching category:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};
