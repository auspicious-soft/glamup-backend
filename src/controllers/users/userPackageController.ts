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
import Category from "models/category/categorySchema";

// Define the type for services used in packages
interface ServiceForPackage {
  serviceId: string;
  name: string;
  duration: number;
  price: number;
}

// Define the type for category and services structure
interface CategoryWithServices {
  categoryId: string;
  services: string[];
}

// Package functions
export const createPackage = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { 
      name, 
      categoryAndServices, // New structure with multiple categories and their services
      description, 
      duration, 
      priceType, 
      price, 
      maxPrice, 
      discountPercentage,
      discountAmount,
      currency
    } = req.body;
    
    if (!name || !categoryAndServices || !Array.isArray(categoryAndServices) || categoryAndServices.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Package name and at least one category with services are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Process all categories and their services
    let allProcessedServices: ServiceForPackage[] = [];
    let primaryCategoryId = categoryAndServices[0].categoryId; // Use first category as primary
    let primaryCategoryName = "";
    let isGlobalCategory = false;

    // Validate each category and its services
    for (const categoryWithServices of categoryAndServices) {
      const { categoryId, services } = categoryWithServices;
      
      if (!categoryId || !services || !Array.isArray(services) || services.length === 0) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Each category must have a valid categoryId and at least one service",
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
      
      let isCategoryGlobal = false;
      let categoryName = "";
      
      if (businessProfile && businessProfile.selectedCategories.some(cat => cat.categoryId.toString() === categoryId)) {
        // This is a global category that the business has selected
        isCategoryGlobal = true;
        const globalCategory = businessProfile.selectedCategories.find(
          cat => cat.categoryId.toString() === categoryId
        );
        
        if (!globalCategory?.isActive) {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            `The global category with ID ${categoryId} is inactive in your business profile`,
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

      // If this is the first category, set it as primary
      if (categoryId === primaryCategoryId) {
        primaryCategoryName = categoryName;
        isGlobalCategory = isCategoryGlobal;
      }

      // Find services and check if they belong to the specified category and business
      const existingServices = await Service.find({
        _id: { $in: services },
        categoryId: categoryId,
        businessId: businessId,
        isDeleted: false
      }).session(session);
      
      if (existingServices.length !== services.length) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          `One or more services don't belong to the category with ID ${categoryId}, or don't belong to your business`,
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
      if (isCategoryGlobal) {
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
        price: service.price,
        categoryId: categoryId,
        categoryName: categoryName
      }));

      // Add to all processed services
      allProcessedServices = [...allProcessedServices, ...processedServices];
    }

    // Calculate total price based on all services
    const totalServicesPrice = allProcessedServices.reduce((sum, service) => sum + service.price, 0);
    
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

    // Store all category IDs in the package
    const categoryIds = categoryAndServices.map(item => item.categoryId);

    const newPackage = await Package.create(
      [
        {
          name: name.trim(),
          categoryId: primaryCategoryId, // Primary category (first one)
          categoryName: primaryCategoryName,
          categoryIds: categoryIds, // Store all category IDs
          description: description || "",
          services: allProcessedServices,
          duration: duration || allProcessedServices.reduce((sum, service) => sum + service.duration, 0),
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
      .sort({ sortingOrderNo: 1 })
      .skip(skip)
      .limit(limit);

    // Filter out deleted categories and services from each package
    const updatedPackages = await Promise.all(packages.map(async (pkg) => {
      const packageObj = pkg.toObject ? pkg.toObject() : {...pkg};
      
      // Filter out categoryIds that have been deleted
      if (packageObj.categoryIds && packageObj.categoryIds.length > 0) {
        // Find which categoryIds still exist and are not deleted
        const existingCategories = await Category.find(
          {
            _id: { $in: packageObj.categoryIds },
            isDeleted: false
          },
          { _id: 1 }
        ) as { _id: mongoose.Types.ObjectId }[];

        const existingCategoryIds = new Set(existingCategories.map(cat => cat._id.toString()));

        // Filter out deleted categoryIds
        packageObj.categoryIds = packageObj.categoryIds.filter((catId: any) =>
          existingCategoryIds.has(catId.toString())
        );
      }

      // Filter out services that have been deleted
      if (packageObj.services && packageObj.services.length > 0) {
        // Get all service IDs from the package
        const serviceIds = packageObj.services.map(svc => svc.serviceId);
        
        // Find which services still exist and are not deleted
        const existingServices = await Service.find({
          _id: { $in: serviceIds },
          isDeleted: false
        }, { _id: 1 }) as { _id: mongoose.Types.ObjectId }[];
        
        const existingServiceIds = new Set(existingServices.map(svc => svc._id.toString()));
        
        // Filter out deleted services
        packageObj.services = packageObj.services.filter(svc => 
          existingServiceIds.has(svc.serviceId.toString())
        );
      }
      
      return packageObj;
    }));

    const paginationMeta = createPaginationMetadata(page, limit, totalPackages);

    return successResponse(res, "Packages fetched successfully", {
      packages: updatedPackages,
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

    // Filter out categoryIds that have been deleted
    if (packageItem.categoryIds && packageItem.categoryIds.length > 0) {
      // Find which categoryIds still exist and are not deleted
      const existingCategories = await Category.find({
        _id: { $in: packageItem.categoryIds },
        isDeleted: false
      }, { _id: 1 }) as { _id: mongoose.Types.ObjectId }[];

      const existingCategoryIds = new Set(existingCategories.map(cat => cat._id.toString()));

      // Filter out deleted categoryIds
      packageItem.categoryIds = packageItem.categoryIds.filter((catId: any) =>
        existingCategoryIds.has(catId.toString())
      );
    }
    // Get all service IDs from the package
    const serviceIds = packageItem.services.map(svc => svc.serviceId);
    
    // Find which services still exist and are not deleted
    const existingServices = await Service.find({
      _id: { $in: serviceIds },
      isDeleted: false
    }, { _id: 1 }) as { _id: mongoose.Types.ObjectId }[];
    
    const existingServiceIds = new Set(existingServices.map(svc => svc._id.toString()));
    
    // Filter out deleted services
    packageItem.services = packageItem.services.filter(svc => 
      existingServiceIds.has(svc.serviceId.toString())
    );

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
      categoryAndServices, // New structure with multiple categories and their services
      description, 
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
    
    // Process categoryAndServices if provided
    if (categoryAndServices && Array.isArray(categoryAndServices) && categoryAndServices.length > 0) {
      // Process all categories and their services
      let allProcessedServices: ServiceForPackage[] = [];
      let primaryCategoryId = categoryAndServices[0].categoryId; // Use first category as primary
      let primaryCategoryName = "";
      let isGlobalCategory = false;
      let categoryIds: string[] = [];

      // Validate each category and its services
      for (const categoryWithServices of categoryAndServices) {
        const { categoryId, services } = categoryWithServices;
        
        if (!categoryId || !services || !Array.isArray(services) || services.length === 0) {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            "Each category must have a valid categoryId and at least one service",
            httpStatusCode.BAD_REQUEST,
            res
          );
        }

        categoryIds.push(categoryId);

        // Check if this is a global category
        const businessProfile = await UserBusinessProfile.findOne({
          _id: businessId,
          "selectedCategories.categoryId": categoryId,
          isDeleted: false
        }).session(session);
        
        let isCategoryGlobal = false;
        let categoryName = "";
        
        if (businessProfile && businessProfile.selectedCategories.some(cat => cat.categoryId.toString() === categoryId)) {
          // This is a global category that the business has selected
          isCategoryGlobal = true;
          const globalCategory = businessProfile.selectedCategories.find(
            cat => cat.categoryId.toString() === categoryId
          );
          
          if (!globalCategory?.isActive) {
            await session.abortTransaction();
            session.endSession();
            return errorResponseHandler(
              `The global category with ID ${categoryId} is inactive in your business profile`,
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

        // If this is the first category, set it as primary
        if (categoryId === primaryCategoryId) {
          primaryCategoryName = categoryName;
          isGlobalCategory = isCategoryGlobal;
        }

        // Find services and check if they belong to the specified category and business
        const existingServices = await Service.find({
          _id: { $in: services },
          categoryId: categoryId,
          businessId: businessId,
          isDeleted: false
        }).session(session);
        
        if (existingServices.length !== services.length) {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            `One or more services don't belong to the category with ID ${categoryId}, or don't belong to your business`,
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
        if (isCategoryGlobal) {
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
          price: service.price,
          categoryId: categoryId,
          categoryName: categoryName
        }));

        // Add to all processed services
        allProcessedServices = [...allProcessedServices, ...processedServices];
      }

      // Update the package with new category information
      updateData.categoryId = primaryCategoryId;
      updateData.categoryName = primaryCategoryName;
      updateData.categoryIds = categoryIds;
      updateData.services = allProcessedServices;
      updateData.isGlobalCategory = isGlobalCategory;
      
      // Recalculate duration based on services if not explicitly provided
      if (duration === undefined) {
        updateData.duration = allProcessedServices.reduce((sum, service) => sum + service.duration, 0);
      }
      
      // Recalculate price based on services if not explicitly provided
      if (price === undefined) {
        const totalServicesPrice = allProcessedServices.reduce((sum, service) => sum + service.price, 0);
        updateData.price = totalServicesPrice;
      }
    }
    
    // Update description if provided
    if (description !== undefined) {
      updateData.description = description;
    }
    
    // Update duration if provided
    if (duration !== undefined) {
      updateData.duration = duration;
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
      updateData.finalPrice = finalPrice;
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
      updateData.finalPrice = finalPrice;
    } else if (updateData.price !== undefined) {
      // If price changed but discount values weren't provided, recalculate based on existing percentage
      const existingDiscountPercentage = (existingPackage as any).discountPercentage || 0;
      
      if (existingDiscountPercentage > 0) {
        calculatedDiscountPercentage = existingDiscountPercentage;
        calculatedDiscountAmount = (finalPrice * existingDiscountPercentage) / 100;
        finalPrice = finalPrice - calculatedDiscountAmount;
        
        updateData.discountPercentage = calculatedDiscountPercentage;
        updateData.discountAmount = calculatedDiscountAmount;
        updateData.finalPrice = finalPrice;
      } else {
        updateData.finalPrice = finalPrice;
      }
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


export const swapPackageOrder = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { replacingPackageId, replacedPackageId } = req.body;

    if (!replacingPackageId || !replacedPackageId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Both replacingPackageId and replacedPackageId are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (!(await validateObjectId(replacingPackageId, "Package", res, session))) return;
    if (!(await validateObjectId(replacedPackageId, "Package", res, session))) return;

    const [replacingPackage, replacedPackage] = await Promise.all([
      Package.findOne({ _id: replacingPackageId, businessId, isDeleted: false }).session(session),
      Package.findOne({ _id: replacedPackageId, businessId, isDeleted: false }).session(session),
    ]);

    if (!replacingPackage || !replacedPackage) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "One or both Packages not found or you don't have access",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    const replacingOriginalOrder = replacingPackage.sortingOrderNo;
    const replacedOriginalOrder = replacedPackage.sortingOrderNo;

    // Use a temporary value to avoid unique constraint violation
    const tempOrder = -1 * Date.now(); 

    replacingPackage.sortingOrderNo = tempOrder;
    await replacingPackage.save({ session });

    replacedPackage.sortingOrderNo = replacingOriginalOrder;
    await replacedPackage.save({ session });

    replacingPackage.sortingOrderNo = replacedOriginalOrder;
    await replacingPackage.save({ session });

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Package order swapped successfully", {
      updatedPackages: [
        {
          _id: replacingPackage._id,
          name: replacingPackage.name,
          sortingOrderNo: replacingPackage.sortingOrderNo,
        },
        {
          _id: replacedPackage._id,
          name: replacedPackage.name,
          sortingOrderNo: replacedPackage.sortingOrderNo,
        },
      ],
    });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return handleTransactionError(session, error, res);
  }
};