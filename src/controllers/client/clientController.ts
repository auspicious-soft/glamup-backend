import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import { successResponse } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import Service from "../../models/services/servicesSchema";
import Category from "models/category/categorySchema";
import UserBusinessProfile from "models/business/userBusinessProfileSchema";
import mongoose from "mongoose";
import { validateObjectId } from "../../utils/user/usercontrollerUtils";

// Get all services for a specific business
export const getBusinessServices = async (req: Request, res: Response) => {
  try {
    const { businessId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return errorResponseHandler(
        "Invalid business ID format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Check if business exists and is active
    const business = await UserBusinessProfile.findOne({
      _id: businessId,
      status: "active",
      isDeleted: false
    });
    
    if (!business) {
      return errorResponseHandler(
        "Business profile not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Get all active services for this business
    const services = await Service.find({
      businessId: businessId,
      isActive: true,
      isDeleted: false
    }).sort({ name: 1 });
    
    return successResponse(
      res,
      "Business services fetched successfully",
      {
        business: {
          _id: business._id,
          businessName: business.businessName,
          businessProfilePic: business.businessProfilePic
        },
        services,
        count: services.length
      },
      httpStatusCode.OK
    );
  } catch (error: any) {
    console.error("Error fetching business services:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};

// Get all categories with their services for a specific business
export const getBusinessCategoriesWithServices = async (req: Request, res: Response) => {
  try {
    const { businessId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(businessId)) {
      return errorResponseHandler(
        "Invalid business ID format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Check if business exists and is active
    const business = await UserBusinessProfile.findOne({
      _id: businessId,
      status: "active",
      isDeleted: false
    });
    
    if (!business) {
      return errorResponseHandler(
        "Business profile not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Get regular categories
    const categories = await Category.find({ 
      businessId: businessId,
      isActive: true,
      isDeleted: false 
    }).sort({ name: 1 });
    
    // Get global categories from business profile
    const globalCategories = business.selectedCategories || [];
    
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
          description: category.description || "",
          isGlobal: false,
          services: services
        };
      })
    );
    
    // Process global categories with their services
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
    
    // Combine regular and global categories, filtering out global categories with no services
    const allCategoriesWithServices = [
      ...regularCategoriesWithServices,
      ...globalCategoriesWithServices.filter(cat => cat.services.length > 0)
    ];
    
    return successResponse(
      res,
      "Business categories with services fetched successfully",
      {
        business: {
          _id: business._id,
          businessName: business.businessName,
          businessProfilePic: business.businessProfilePic
        },
        categoriesWithServices: allCategoriesWithServices,
        totalCategories: allCategoriesWithServices.length
      },
      httpStatusCode.OK
    );
  } catch (error: any) {
    console.error("Error fetching business categories with services:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};

// Get services for a specific category (global or regular) for a business
export const getBusinessCategoryServices = async (req: Request, res: Response) => {
  try {
    const { businessId, categoryId } = req.query;
    
    if (!businessId || !categoryId) {
      return errorResponseHandler(
        "Business ID and Category ID are required query parameters",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    if (!mongoose.Types.ObjectId.isValid(businessId as string) || 
        !mongoose.Types.ObjectId.isValid(categoryId as string)) {
      return errorResponseHandler(
        "Invalid ID format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Check if business exists and is active
    const business = await UserBusinessProfile.findOne({
      _id: businessId,
      status: "active",
      isDeleted: false
    });
    
    if (!business) {
      return errorResponseHandler(
        "Business profile not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Find services for this category and business
    const services = await Service.find({
      businessId: businessId,
      categoryId: categoryId,
      isActive: true,
      isDeleted: false
    }).sort({ name: 1 });
    
    // Determine if this is a global category
    const isGlobalCategory = business.selectedCategories.some(
      cat => cat.categoryId.toString() === categoryId
    );
    
    // Get category name
    let categoryName = "";
    if (isGlobalCategory) {
      const globalCat = business.selectedCategories.find(
        cat => cat.categoryId.toString() === categoryId
      );
      categoryName = globalCat ? globalCat.name : "";
    } else {
      const category = await Category.findOne({
        _id: categoryId,
        businessId: businessId,
        isActive: true,
        isDeleted: false
      });
      categoryName = category ? category.name : "";
    }
    
    return successResponse(
      res,
      "Category services fetched successfully",
      {
        category: {
          _id: categoryId,
          name: categoryName,
          isGlobal: isGlobalCategory
        },
        services,
        count: services.length
      },
      httpStatusCode.OK
    );
  } catch (error: any) {
    console.error("Error fetching category services:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};
