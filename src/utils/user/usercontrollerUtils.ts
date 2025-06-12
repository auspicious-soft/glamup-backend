import { Request, Response } from "express";
import mongoose from "mongoose";
import { httpStatusCode } from "../../lib/constant";
import { errorResponseHandler } from "../../lib/errors/error-response-handler";
import UserBusinessProfile from "../../models/business/userBusinessProfileSchema";
import Service from "../../models/services/servicesSchema";
import { errorParser } from "../../lib/errors/error-response-handler";
import Category from "../../models/category/categorySchema";
import RegisteredTeamMember from "../../models/registeredTeamMember/registeredTeamMemberSchema";
/**
 * Extracts user ID from request object
 */
export const extractUserId = (req: Request): string | null => {
  if (typeof req.user === "string") {
    return req.user;
  } else if (req.user && typeof req.user === "object" && "id" in req.user) {
    return (req.user as any).id;
  }
  return null;
};

/**
 * Validates user authentication and returns user ID
 */
export const validateUserAuth = async (
  req: Request, 
  res: Response, 
  session?: mongoose.ClientSession
): Promise<string | null> => {
  const userId = extractUserId(req);
  
  if (!userId) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler("Invalid user authentication", httpStatusCode.UNAUTHORIZED, res);
    return null;
  }
  
  return userId;
};

/**
 * Finds business profile for a user
 */
export const findUserBusiness = async (
  userId: string, 
  session?: mongoose.ClientSession
): Promise<mongoose.Document | null> => {
  const query = { ownerId: userId, isDeleted: false };
  return session 
    ? UserBusinessProfile.findOne(query).session(session)
    : UserBusinessProfile.findOne(query);
};

/**
 * Validates MongoDB ObjectId
 */
export const validateObjectId = async (
  id: string, 
  fieldName: string, 
  res: Response, 
  session?: mongoose.ClientSession
): Promise<boolean> => {
  // Check if id is undefined or null

  if (!id) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(`${fieldName} ID is required`, httpStatusCode.BAD_REQUEST, res);
    return false;
  }
  
  // Check if id is a valid MongoDB ObjectId
  if (!mongoose.Types.ObjectId.isValid(id)) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(`Invalid ${fieldName} ID format`, httpStatusCode.BAD_REQUEST, res);
    return false;
  }
  
  return true;
};

/**
 * Builds query for team member operations
 */
export const buildTeamMemberQuery = (memberId: string, userId: string, businessId: mongoose.Types.ObjectId | null): any => {
  const query: any = { 
    _id: memberId,
    isDeleted: false
  };
  
  if (businessId) {
    query.businessId = businessId;
  } else {
    query.userId = userId;
  }
  
  return query;
};

/**
 * Validates email format
 */
export const validateEmail = async (
  email: string, 
  res: Response, 
  session?: mongoose.ClientSession
): Promise<boolean> => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler("Invalid email format", httpStatusCode.BAD_REQUEST, res);
    return false;
  }
  return true;
};

/**
 * Validates services and returns processed service objects
 */
export const validateAndProcessServices = async (
  services: any[], 
  res: Response, 
  session?: mongoose.ClientSession
): Promise<any[] | null> => {
  if (!Array.isArray(services) || services.length === 0) {
    return [];
  }
  
  const serviceIds = services.map(service => service.serviceId);
  
  const existingServices = session 
    ? await Service.find({ _id: { $in: serviceIds }, isActive: true }).session(session)
    : await Service.find({ _id: { $in: serviceIds }, isActive: true });

  type ServiceDoc = { _id: mongoose.Types.ObjectId; name: string; };

  if (existingServices.length !== serviceIds.length) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler("One or more selected services do not exist", httpStatusCode.BAD_REQUEST, res);
    return null;
  }
  
  return services.map(service => ({
    serviceId: service.serviceId,
    name: (existingServices as ServiceDoc[]).find(s => s._id.toString() === service.serviceId)?.name || '',
    isActive: service.isActive !== undefined ? service.isActive : true
  }));
};

/**
 * Starts a MongoDB session and transaction
 */
export const startSession = async (): Promise<mongoose.ClientSession> => {
  const session = await mongoose.startSession();
  session.startTransaction();
  return session;
};

/**
 * Handles transaction errors
 */
export const handleTransactionError = async (
  session: mongoose.ClientSession, 
  error: any, 
  res: Response
): Promise<Response> => {
  try {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
    }
  } catch (abortError) {
    console.error("Error aborting transaction:", abortError);
  }
  
  if (session) {
    session.endSession();
  }
  
  console.error("Transaction error:", error);
  const parsedError = errorParser(error);
  return res.status(parsedError.code).json({
    success: false,
    message: parsedError.message,
  });
};

/**
 * Checks for duplicate email in team members
 */
export const checkDuplicateTeamMemberEmail = async (
  email: string,
  memberId: string,
  businessId: mongoose.Types.ObjectId,
  res: Response,
  session?: mongoose.ClientSession
): Promise<boolean> => {
  const TeamMember = mongoose.model('TeamMember');
  
  const duplicateEmail = session
    ? await TeamMember.findOne({
        _id: { $ne: memberId },
        email,
        businessId,
        isDeleted: false
      }).session(session)
    : await TeamMember.findOne({
        _id: { $ne: memberId },
        email,
        businessId,
        isDeleted: false
      });
  
  if (duplicateEmail) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Another team member with this email already exists in your business",
      httpStatusCode.CONFLICT,
      res
    );
    return true;
  }
  
  return false;
};

/**
 * Validates client existence and ownership
 */
export const validateClientAccess = async (
  clientId: string,
  businessId: mongoose.Types.ObjectId,
  res: Response,
  session?: mongoose.ClientSession
): Promise<mongoose.Document | null> => {
  const Client = mongoose.model('Client');
  
  const client = session
    ? await Client.findOne({
        _id: clientId,
        businessId: businessId,
        isDeleted: false
      }).session(session)
    : await Client.findOne({
        _id: clientId,
        businessId: businessId,
        isDeleted: false
      });
  
  if (!client) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Client not found or you don't have permission to access it",
      httpStatusCode.NOT_FOUND,
      res
    );
    return null;
  }
  
  return client;
};

/**
 * Checks for duplicate client email
 */
export const checkDuplicateClientEmail = async (
  clientId: string,
  email: string,
  businessId: mongoose.Types.ObjectId,
  res: Response,
  session?: mongoose.ClientSession
): Promise<boolean> => {
  const Client = mongoose.model('Client');
  
  // Create a query to find clients with the same email in the same business
  const query: any = {
    email: email,
    businessId: businessId,
    isDeleted: false
  };
  
  // If clientId is provided (for updates), exclude the current client
  if (clientId) {
    query._id = { $ne: clientId };
  }
  
  const duplicateEmail = session
    ? await Client.findOne(query).session(session)
    : await Client.findOne(query);
  
  if (duplicateEmail) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Another client with this email already exists in your business",
      httpStatusCode.CONFLICT,
      res
    );
    return true;
  }
  
  return false;
};

/**
 * Validates business existence for client operations
 */
export const validateBusinessForClient = async (
  userId: string,
  res: Response,
  session?: mongoose.ClientSession
): Promise<mongoose.Types.ObjectId | null> => {
  // Get user from database to check role
  const user = session
    ? await mongoose.model('User').findById(userId).session(session)
    : await mongoose.model('User').findById(userId);
  
  if (!user) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "User not found",
      httpStatusCode.NOT_FOUND,
      res
    );
    return null;
  }
  
  // If user is a team member, get the business ID from team membership
  if (user.businessRole === "team-member") {
    const teamMembership = session
      ? await RegisteredTeamMember.findOne({
          userId: userId,
          isDeleted: false,
          isActive: true
        }).session(session)
      : await RegisteredTeamMember.findOne({
          userId: userId,
          isDeleted: false,
          isActive: true
        });
    
    if (teamMembership && teamMembership.businessId) {
      return teamMembership.businessId as mongoose.Types.ObjectId;
    }
    
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "You don't have access to any business",
      httpStatusCode.FORBIDDEN,
      res
    );
    return null;
  }
  
  // For business owners, use the existing logic
  const business = await findUserBusiness(userId, session);
  if (!business || !business._id) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "You need to create a business profile first",
      httpStatusCode.BAD_REQUEST,
      res
    );
    return null;
  }
  return business._id as mongoose.Types.ObjectId;
};

/**
 * Builds query for client search
 */
export const buildClientSearchQuery = (
  businessId: mongoose.Types.ObjectId,
  search?: string
): any => {
  const query: any = {
    businessId: businessId,
    isDeleted: false
  };
  
  if (search) {
    const searchRegex = new RegExp(search, 'i');
    query.$or = [
      { name: searchRegex },
      { email: searchRegex },
      { phoneNumber: searchRegex },
      { 'address.city': searchRegex },
      { tags: searchRegex }
    ];
  }
  
  return query;
};

/**
 * Processes client update data
 */
export const processClientUpdateData = (
  existingClient: any,
  updateFields: any,
  processedServices?: any[]
): any => {
  const updateData: any = {};
  
  // Basic fields
  const basicFields = [
    'name', 'email', 'phoneNumber', 'countryCode', 
    'profilePicture', 'birthday', 'gender', 'notes', 'isActive', 'countryCallingCode'
  ];
  
  basicFields.forEach(field => {
    if (updateFields[field] !== undefined) {
      updateData[field] = updateFields[field];
    }
  });
  
  // Process preferred services if provided
  if (processedServices) {
    updateData.preferredServices = processedServices;
  }
  
  // Process preferred team members if provided
  if (updateFields.preferredTeamMembers) {
    updateData.preferredTeamMembers = updateFields.preferredTeamMembers;
  }
  
  // Update address if provided
  if (updateFields.address && typeof updateFields.address === 'object') {
    updateData.address = {
      ...existingClient.address,
      ...updateFields.address,
    };
  }
  
  // Update tags if provided
  if (updateFields.tags && Array.isArray(updateFields.tags)) {
    updateData.tags = updateFields.tags;
  }
  
  return updateData;
};

/**
 * Validates and processes categories for a business profile
 */
export const validateAndProcessCategories = async (
  categories: Array<{ categoryId: string; isActive?: boolean }>,
  res: Response,
  session?: mongoose.ClientSession
): Promise<any[] | null> => {
  const categoryIds = categories.map(category => category.categoryId);
  
  const existingCategories = session
    ? await Category.find({ _id: { $in: categoryIds } }).session(session)
    : await Category.find({ _id: { $in: categoryIds } });

  type CategoryDoc = { _id: mongoose.Types.ObjectId; name: string; };

  if (existingCategories.length !== categoryIds.length) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler("One or more selected categories do not exist", httpStatusCode.BAD_REQUEST, res);
    return null;
  }
  
  return categories.map(category => ({
    categoryId: category.categoryId,
    name: (existingCategories as CategoryDoc[]).find(c => c._id.toString() === category.categoryId)?.name || '',
    isActive: category.isActive !== undefined ? category.isActive : true
  }));
};

/**
 * Finds business associated with user, including team memberships
 */
export const findUserBusinessWithTeamAccess = async (
  userId: string,
  session?: mongoose.ClientSession
): Promise<any> => {
  // First check if user owns a business
  const ownedBusiness = session
    ? await UserBusinessProfile.findOne({
        ownerId: userId,
        isDeleted: false,
        status: "active"
      }).session(session)
    : await UserBusinessProfile.findOne({
        ownerId: userId,
        isDeleted: false,
        status: "active"
      });
  
  if (ownedBusiness) {
    return ownedBusiness;
  }
  
  // If not an owner, check if user is a team member
  const teamMembership = session
    ? await RegisteredTeamMember.findOne({
        userId: userId,
        isDeleted: false,
        isActive: true
      }).session(session).populate('businessId')
    : await RegisteredTeamMember.findOne({
        userId: userId,
        isDeleted: false,
        isActive: true
      }).populate('businessId');
  
  if (teamMembership && teamMembership.businessId) {
    return teamMembership.businessId;
  }
  
  return null;
};

/**
 * Gets business ID for team member operations, supporting team member access
 */
export const getBusinessIdForTeamMember = async (
  userId: string,
  res: Response,
  session?: mongoose.ClientSession
): Promise<mongoose.Types.ObjectId | null> => {
  // Get user from database to check role
  const user = session
    ? await mongoose.model('User').findById(userId).session(session)
    : await mongoose.model('User').findById(userId);
  
  if (!user) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "User not found",
      httpStatusCode.NOT_FOUND,
      res
    );
    return null;
  }
  
  // If user is a team member, get the business ID from team membership
  if (user.businessRole === "team-member") {
    const teamMembership = session
      ? await RegisteredTeamMember.findOne({
          userId: userId,
          isDeleted: false,
          isActive: true
        }).session(session)
      : await RegisteredTeamMember.findOne({
          userId: userId,
          isDeleted: false,
          isActive: true
        });
    
    if (teamMembership && teamMembership.businessId) {
      return teamMembership.businessId as mongoose.Types.ObjectId;
    }
    
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "You don't have access to any business",
      httpStatusCode.FORBIDDEN,
      res
    );
    return null;
  }
  
  // For business owners, use the existing logic
  const business = await findUserBusiness(userId, session);
  if (!business || !business._id) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "You need to create a business profile first",
      httpStatusCode.BAD_REQUEST,
      res
    );
    return null;
  }
  return business._id as mongoose.Types.ObjectId;
};

/**
 * Builds query for team member search, with team member access support
 */
export const buildTeamMemberSearchQuery = (
  businessId: mongoose.Types.ObjectId,
  search?: string
): any => {
  const query: any = {
    businessId: businessId,
    isDeleted: false
  };
  
  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { phoneNumber: { $regex: search, $options: "i" } },
      { specialization: { $regex: search, $options: "i" } },
    ];
  }
  
  return query;
};

/**
 * Validates business profile access for both owners and team members
 */
export const validateBusinessProfileAccess = async (
  userId: string,
  profileId: string,
  res: Response,
  session?: mongoose.ClientSession
): Promise<mongoose.Document | null> => {
  // Get user to check role
  const user = session
    ? await mongoose.model('User').findById(userId).session(session)
    : await mongoose.model('User').findById(userId);
  
  if (!user) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "User not found",
      httpStatusCode.NOT_FOUND,
      res
    );
    return null;
  }
  
  // Validate profileId is a valid ObjectId
  if (!mongoose.Types.ObjectId.isValid(profileId)) {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Invalid business profile ID format",
      httpStatusCode.BAD_REQUEST,
      res
    );
    return null;
  }
  
  // Check if user is a business owner
  if (user.businessRole === "owner") {
    // For owners, only allow access to their own business
    const businessProfile = session
      ? await UserBusinessProfile.findOne({
          _id: profileId,
          ownerId: userId,
          isDeleted: false,
          status: "active",
        }).session(session)
      : await UserBusinessProfile.findOne({
          _id: profileId,
          ownerId: userId,
          isDeleted: false,
          status: "active",
        });
    
    if (!businessProfile) {
      if (session && session.inTransaction()) {
        await session.abortTransaction();
        session.endSession();
      }
      errorResponseHandler(
        "Business profile not found or you don't have permission to access it",
        httpStatusCode.NOT_FOUND,
        res
      );
      return null;
    }
    
    return businessProfile;
  } 
  // Check if user is a team member
  else if (user.businessRole === "team-member") {
    // For team members, check if they belong to this business
    const teamMembership = session
      ? await RegisteredTeamMember.findOne({
          userId: userId,
          businessId: profileId,
          isDeleted: false,
          isActive: true
        }).session(session)
      : await RegisteredTeamMember.findOne({
          userId: userId,
          businessId: profileId,
          isDeleted: false,
          isActive: true
        });
    
    if (!teamMembership) {
      if (session && session.inTransaction()) {
        await session.abortTransaction();
        session.endSession();
      }
      errorResponseHandler(
        "You don't have access to this business profile",
        httpStatusCode.FORBIDDEN,
        res
      );
      return null;
    }
    
    // Team member has access to this business, fetch the profile
    const businessProfile = session
      ? await UserBusinessProfile.findOne({
          _id: profileId,
          isDeleted: false,
          status: "active",
        }).session(session)
      : await UserBusinessProfile.findOne({
          _id: profileId,
          isDeleted: false,
          status: "active",
        });
    
    if (!businessProfile) {
      if (session && session.inTransaction()) {
        await session.abortTransaction();
        session.endSession();
      }
      errorResponseHandler(
        "Business profile not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
      return null;
    }
    
    return businessProfile;
  }
  // User is neither an owner nor a team member
  else {
    if (session && session.inTransaction()) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "You don't have permission to access business profiles",
      httpStatusCode.FORBIDDEN,
      res
    );
    return null;
  }
};
