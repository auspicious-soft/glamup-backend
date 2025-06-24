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
import mongoose, { startSession, Types } from "mongoose";
import Appointment from "models/appointment/appointmentSchema";

const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in km
};


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

// Get businesses within a specified radius

export const getBusinessesWithinRadius = async (req: Request, res: Response) => {
  try {
    const { latitude, longitude, radius } = req.query;

    if (!latitude || !longitude || !radius) {
      return errorResponseHandler(
        "Latitude, longitude, and radius are required query parameters",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const lat = parseFloat(latitude as string);
    const lon = parseFloat(longitude as string);
    const rad = parseFloat(radius as string);

    if (isNaN(lat) || isNaN(lon) || isNaN(rad)) {
      return errorResponseHandler(
        "Invalid latitude, longitude, or radius format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return errorResponseHandler(
        "Latitude must be between -90 and 90, and longitude between -180 and 180",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (rad < 0 || rad > 10000) {
      return errorResponseHandler(
        "Radius must be a positive number and less than 10000 km",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Use $geoNear aggregation for precise distance calculation
    const businesses = await UserBusinessProfile.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [lon, lat] },
          distanceField: "calculatedDistance", // Store distance in meters
          maxDistance: rad * 1000, // Radius in meters
          spherical: true,
          query: { status: "active", isDeleted: false },
        },
      },
      {
        $project: {
          businessName: 1,
          businessProfilePic: 1,
          businessAddress: 1,
          coordinates: 1,
          calculatedDistance: { $divide: ["$calculatedDistance", 1000] }, // Convert to km
        },
      },
      {
        $limit: 50,
      },
    ]);

    // Map businesses and add Haversine distance for verification
    const businessesWithHaversine = businesses.map((business) => {
      const businessLat = business.coordinates.coordinates[1];
      const businessLon = business.coordinates.coordinates[0];
      const haversineDist = haversineDistance(lat, lon, businessLat, businessLon);

      return {
        _id: business._id,
        businessName: business.businessName,
        businessProfilePic: business.businessProfilePic,
        businessAddress: business.businessAddress,
        coordinates: {
          latitude: businessLat,
          longitude: businessLon,
        },
        geodesicDistance: business.calculatedDistance,
      };
    });

    return successResponse(
      res,
      "Businesses within radius fetched successfully",
      {
        businesses: businessesWithHaversine,
        count: businesses.length,
        radius: rad,
        center: { latitude: lat, longitude: lon },
      },
      httpStatusCode.OK
    );
  } catch (error: any) {
    console.error("Error fetching businesses within radius:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(
      error.message,
      error.code || httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
  }
};

export const getBusinessProfileById = async (req: Request, res:Response) =>{

    const session = await startSession();
  try {
    const {businessId} = req.query;

  if(!businessId){
    return errorResponseHandler(
      "Business Id is required",
      httpStatusCode.BAD_REQUEST,
      res
    );
  }
  if (!Types.ObjectId.isValid(businessId as string)) {
      return errorResponseHandler(
        "Invalid Business Id format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
  const businessProfile = await UserBusinessProfile.findOne({
    _id:businessId,
    isDeleted:false,
    status:"active",
  });

  
const categories = await Category.find({
  businessId: businessId,
  isDeleted: false,
  isActive: true,
  // Exclude global categories if you have a flag, e.g., isGlobal: false
  $or: [{ isGlobal: { $exists: false } }, { isGlobal: false }]
}).sort({ name: 1 });

const categoryAndServices = [];

for (const category of categories) {
  const services = await Service.find({
    categoryId: category._id,
    businessId: businessId,
    isDeleted: false,
    isActive: true
  }).sort({ name: 1 });

  if (services.length > 0) {
    categoryAndServices.push({
      _id: category._id,
      name: category.name,
      description: category.description,
      services: services.map(service => ({
        _id: service._id,
        name: service.name,
        description: service.description,
        duration: service.duration,
        price: service.price,
        priceType: service.priceType,
        maxPrice: service.maxPrice,
        currency: service.currency,
        icon: service.icon,
        tags: service.tags,
        isActive: service.isActive
      }))
    });
  }
}


  if(!businessProfile){
      if (session && session.inTransaction()) {
    await session.abortTransaction();
    session.endSession();
  }
  errorResponseHandler(
    "Business Profile Not Found.",
    httpStatusCode.NOT_FOUND,
    res
  );
  return null;
}
return successResponse(res, "Business Profile fetched Successfully.",{
  businessProfile,
  categoryAndServices,
});
  } catch (error: any) {
     console.error("Error fetching business profile:", error);
    return errorResponseHandler(
      "Failed to fetch business profile",
      httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
  }
  
}