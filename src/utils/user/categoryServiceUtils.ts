import { Request, Response } from "express";
import mongoose from "mongoose";
import { httpStatusCode } from "../../lib/constant";
import { errorResponseHandler } from "../../lib/errors/error-response-handler";
import Category from "../../models/category/categorySchema";
import Service from "../../models/services/servicesSchema";
import TeamMember from "../../models/team/teamMemberSchema";
import Package from "../../models/package/packageSchema";
import { findUserBusiness, validateObjectId, validateUserAuth } from "./usercontrollerUtils";

/**
 * Validates business profile existence and returns business ID
 */
export const validateBusinessProfile = async (
  userId: string,
  res: Response,
  session?: mongoose.ClientSession
): Promise<mongoose.Types.ObjectId | null> => {
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
 * Common function to validate user and get business ID
 */
export const validateUserAndGetBusiness = async (
  req: Request,
  res: Response,
  session?: mongoose.ClientSession
): Promise<mongoose.Types.ObjectId | null> => {
  const userId = await validateUserAuth(req, res, session);
  if (!userId) return null;
  
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
 * Validates package existence and ownership
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
 * Validates services for a package
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
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "One or more services do not exist, don't belong to the selected category, or don't belong to your business",
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





