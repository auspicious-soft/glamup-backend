import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import { successResponse } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import Service from "../../models/services/servicesSchema";
import mongoose from "mongoose";
import {
  validateObjectId,
  startSession,
  handleTransactionError,
  validateUserAuth,
} from "../../utils/user/usercontrollerUtils";
import Package from "../../models/package/packageSchema";
import {
  validateUserAndGetBusiness,
  validateCategoryAccess,
  buildPaginationParams,
  createPaginationMetadata,
  validatePackageAccess,
  validatePackageServices
} from "../../utils/user/categoryServiceUtils";
import UserBusinessProfile from "../../models/business/userBusinessProfileSchema";
import User from "../../models/user/userSchema";
import RegisteredTeamMember from "../../models/registeredTeamMember/registeredTeamMemberSchema";

// Define the type for services used in packages
interface ServiceForPackage {
  serviceId: string;
  name: string;
  duration: number;
  price: number;
}

// Package functions
export const createPackage = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { 
      name, 
      categoryId, 
      description, 
      services, 
      duration, 
      priceType, 
      price, 
      maxPrice, 
      discountPercentage,
      discountAmount,
      currency
    } = req.body;
    
    if (!name || !categoryId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Package name and category ID are required",
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
      // This is a global category that the business has selected
      isGlobalCategory = true;
      const globalCategory = businessProfile.selectedCategories.find(
        cat => cat.categoryId.toString() === categoryId
      );
      
      if (!globalCategory?.isActive) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "This global category is inactive in your business profile",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
      categoryName = globalCategory ? globalCategory.name : "";
    } else {
      // This is a regular category
      const category = await validateCategoryAccess(categoryId, businessId, res, session);
      if (!category) return;
      categoryName = (category as any).name;
    }

    if (!services || !Array.isArray(services) || services.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "At least one service must be selected for the package",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const serviceIds = services.map(service => service.serviceId);
    
    // Find services and check if they belong to the specified category and business
    const existingServices = await Service.find({
      _id: { $in: serviceIds },
      categoryId: categoryId,
      businessId: businessId,
      isDeleted: false
    }).session(session);
    
    if (existingServices.length !== serviceIds.length) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "One or more services don't belong to the selected category, or don't belong to your business",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Check if all services are active
    const inactiveServices = existingServices.filter((service: any) => !service.isActive);
    if (inactiveServices.length > 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        `The following services are inactive: ${inactiveServices.map((s: any) => s.name).join(', ')}`,
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // For global category, check if all services have isGlobalCategory set to true
    if (isGlobalCategory) {
      const nonGlobalServices = existingServices.filter((service: any) => !service.isGlobalCategory);
      if (nonGlobalServices.length > 0) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          `The following services do not belong to the global category: ${nonGlobalServices.map((s: any) => s.name).join(', ')}`,
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
    }

    const processedServices = existingServices.map((service: any) => ({
      serviceId: service._id,
      name: service.name,
      duration: service.duration,
      price: service.price
    }));

    // Calculate total price based on services
    const totalServicesPrice = processedServices.reduce((sum, service) => sum + service.price, 0);
    
    // Use provided price or calculate from services
    const packagePrice = price !== undefined ? price : totalServicesPrice;
    
    // Validate price type
    if (priceType && !['Fixed price', 'Hourly rate', 'range', ''].includes(priceType)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Price type must be one of: Fixed price, Hourly rate, range",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Validate max price for range price type
    if (priceType === 'range' && (!maxPrice || maxPrice <= packagePrice)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "For range price type, max price must be provided and greater than the min price",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Calculate discount and final price
    let finalPrice = packagePrice;
    let calculatedDiscountAmount = 0;
    let calculatedDiscountPercentage = 0;
    
    if (discountPercentage) {
      if (discountPercentage > 100) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Discount percentage cannot exceed 100%",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
      calculatedDiscountPercentage = discountPercentage;
      calculatedDiscountAmount = (packagePrice * discountPercentage) / 100;
      finalPrice = packagePrice - calculatedDiscountAmount;
    } else if (discountAmount) {
      if (discountAmount >= packagePrice) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Discount amount cannot be greater than or equal to the price",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
      calculatedDiscountAmount = discountAmount;
      calculatedDiscountPercentage = (discountAmount / packagePrice) * 100;
      finalPrice = packagePrice - discountAmount;
    }

    const newPackage = await Package.create(
      [
        {
          name: name.trim(),
          categoryId: categoryId,
          categoryName: categoryName,
          description: description || "",
          services: processedServices,
          duration: duration || processedServices.reduce((sum, service) => sum + service.duration, 0),
          priceType: priceType || "Fixed price",
          price: packagePrice,
          maxPrice: priceType === 'range' ? maxPrice : null,
          discountPercentage: calculatedDiscountPercentage,
          discountAmount: calculatedDiscountAmount,
          finalPrice: finalPrice,
          currency: currency || "INR",
          businessId: businessId,
          isGlobalCategory: isGlobalCategory,
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
      "Package created successfully",
      { package: newPackage[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getAllPackages = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    // Get user to check role
    const user = await User.findById(userId);
    if (!user) {
      return errorResponseHandler(
        "User not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    let businessId;

    // If user is a team member, get business ID from team membership
    if (user.businessRole === "team-member") {
      const teamMembership = await RegisteredTeamMember.findOne({
        userId: userId,
        isDeleted: false,
        isActive: true
      });
      
      if (!teamMembership) {
        return errorResponseHandler(
          "You don't have access to any business",
          httpStatusCode.FORBIDDEN,
          res
        );
      }
      
      businessId = teamMembership.businessId;
    } else {
      // For business owners, use the existing function
      businessId = await validateUserAndGetBusiness(req, res);
      if (!businessId) return;
    }

    const { page, limit, skip } = buildPaginationParams(req);
    const search = req.query.search as string;
    const categoryId = req.query.categoryId as string;

    let query: any = { 
      businessId: businessId,
      isDeleted: false 
    };

    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
      query.categoryId = categoryId;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { categoryName: { $regex: search, $options: "i" } }
      ];
    }

    const totalPackages = await Package.countDocuments(query);
    const packages = await Package.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const paginationMeta = createPaginationMetadata(page, limit, totalPackages);

    return successResponse(res, "Packages fetched successfully", {
      packages,
      pagination: paginationMeta
    });
  } catch (error: any) {
    console.error("Error fetching packages:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const getPackageById = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    // Get user to check role
    const user = await User.findById(userId);
    if (!user) {
      return errorResponseHandler(
        "User not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    let businessId;

    // If user is a team member, get business ID from team membership
    if (user.businessRole === "team-member") {
      const teamMembership = await RegisteredTeamMember.findOne({
        userId: userId,
        isDeleted: false,
        isActive: true
      });
      
      if (!teamMembership) {
        return errorResponseHandler(
          "You don't have access to any business",
          httpStatusCode.FORBIDDEN,
          res
        );
      }
      
      businessId = teamMembership.businessId;
    } else {
      // For business owners, use the existing function
      businessId = await validateUserAndGetBusiness(req, res);
      if (!businessId) return;
    }

    const { packageId } = req.params;
    
    if (!(await validateObjectId(packageId, "Package", res))) return;
    
    const packageItem = await Package.findOne({
      _id: packageId,
      businessId: businessId,
      isDeleted: false
    });
    
    if (!packageItem) {
      return errorResponseHandler(
        "Package not found or you don't have permission to access it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    return successResponse(res, "Package fetched successfully", { package: packageItem });
  } catch (error: any) {
    console.error("Error fetching package:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

// Update package by ID
export const updatePackage = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { packageId } = req.params;
    
    // Validate package exists and belongs to this business
    const existingPackage = await validatePackageAccess(packageId, businessId, res, session);
    if (!existingPackage) return;

    const { 
      name, 
      categoryId, 
      description, 
      services, 
      duration, 
      priceType, 
      price, 
      maxPrice, 
      discountPercentage,
      discountAmount,
      currency,
      isActive
    } = req.body;
    
    // Create update object
    const updateData: any = {};
    
    // Update name if provided
    if (name) {
      updateData.name = name.trim();
    }
    
    // Check if the existing package is for a global category
    const isExistingGlobalCategory = (existingPackage as any).isGlobalCategory;
    
    // Update category if provided
    if (categoryId && categoryId !== (existingPackage as any).categoryId.toString()) {
      // If the existing package is for a global category, don't allow changing to a different category
      if (isExistingGlobalCategory) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Cannot change the category of a package linked to a global category",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
      // Check if the new category is a global category
      const businessProfile = await UserBusinessProfile.findOne({
        _id: businessId,
        "selectedCategories.categoryId": categoryId,
        isDeleted: false
      }).session(session);
      
      let isGlobalCategory = false;
      let categoryName = "";
      
      if (businessProfile && businessProfile.selectedCategories.some(cat => cat.categoryId.toString() === categoryId)) {
        // This is a global category that the business has selected
        isGlobalCategory = true;
        const globalCategory = businessProfile.selectedCategories.find(
          cat => cat.categoryId.toString() === categoryId
        );
        
        if (!globalCategory?.isActive) {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            "This global category is inactive in your business profile",
            httpStatusCode.BAD_REQUEST,
            res
          );
        }
        
        categoryName = globalCategory ? globalCategory.name : "";
      } else {
        // This is a regular category
        const category = await validateCategoryAccess(categoryId, businessId, res, session);
        if (!category) return;
        categoryName = (category as any).name;
      }
      
      updateData.categoryId = categoryId;
      updateData.categoryName = categoryName;
      updateData.isGlobalCategory = isGlobalCategory;
    }
    
    // Update description if provided
    if (description !== undefined) {
      updateData.description = description;
    }
    
    // Update services if provided
    if (services && Array.isArray(services)) {
      // Get the category ID to use for validation
      const categoryIdToUse = categoryId || (existingPackage as any).categoryId;
      const isGlobalCategoryToUse = updateData.isGlobalCategory !== undefined ? 
        updateData.isGlobalCategory : isExistingGlobalCategory;
      
      const serviceIds = services.map(service => service.serviceId);
      
      // Find services and check if they belong to the specified category and business
      const existingServices = await Service.find({
        _id: { $in: serviceIds },
        categoryId: categoryIdToUse,
        businessId: businessId,
        isDeleted: false
      }).session(session);
      
      if (existingServices.length !== serviceIds.length) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "One or more services do not exist, don't belong to the selected category, or don't belong to your business",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
      // Check if all services are active
      const inactiveServices = existingServices.filter((service: any) => !service.isActive);
      if (inactiveServices.length > 0) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          `The following services are inactive: ${inactiveServices.map((s: any) => s.name).join(', ')}`,
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
      // For global category, check if all services have isGlobalCategory set to true
      if (isGlobalCategoryToUse) {
        const nonGlobalServices = existingServices.filter((service: any) => !service.isGlobalCategory);
        if (nonGlobalServices.length > 0) {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            `The following services do not belong to the global category: ${nonGlobalServices.map((s: any) => s.name).join(', ')}`,
            httpStatusCode.BAD_REQUEST,
            res
          );
        }
      }
      
      const processedServices = existingServices.map((service: any) => ({
        serviceId: service._id,
        name: service.name,
        duration: service.duration,
        price: service.price
      }));
      
      updateData.services = processedServices;
    }
    
    // Update duration if provided
    if (duration !== undefined) {
      updateData.duration = duration;
    } else if (services && Array.isArray(services) && updateData.services) {
      // Recalculate duration based on services if not explicitly provided
      updateData.duration = (updateData.services as ServiceForPackage[]).reduce(
        (sum: number, service: ServiceForPackage) => sum + service.duration,
        0
      );
    }
    
    // Update price type if provided
    if (priceType !== undefined) {
      if (!['Fixed price', 'Hourly rate', 'range', ''].includes(priceType)) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Price type must be one of: Fixed price, Hourly rate, range",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      updateData.priceType = priceType;
    }
    
    // Update price if provided
    if (price !== undefined) {
      if (price < 0) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Package price must be a non-negative number",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      updateData.price = price;
    } else if (services && Array.isArray(services) && updateData.services) {
      // Recalculate price based on services if not explicitly provided
      const totalServicesPrice = (updateData.services as ServiceForPackage[]).reduce(
        (sum: number, service: ServiceForPackage) => sum + service.price, 
        0
      );
      updateData.price = totalServicesPrice;
    }
    
    // Update max price if provided
    if (maxPrice !== undefined) {
      const priceTypeToUse = priceType || (existingPackage as any).priceType;
      const priceToUse = updateData.price !== undefined ? updateData.price : (existingPackage as any).price;
      
      if (priceTypeToUse === 'range' && maxPrice <= priceToUse) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "For range price type, max price must be greater than the min price",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
      updateData.maxPrice = priceTypeToUse === 'range' ? maxPrice : null;
    }
    
    // Update currency if provided
    if (currency) {
      updateData.currency = currency;
    }
    
    // Update isActive if provided
    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }
    
    // Calculate discount and final price
    let finalPrice = updateData.price !== undefined ? updateData.price : (existingPackage as any).price;
    let calculatedDiscountAmount = 0;
    let calculatedDiscountPercentage = 0;
    
    if (discountPercentage !== undefined) {
      if (discountPercentage > 100) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Discount percentage cannot exceed 100%",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
      calculatedDiscountPercentage = discountPercentage;
      calculatedDiscountAmount = (finalPrice * discountPercentage) / 100;
      finalPrice = finalPrice - calculatedDiscountAmount;
      
      updateData.discountPercentage = calculatedDiscountPercentage;
      updateData.discountAmount = calculatedDiscountAmount;
    } else if (discountAmount !== undefined) {
      if (discountAmount >= finalPrice) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Discount amount cannot be greater than or equal to the price",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
      calculatedDiscountAmount = discountAmount;
      calculatedDiscountPercentage = (discountAmount / finalPrice) * 100;
      finalPrice = finalPrice - discountAmount;
      
      updateData.discountPercentage = calculatedDiscountPercentage;
      updateData.discountAmount = calculatedDiscountAmount;
    } else if (updateData.price !== undefined) {
      // If price changed but discount values weren't provided, recalculate based on existing percentage
      const existingDiscountPercentage = (existingPackage as any).discountPercentage || 0;
      
      if (existingDiscountPercentage > 0) {
        calculatedDiscountPercentage = existingDiscountPercentage;
        calculatedDiscountAmount = (finalPrice * existingDiscountPercentage) / 100;
        finalPrice = finalPrice - calculatedDiscountAmount;
        
        updateData.discountPercentage = calculatedDiscountPercentage;
        updateData.discountAmount = calculatedDiscountAmount;
      }
    }
    
    // Update final price if any price-related fields changed
    if (updateData.price !== undefined || discountPercentage !== undefined || discountAmount !== undefined) {
      updateData.finalPrice = finalPrice;
    }
    
    // Update the package
    const updatedPackage = await Package.findByIdAndUpdate(
      packageId,
      { $set: updateData },
      { new: true, session }
    );
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(res, "Package updated successfully", { package: updatedPackage });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

// Delete package by ID
export const deletePackage = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { packageId } = req.params;
    
    // Validate package exists and belongs to this business
    const existingPackage = await validatePackageAccess(packageId, businessId, res, session);
    if (!existingPackage) return;
    
    // Soft delete the package
    await Package.findByIdAndUpdate(
      packageId,
      { $set: { isDeleted: true } },
      { session }
    );
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(res, "Package deleted successfully");
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

// Delete multiple packages
export const deletePackages = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { packageIds } = req.body;
    
    if (!packageIds || !Array.isArray(packageIds) || packageIds.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Please provide an array of package IDs",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Validate all package IDs
    for (const packageId of packageIds) {
      if (!(await validateObjectId(packageId, "Package", res, session))) {
        return;
      }
    }
    
    // Check if all packages belong to this business
    const packages = await Package.find({
      _id: { $in: packageIds },
      businessId: businessId,
      isDeleted: false
    }).session(session);
    
    if (packages.length !== packageIds.length) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "One or more packages do not exist or don't belong to your business",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Soft delete all packages
    await Package.updateMany(
      { _id: { $in: packageIds } },
      { $set: { isDeleted: true } },
      { session }
    );
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(res, "Packages deleted successfully", {
      deletedPackages: packages.map(pkg => ({
        id: pkg._id,
        name: pkg.name
      }))
    });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};
