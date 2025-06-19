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
import Appointment from "models/appointment/appointmentSchema";


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
    
    // Get regular categories - only active ones
    const categories = await Category.find({ 
      businessId: businessId,
      isActive: true,
      isDeleted: false 
    }).sort({ name: 1 });
    
    // Get global categories from business profile - only active ones
    const globalCategories = business.selectedCategories?.filter(gc => gc.isActive) || [];
    
    // Get global category IDs
    const globalCategoryIds = globalCategories.map(gc => gc.categoryId);
    
    // Fetch global category details including descriptions
    const globalCategoryDetails = await mongoose.model("GlobalCategory").find({
      _id: { $in: globalCategoryIds },
      isActive: true,
      isDeleted: false
    });
    
    // Create a map for quick lookup
    const globalCategoryMap = new Map();
    globalCategoryDetails.forEach(gc => {
      globalCategoryMap.set(gc._id.toString(), gc);
    });
    
    // Process regular categories with their services
    const regularCategoriesWithServices = await Promise.all(
      categories.map(async (category) => {
        // Only get active services
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
          services: services // This might be an empty array, which is fine
        };
      })
    );
    
    // Process global categories with their services
    const globalCategoriesWithServices = await Promise.all(
      globalCategories.map(async (globalCat) => {
        // Only get active services
        const services = await Service.find({
          categoryId: globalCat.categoryId,
          businessId: businessId,
          isActive: true,
          isDeleted: false
        }).sort({ name: 1 });
        
        // Get global category details
        const globalCatDetails = globalCategoryMap.get(globalCat.categoryId.toString());

        return {
          _id: globalCat.categoryId,
          name: globalCat.name,
          description: globalCatDetails?.description || "",
          icon: globalCatDetails?.icon || "",
          isGlobal: true,
          services: services // This might be an empty array, which is fine
        };
      })
    );
    
    // Include all categories, even those with no services
    const allCategoriesWithServices = [
      ...regularCategoriesWithServices,
      ...globalCategoriesWithServices
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

export const getBusinessesWithAppointments = async (req: Request, res: Response) => {
  try {
    // Fetch all businesses
    const businesses = await UserBusinessProfile.find();

    // Get appointment counts for each business
    const appointmentCounts = await Appointment.aggregate([
      {
        $match: {
          status: { $in: ["PENDING", "CONFIRMED"] }
        }
      },
      {
        $group: {
          _id: "$businessId",
          count: { $sum: 1 }
        }
      }
    ]);

    // Map counts to businessId for quick lookup
    interface AppointmentCount {
      _id: mongoose.Types.ObjectId;
      count: number;
    }

    const countMap = appointmentCounts.reduce<Record<string, number>>((acc, curr: AppointmentCount) => {
      acc[curr._id.toString()] = curr.count;
      return acc;
    }, {});

    // Attach appointmentCount to each business
    interface BusinessWithAppointmentCount extends ReturnType<typeof businesses[number]['toObject']> {
      appointmentCount: number;
    }

    const result: BusinessWithAppointmentCount[] = businesses.map((business: typeof businesses[number]) => ({
      ...business.toObject(),
      appointmentCount: countMap[business._id.toString()] || 0
    }));

    result.sort((a, b) => b.appointmentCount - a.appointmentCount);
    const topBusinesses = result.slice(0, 10); 
    return successResponse(res, "Businesses with appointment counts fetched successfully", {
      businesses: topBusinesses
    });
  } catch (error: any) {
    console.error("Error fetching businesses with appointments:", error);
    return errorResponseHandler(
      "Failed to fetch businesses with appointments",
      httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
  }
};


export const getRecommendedBusinesses = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;

  
    if (!clientId || typeof clientId !== "string") {
      return errorResponseHandler(
        "Client ID is required and must be a string",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Aggregate appointments for the client, group by businessId, count, and sort
    const appointmentCounts = await Appointment.aggregate([
      {
        $match: {
          clientId: new mongoose.Types.ObjectId(clientId)
        }
      },
      {
        $group: {
          _id: "$businessId",
          count: { $sum: 1 }
        }
      },
      {
        $sort: { count: -1 }
      },
      {
        $limit: 10
      }
    ]);

    // If no appointments, return empty array
    if (appointmentCounts.length === 0) {
      return successResponse(res, "No recommended businesses found for client", {
        businesses: []
      });
    }

    // Fetch business details for the top businesses
    const businessIds = appointmentCounts.map(a => a._id);
    const businesses = await UserBusinessProfile.find({
      _id: { $in: businessIds }
    }).select(
      "businessName businessProfilePic PhoneNumber countryCode email businessDescription " +
      "websiteLink facebookLink instagramLink messengerLink country selectedCategories"
    );

    // Map counts to businessId for quick lookup
    interface AppointmentCount {
      _id: mongoose.Types.ObjectId;
      count: number;
    }

    const countMap = appointmentCounts.reduce<Record<string, number>>((acc, curr: AppointmentCount) => {
      acc[curr._id.toString()] = curr.count;
      return acc;
    }, {});

    // Attach appointmentCount to each business
    interface BusinessWithAppointmentCount extends ReturnType<typeof businesses[number]['toObject']> {
      appointmentCount: number;
    }

    const result: BusinessWithAppointmentCount[] = businesses.map((business: typeof businesses[number]) => ({
      ...business.toObject(),
      appointmentCount: countMap[business._id.toString()] || 0
    }));

    // Sort by appointment count (descending) to maintain order from aggregation
    result.sort((a, b) => b.appointmentCount - a.appointmentCount);

    return successResponse(res, "Recommended businesses fetched successfully", {
      businesses: result
    });
  } catch (error: any) {
    console.error("Error fetching recommended businesses:", error);
    return errorResponseHandler(
      "Failed to fetch recommended businesses",
      httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
  }
};

