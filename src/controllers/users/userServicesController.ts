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
  validateObjectId,
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
import UserBusinessProfile from "models/business/userBusinessProfileSchema";
// import UserBusinessProfile from "../../models/userBusinessProfile/userBusinessProfileSchema";
// import { validateObjectId } from "../../utils/user/userUtils";

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

    // Check if this is a global category
    const businessProfile = await UserBusinessProfile.findOne({
      _id: businessId,
      "selectedCategories.categoryId": categoryId,
      isDeleted: false
    }).session(session);
    
    let isGlobalCategory = false;
    let categoryName = "";
    
    if (businessProfile && businessProfile.selectedCategories.some(cat => cat.categoryId.toString() === categoryId)) {
      // This is a global category
      isGlobalCategory = true;
      const globalCategory = businessProfile.selectedCategories.find(
        cat => cat.categoryId.toString() === categoryId
      );
      categoryName = globalCategory ? globalCategory.name : "";
    } else {
      // This is a regular category, validate access
      const category = await validateCategoryAccess(categoryId, businessId, res, session);
      if (!category) return;
      categoryName = (category as any).name;
    }
        
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
          categoryName: categoryName,
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
          isGlobalCategory: isGlobalCategory, // Set based on category type
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
    const isGlobalOnly = req.query.isGlobalOnly === 'true';

    // Build base query
    let query: any = {
      businessId: businessId,
      isDeleted: false
    };
    
    // Add search conditions if provided
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
        { categoryName: { $regex: search, $options: 'i' } },
        { tags: { $in: [new RegExp(search, 'i')] } }
      ];
    }
    
    // Filter by category if provided
    if (categoryId) {
      query.categoryId = categoryId;
    }
    
    // Filter by global category flag if requested
    if (isGlobalOnly) {
      query.isGlobalCategory = true;
    }

    console.log("Service query:", JSON.stringify(query, null, 2));

    // First, check if there are any global category services
    const globalCategoryServices = await Service.find({
      businessId: businessId,
      isGlobalCategory: true,
      isDeleted: false
    });
    
    console.log("Global category services count:", globalCategoryServices.length);
    if (globalCategoryServices.length > 0) {
      console.log("Sample global service:", globalCategoryServices[0]);
    }

    const totalServices = await Service.countDocuments(query);
    
    const services = await Service.find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit);

    console.log("Total services found:", services.length);

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
    
    // Validate that the service ID is valid
    if (!(await validateObjectId(serviceId, "Service", res))) return;
    
    // Find the service that belongs to this business
    const service = await Service.findOne({
      _id: serviceId,
      businessId: businessId,
      isDeleted: false
    });
    
    if (!service) {
      return errorResponseHandler(
        "Service not found or you don't have permission to access it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

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
    
    // Handle category update differently for global category services
    if ((existingService as any).isGlobalCategory) {
      // For global category services, don't allow changing the category
      if (categoryId && categoryId !== (existingService as any).categoryId.toString()) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Cannot change the category of a service linked to a global category",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
    } else if (categoryId && categoryId !== (existingService as any).categoryId.toString()) {
      // For regular services, allow category change with validation
      const category = await validateCategoryAccess(categoryId, businessId, res, session);
      if (!category) return;
      
      updateData.categoryId = categoryId;
      updateData.categoryName = (category as any).name;
    }
    
    if (name) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description;
    if (duration !== undefined) updateData.duration = duration;
    if (priceType !== undefined) updateData.priceType = priceType;
    if (price !== undefined) updateData.price = price;
    if (maxPrice !== undefined) updateData.maxPrice = maxPrice;
    if (currency !== undefined) updateData.currency = currency;
    if (icon !== undefined) updateData.icon = icon;
    if (isActive !== undefined) updateData.isActive = isActive;
    
    // Process team members if provided
    if (teamMembers && Array.isArray(teamMembers)) {
      const processedTeamMembers = await validateAndProcessTeamMembers(
        teamMembers,
        businessId,
        res,
        session
      );
      if (!processedTeamMembers) return;
      updateData.teamMembers = processedTeamMembers;
    }
    
    // Process tags if provided
    if (tags !== undefined) {
      updateData.tags = processServiceTags(tags);
    }

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

    // Get regular categories
    const categories = await Category.find({ 
      businessId: businessId,
      isActive: true,
      isDeleted: false 
    }).sort({ name: 1 });

    // Get business profile to access global categories
    const businessProfile = await UserBusinessProfile.findOne({
      _id: businessId,
      isDeleted: false
    });

    // Get global categories
    const globalCategories = businessProfile?.selectedCategories || [];
    
    // Process regular categories with their services
    const regularCategoriesWithServices = await Promise.all(
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
          isGlobal: false,
          services: services
        };
      })
    );
    
    const globalCategoriesWithServices = await Promise.all(
      globalCategories.map(async (globalCat) => {
        const services = await Service.find({
          categoryId: globalCat.categoryId,
          businessId: businessId,
          isActive: true,
          isDeleted: false
        }).sort({ name: 1 });

        return {
          _id: globalCat.categoryId,
          name: globalCat.name,
          description: "",
          isGlobal: true,
          services: services
        };
      })
    );
    
    const allCategoriesWithServices = [
      ...regularCategoriesWithServices,
      ...globalCategoriesWithServices.filter(cat => cat.services.length > 0) // Only include global categories with services
    ];

    return successResponse(res, "Categories with services fetched successfully", {
      categoriesWithServices: allCategoriesWithServices
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

export const addServiceToGlobalCategory = async (req: Request, res: Response) => {
  const session = await startSession();
  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { categoryId } = req.params;
    
    if (!(await validateObjectId(categoryId, "Category", res, session))) return;
    
    const businessProfile = await UserBusinessProfile.findOne({
      _id: businessId,
      "selectedCategories.categoryId": categoryId,
      isDeleted: false
    }).session(session);
    
    if (!businessProfile) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "This global category is not associated with your business profile",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const globalCategory = businessProfile.selectedCategories.find(
      cat => cat.categoryId.toString() === categoryId
    );
    
    if (!globalCategory) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Global category not found in your business profile",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    const { 
      name, 
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
    
    if (!name) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Service name is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Process team members if provided
    let processedTeamMembers;
    if (teamMembers && Array.isArray(teamMembers) && teamMembers.length > 0) {
      processedTeamMembers = await validateAndProcessTeamMembers(
        teamMembers,
        businessId,
        res,
        session
      );
    }
    
    if (teamMembers && !processedTeamMembers) return;
    
    const processedTags = processServiceTags(tags || []);
    
    // Create the service with the global category ID and explicitly set isGlobalCategory to true
    const serviceData = {
      name: name.trim(),
      categoryId: categoryId,
      categoryName: globalCategory.name,
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
      isGlobalCategory: true, // Explicitly set to true
      isActive: true,
      isDeleted: false
    };
    
    console.log("Creating global category service with data:", JSON.stringify(serviceData, null, 2));
    
    const newService = await Service.create([serviceData], { session });
    
    // Double-check that isGlobalCategory was set correctly
    console.log("Created service:", JSON.stringify(newService[0], null, 2));
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Service added to global category successfully",
      { service: newService[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};



