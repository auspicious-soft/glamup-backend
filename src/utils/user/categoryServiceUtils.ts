import { Request, Response } from "express";
import mongoose from "mongoose";
import { httpStatusCode } from "../../lib/constant";
import { errorResponseHandler } from "../../lib/errors/error-response-handler";
import Category from "../../models/category/categorySchema";
import Service from "../../models/services/servicesSchema";
import TeamMember from "../../models/team/teamMemberSchema";
import Package from "../../models/package/packageSchema";
import RegisteredTeamMember from "../../models/registeredTeamMember/registeredTeamMemberSchema";
import { findUserBusiness, validateObjectId, validateUserAuth } from "./usercontrollerUtils";

/**
 * Gets business ID for a user, including team memberships
 */
export const getBusinessIdForUser = async (
  userId: string,
  session?: mongoose.ClientSession
): Promise<mongoose.Types.ObjectId | null> => {
  // First check if user owns a business
  const business = await findUserBusiness(userId, session);
  if (business && business._id) {
    return business._id as mongoose.Types.ObjectId;
  }
  
  // If not an owner, check if user is a team member
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
  
  return null;
};

/**
 * Validates business profile existence and returns business ID, with team member support
 */
export const validateBusinessProfile = async (
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
 * Validates category existence and ownership
 */
export const validateCategoryAccess = async (
  categoryId: string,
  businessId: mongoose.Types.ObjectId,
  res: Response,
  session?: mongoose.ClientSession
): Promise<mongoose.Document | null> => {
  if (!(await validateObjectId(categoryId, "Category", res, session))) return null;
  
  const category = session
    ? await Category.findOne({
        _id: categoryId,
        businessId: businessId,
        isDeleted: false
      }).session(session)
    : await Category.findOne({
        _id: categoryId,
        businessId: businessId,
        isDeleted: false
      });
  
  if (!category) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Category not found or you don't have permission to access it",
      httpStatusCode.NOT_FOUND,
      res
    );
    return null;
  }
  
  return category;
};

/**
 * Validates service existence and ownership
 */
export const validateServiceAccess = async (
  serviceId: string,
  businessId: mongoose.Types.ObjectId,
  res: Response,
  session?: mongoose.ClientSession
): Promise<mongoose.Document | null> => {
  if (!(await validateObjectId(serviceId, "Service", res, session))) return null;
  
  const service = session
    ? await Service.findOne({
        _id: serviceId,
        businessId: businessId,
        isDeleted: false
      }).session(session)
    : await Service.findOne({
        _id: serviceId,
        businessId: businessId,
        isDeleted: false
      });
  
  if (!service) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Service not found or you don't have permission to access it",
      httpStatusCode.NOT_FOUND,
      res
    );
    return null;
  }
  
  return service;
};

/**
 * Checks for duplicate category name
 */
export const checkDuplicateCategoryName = async (
  name: string,
  businessId: mongoose.Types.ObjectId,
  categoryId: string | null = null,
  res: Response,
  session?: mongoose.ClientSession
): Promise<boolean> => {
  const query: any = {
    name: name.trim(),
    businessId: businessId,
    isDeleted: false
  };
  
  // If categoryId is provided (for updates), exclude the current category
  if (categoryId) {
    query._id = { $ne: categoryId };
  }
  
  const duplicateCategory = session
    ? await Category.findOne(query).session(session)
    : await Category.findOne(query);
  
  if (duplicateCategory) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Category with this name already exists in your business",
      httpStatusCode.BAD_REQUEST,
      res
    );
    return true;
  }
  
  return false;
};

/**
 * Validates and processes team members for a service
 */
export const validateAndProcessTeamMembers = async (
  teamMembers: any[],
  businessId: mongoose.Types.ObjectId,
  res: Response,
  session?: mongoose.ClientSession
): Promise<any[] | null> => {
  if (!Array.isArray(teamMembers)) {
    return [];
  }
  
  if (teamMembers.length === 0) {
    return [];
  }
  
  const teamMemberIds = teamMembers.map(member => member.memberId);
  
  const existingTeamMembers = session
    ? await TeamMember.find({
        _id: { $in: teamMemberIds },
        businessId: businessId,
        isDeleted: false
      }).session(session)
    : await TeamMember.find({
        _id: { $in: teamMemberIds },
        businessId: businessId,
        isDeleted: false
      });
  
  if (existingTeamMembers.length !== teamMemberIds.length) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "One or more team members do not exist or don't belong to your business",
      httpStatusCode.BAD_REQUEST,
      res
    );
    return null;
  }
  
  return teamMembers.map(member => ({
    memberId: member.memberId,
    name: existingTeamMembers.find(m => m._id.toString() === member.memberId)?.name || ''
  }));
};

/**
 * Builds query for service search
 */
export const buildServiceSearchQuery = (
  businessId: mongoose.Types.ObjectId,
  search?: string,
  categoryId?: string,
  isGlobalOnly?: boolean
): any => {
  let query: any = { 
    businessId: businessId,
    isDeleted: false 
  };

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: 'i' } },
      { description: { $regex: search, $options: 'i' } },
      { categoryName: { $regex: search, $options: 'i' } },
      { tags: { $in: [new RegExp(search, 'i')] } }
    ];
  }
  
  if (categoryId) {
    query.categoryId = categoryId;
  }
  
  if (isGlobalOnly) {
    query.isGlobalCategory = true;
  }
  
  return query;
};

/**
 * Builds query for category search
 */
export const buildCategorySearchQuery = (
  businessId: mongoose.Types.ObjectId,
  search?: string
): any => {
  let query: any = { 
    businessId: businessId,
    isDeleted: false 
  };

  if (search) {
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { description: { $regex: search, $options: "i" } }
    ];
  }
  
  return query;
};

/**
 * Common function to validate user and get business ID, with team member support
 */
export const validateUserAndGetBusiness = async (
  req: Request,
  res: Response,
  session?: mongoose.ClientSession
): Promise<mongoose.Types.ObjectId | null> => {
  const userId = await validateUserAuth(req, res, session);
  if (!userId) return null;
  
  // Get user role from request
  const userRole = (req.user as any)?.businessRole || "";
  
  // If user is a team member, get the business ID from team membership
  if (userRole === "team-member") {
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
    
    errorResponseHandler(
      "You don't have access to any business",
      httpStatusCode.FORBIDDEN,
      res
    );
    return null;
  }
  
  // For business owners, use the existing function
  return await validateBusinessProfile(userId, res, session);
};

/**
 * Builds pagination parameters from request
 */
export const buildPaginationParams = (req: Request) => {
  const page = parseInt(req.query.page as string) || 1;
  const limit = parseInt(req.query.limit as string) || 10;
  const skip = (page - 1) * limit;
  
  return { page, limit, skip };
};

/**
 * Creates pagination metadata
 */
export const createPaginationMetadata = (totalItems: number, page: number, limit: number) => {
  const totalPages = Math.ceil(totalItems / limit);
  
  return {
    totalItems,
    totalPages,
    currentPage: page,
    limit,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

/**
 * Validates package access, with team member support
 */
export const validatePackageAccess = async (
  packageId: string,
  businessId: mongoose.Types.ObjectId,
  res: Response,
  session?: mongoose.ClientSession
): Promise<mongoose.Document | null> => {
  if (!(await validateObjectId(packageId, "Package", res, session))) return null;
  
  const packageItem = session
    ? await Package.findOne({
        _id: packageId,
        businessId: businessId,
        isDeleted: false
      }).session(session)
    : await Package.findOne({
        _id: packageId,
        businessId: businessId,
        isDeleted: false
      });
  
  if (!packageItem) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Package not found or you don't have permission to access it",
      httpStatusCode.NOT_FOUND,
      res
    );
    return null;
  }
  
  return packageItem;
};

/**
 * Validates package services, with team member support
 */
export const validatePackageServices = async (
  services: any[],
  categoryId: string,
  businessId: mongoose.Types.ObjectId,
  res: Response,
  session?: mongoose.ClientSession
): Promise<any[] | null> => {
  if (!services || !Array.isArray(services) || services.length === 0) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "At least one service must be selected for the package",
      httpStatusCode.BAD_REQUEST,
      res
    );
    return null;
  }

  const serviceIds = services.map(service => service.serviceId);
  
  // Validate all service IDs are valid ObjectIds
  for (const serviceId of serviceIds) {
    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      if (session) {
        await session.abortTransaction();
        session.endSession();
      }
      errorResponseHandler(
        `Invalid service ID format: ${serviceId}`,
        httpStatusCode.BAD_REQUEST,
        res
      );
      return null;
    }
  }
  
  // Find services that belong to the specified category and business
  const existingServices = session
    ? await Service.find({
        _id: { $in: serviceIds },
        categoryId: categoryId,
        businessId: businessId,
        isDeleted: false
      }).session(session)
    : await Service.find({
        _id: { $in: serviceIds },
        categoryId: categoryId,
        businessId: businessId,
        isDeleted: false
      });
  
  if (existingServices.length !== serviceIds.length) {
    // Find which service IDs are missing or invalid
    const foundServiceIds = existingServices.map(service => (service._id as mongoose.Types.ObjectId).toString());
    const missingServiceIds = serviceIds.filter(id => !foundServiceIds.includes(id));
    
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      `The following services were not found or don't belong to the specified category: ${missingServiceIds.join(', ')}`,
      httpStatusCode.BAD_REQUEST,
      res
    );
    return null;
  }
  
  // Process services with their details
  return services.map(service => {
    const existingService = existingServices.find(
      s => (s._id as mongoose.Types.ObjectId).toString() === service.serviceId
    );
    return {
      serviceId: service.serviceId,
      name: existingService?.name || '',
      duration: existingService?.duration || 0,
      price: existingService?.price || 0
    };
  });
};

/**
 * Calculates package pricing based on discount
 */
export const calculatePackagePricing = (
  price: number,
  discountPercentage?: number,
  discountAmount?: number
): { finalPrice: number, calculatedDiscountAmount: number, calculatedDiscountPercentage: number } => {
  let finalPrice = price;
  let calculatedDiscountAmount = 0;
  let calculatedDiscountPercentage = 0;

  if (discountPercentage && discountPercentage > 0) {
    calculatedDiscountPercentage = discountPercentage;
    calculatedDiscountAmount = (price * discountPercentage) / 100;
    finalPrice = price - calculatedDiscountAmount;
  } else if (discountAmount && discountAmount > 0) {
    calculatedDiscountAmount = discountAmount;
    calculatedDiscountPercentage = (discountAmount / price) * 100;
    finalPrice = price - discountAmount;
  }

  return {
    finalPrice,
    calculatedDiscountAmount,
    calculatedDiscountPercentage
  };
};

/**
 * Processes and validates tags
 */
export const processServiceTags = (tags: any[]): string[] => {
  if (!tags || !Array.isArray(tags)) {
    return [];
  }
  
  return tags
    .filter(tag => typeof tag === 'string' && tag.trim() !== '')
    .map(tag => tag.trim());
};







