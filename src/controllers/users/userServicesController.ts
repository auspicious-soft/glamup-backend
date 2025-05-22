import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import { successResponse } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import Service from "../../models/services/servicesSchema";
import {
  startSession,
  handleTransactionError,
} from "../../utils/user/usercontrollerUtils";
import Category from "models/category/categorySchema";
import {
  validateUserAndGetBusiness,
  validateCategoryAccess,
  validateServiceAccess,
    validateAndProcessTeamMembers,
  buildServiceSearchQuery,
  buildPaginationParams,
  createPaginationMetadata,
  processServiceTags
} from "../../utils/user/categoryServiceUtils";


// Service functions
export const createService = async (req: Request, res: Response) => {
  const session = await startSession();
  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { 
      name, 
      categoryId, 
      description, 
      duration, 
      priceType, 
      price, 
      maxPrice, 
      currency,
      teamMembers,
      icon,
      tags
    } = req.body;
    if (!name || !categoryId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Service name and category ID are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const category = await validateCategoryAccess(categoryId, businessId, res, session);
    if (!category) return;
        
    const processedTeamMembers = await validateAndProcessTeamMembers(
      teamMembers || [],
      businessId,
      res,
      session
    );
    
    if (teamMembers && !processedTeamMembers) return;

    const processedTags = processServiceTags(tags || []);

    const newService = await Service.create(
      [
        {
          name: name.trim(),
          categoryId: categoryId,
          categoryName: (category as any).name,
          description: description || "",
          duration: duration || 30,
          priceType: priceType || "fixed",
          price: price || 0,
          maxPrice: maxPrice || null,
          currency: currency || "INR",
          businessId: businessId,
          teamMembers: processedTeamMembers || [],
          icon: icon || "",
          tags: processedTags,
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
      "Service created successfully",
      { service: newService[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getAllServices = async (req: Request, res: Response) => {
  try {
    const businessId = await validateUserAndGetBusiness(req, res);
    if (!businessId) return;

    const { page, limit, skip } = buildPaginationParams(req);
    const search = req.query.search as string;
    const categoryId = req.query.categoryId as string;

    const query = buildServiceSearchQuery(businessId, search, categoryId);

    const totalServices = await Service.countDocuments(query);
    
    const services = await Service.find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit);

    const pagination = createPaginationMetadata(totalServices, page, limit);

    return successResponse(res, "Services fetched successfully", {
      services,
      pagination
    });
  } catch (error: any) {
    console.error("Error fetching services:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const getServiceById = async (req: Request, res: Response) => {
  try {
    const businessId = await validateUserAndGetBusiness(req, res);
    if (!businessId) return;

    const { serviceId } = req.params;
    
    const service = await validateServiceAccess(serviceId, businessId, res);
    if (!service) return;

    return successResponse(res, "Service fetched successfully", { service });
  } catch (error: any) {
    console.error("Error fetching service:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const updateService = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { serviceId } = req.params;
    
    const existingService = await validateServiceAccess(serviceId, businessId, res, session);
    if (!existingService) return;

    const { 
      name, 
      categoryId, 
      description, 
      duration, 
      priceType, 
      price, 
      maxPrice, 
      currency,
      teamMembers,
      icon,
      isActive,
      tags
    } = req.body;

    const updateData: any = {};
    
    let categoryName = (existingService as any).categoryName;
    if (categoryId && categoryId !== (existingService as any).categoryId.toString()) {
      const category = await validateCategoryAccess(categoryId, businessId, res, session);
      if (!category) return;
      
      updateData.categoryId = categoryId;
      updateData.categoryName = (category as any).name;
    }
    
    if (teamMembers !== undefined) {
      const processedTeamMembers = await validateAndProcessTeamMembers(
        teamMembers || [],
        businessId,
        res,
        session
      );
      
      if (teamMembers && !processedTeamMembers) return;
      updateData.teamMembers = processedTeamMembers || [];
    }

    if (tags !== undefined) {
      updateData.tags = processServiceTags(tags);
    }

    if (description !== undefined) updateData.description = description;
    if (duration !== undefined) updateData.duration = duration;
    if (priceType !== undefined) updateData.priceType = priceType;
    if (price !== undefined) updateData.price = price;
    if (maxPrice !== undefined) updateData.maxPrice = maxPrice;
    if (currency !== undefined) updateData.currency = currency;
    if (icon !== undefined) updateData.icon = icon;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updatedService = await Service.findByIdAndUpdate(
      serviceId,
      { $set: updateData },
      { new: true, session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Service updated successfully", { service: updatedService });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const deleteService = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { serviceId } = req.params;
    
    const existingService = await validateServiceAccess(serviceId, businessId, res, session);
    if (!existingService) return;

    await Service.findByIdAndUpdate(
      serviceId,
      { $set: { isDeleted: true } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Service deleted successfully");
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getCategoriesWithServices = async (req: Request, res: Response) => {
  try {
    const businessId = await validateUserAndGetBusiness(req, res);
    if (!businessId) return;

    const categories = await Category.find({ 
      businessId: businessId,
      isActive: true,
      isDeleted: false 
    }).sort({ name: 1 });

    const categoriesWithServices = await Promise.all(
      categories.map(async (category) => {
        const services = await Service.find({
          categoryId: category._id,
          businessId: businessId,
          isActive: true,
          isDeleted: false
        }).sort({ name: 1 });

        return {
          _id: category._id,
          name: category.name,
          description: category.description,
          services: services
        };
      })
    );

    return successResponse(res, "Categories with services fetched successfully", {
      categoriesWithServices
    });
  } catch (error: any) {
    console.error("Error fetching categories with services:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

