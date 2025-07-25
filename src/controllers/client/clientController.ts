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
import TeamMember from "models/team/teamMemberSchema";
import RegisteredClient from "models/registeredClient/registeredClientSchema";
import { validateUserAuth } from "utils/user/usercontrollerUtils";
import Package from "models/package/packageSchema";

const haversineDistance = (
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number => {
  const R = 6371; // Earth's radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
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
      isDeleted: false,
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
      isDeleted: false,
    }).sort({ name: 1 });

    return successResponse(
      res,
      "Business services fetched successfully",
      {
        business: {
          _id: business._id,
          businessName: business.businessName,
          businessProfilePic: business.businessProfilePic,
        },
        services,
        count: services.length,
      },
      httpStatusCode.OK
    );
  } catch (error: any) {
    console.error("Error fetching business services:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
  }
};

// Get all categories with their services for a specific business
export const getBusinessCategoriesWithServices = async (
  req: Request,
  res: Response
) => {
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
      isDeleted: false,
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
      isDeleted: false,
    }).sort({ name: 1 });

    // Get global categories from business profile - only active ones
    const globalCategories =
      business.selectedCategories?.filter((gc) => gc.isActive) || [];

    // Get global category IDs
    const globalCategoryIds = globalCategories.map((gc) => gc.categoryId);

    // Fetch global category details including descriptions
    const globalCategoryDetails = await mongoose.model("GlobalCategory").find({
      _id: { $in: globalCategoryIds },
      isActive: true,
      isDeleted: false,
    });

    // Create a map for quick lookup
    const globalCategoryMap = new Map();
    globalCategoryDetails.forEach((gc) => {
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
          isDeleted: false,
        }).sort({ name: 1 });

        return {
          _id: category._id,
          name: category.name,
          description: category.description || "",
          isGlobal: false,
          services: services, // This might be an empty array, which is fine
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
          isDeleted: false,
        }).sort({ name: 1 });

        // Get global category details
        const globalCatDetails = globalCategoryMap.get(
          globalCat.categoryId.toString()
        );

        return {
          _id: globalCat.categoryId,
          name: globalCat.name,
          description: globalCatDetails?.description || "",
          icon: globalCatDetails?.icon || "",
          isGlobal: true,
          services: services, // This might be an empty array, which is fine
        };
      })
    );

    // Include all categories, even those with no services
    const allCategoriesWithServices = [
      ...regularCategoriesWithServices,
      ...globalCategoriesWithServices,
    ];

    return successResponse(
      res,
      "Business categories with services fetched successfully",
      {
        business: {
          _id: business._id,
          businessName: business.businessName,
          businessProfilePic: business.businessProfilePic,
        },
        categoriesWithServices: allCategoriesWithServices,
        totalCategories: allCategoriesWithServices.length,
      },
      httpStatusCode.OK
    );
  } catch (error: any) {
    console.error("Error fetching business categories with services:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
  }
};

// Get services for a specific category (global or regular) for a business
export const getBusinessCategoryServices = async (
  req: Request,
  res: Response
) => {
  try {
    const { businessId, categoryId } = req.query;

    if (!businessId || !categoryId) {
      return errorResponseHandler(
        "Business ID and Category ID are required query parameters",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (
      !mongoose.Types.ObjectId.isValid(businessId as string) ||
      !mongoose.Types.ObjectId.isValid(categoryId as string)
    ) {
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
      isDeleted: false,
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
      isDeleted: false,
    }).sort({ name: 1 });

    // Determine if this is a global category
    const isGlobalCategory = business.selectedCategories.some(
      (cat) => cat.categoryId.toString() === categoryId
    );

    // Get category name
    let categoryName = "";
    if (isGlobalCategory) {
      const globalCat = business.selectedCategories.find(
        (cat) => cat.categoryId.toString() === categoryId
      );
      categoryName = globalCat ? globalCat.name : "";
    } else {
      const category = await Category.findOne({
        _id: categoryId,
        businessId: businessId,
        isActive: true,
        isDeleted: false,
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
          isGlobal: isGlobalCategory,
        },
        services,
        count: services.length,
      },
      httpStatusCode.OK
    );
  } catch (error: any) {
    console.error("Error fetching category services:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
  }
};

export const getBusinessesWithAppointments = async (
  req: Request,
  res: Response
) => {
  try {
    // Fetch all businesses

    const businesses = await UserBusinessProfile.find({ isDeleted: false });

    // Get appointment counts for each business
    const appointmentCounts = await Appointment.aggregate([
      {
        $match: {
          status: { $in: ["PENDING", "CONFIRMED"] },
        },
      },
      {
        $group: {
          _id: "$businessId",
          count: { $sum: 1 },
        },
      },
    ]);

    // Map counts to businessId for quick lookup
    interface AppointmentCount {
      _id: mongoose.Types.ObjectId;
      count: number;
    }

    const countMap = appointmentCounts.reduce<Record<string, number>>(
      (acc, curr: AppointmentCount) => {
        acc[curr._id.toString()] = curr.count;
        return acc;
      },
      {}
    );

    // Attach appointmentCount to each business
    interface BusinessWithAppointmentCount
      extends ReturnType<(typeof businesses)[number]["toObject"]> {
      appointmentCount: number;
    }

    const result: BusinessWithAppointmentCount[] = businesses.map(
      (business: (typeof businesses)[number]) => ({
        ...business.toObject(),
        appointmentCount: countMap[business._id.toString()] || 0,
      })
    );

    result.sort((a, b) => b.appointmentCount - a.appointmentCount);
    const topBusinesses = result.slice(0, 10);
    return successResponse(
      res,
      "Businesses with appointment counts fetched successfully",
      {
        businesses: topBusinesses,
      }
    );
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
          clientId: new mongoose.Types.ObjectId(clientId),
        },
      },
      {
        $group: {
          _id: "$businessId",
          count: { $sum: 1 },
        },
      },
      {
        $sort: { count: -1 },
      },
      {
        $limit: 10,
      },
    ]);

    // If no appointments, return empty array
    if (appointmentCounts.length === 0) {
      return successResponse(
        res,
        "No recommended businesses found for client",
        {
          businesses: [],
        }
      );
    }

    // Fetch business details for the top businesses, excluding deleted ones
    const businessIds = appointmentCounts.map((a) => a._id);
    const businesses = await UserBusinessProfile.find({
      _id: { $in: businessIds },
      isDeleted: { $ne: true }, // Exclude businesses where isDeleted is true
    }).select(
      "businessName businessProfilePic PhoneNumber countryCode email businessDescription " +
        "websiteLink facebookLink instagramLink messengerLink country selectedCategories"
    );

    // Map counts to businessId for quick lookup
    interface AppointmentCount {
      _id: mongoose.Types.ObjectId;
      count: number;
    }

    const countMap = appointmentCounts.reduce<Record<string, number>>(
      (acc, curr: AppointmentCount) => {
        acc[curr._id.toString()] = curr.count;
        return acc;
      },
      {}
    );

    // Attach appointmentCount to each business
    interface BusinessWithAppointmentCount
      extends ReturnType<(typeof businesses)[number]["toObject"]> {
      appointmentCount: number;
    }

    const result: BusinessWithAppointmentCount[] = businesses.map(
      (business: (typeof businesses)[number]) => ({
        ...business.toObject(),
        appointmentCount: countMap[business._id.toString()] || 0,
      })
    );

    // Sort by appointment count (descending) to maintain order from aggregation
    result.sort((a, b) => b.appointmentCount - a.appointmentCount);

    return successResponse(res, "Recommended businesses fetched successfully", {
      businesses: result,
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

export const getBusinessesWithinRadius = async (
  req: Request,
  res: Response
) => {
  try {
    const { latitude, longitude, radius, serviceOrVenue, date } = req.query;

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

    // Step 1: Find all businesses within the radius
    let geoBusinesses = await UserBusinessProfile.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [lon, lat] },
          distanceField: "calculatedDistance",
          maxDistance: rad * 1000, // Correct: km to meters
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
          calculatedDistance: { $divide: ["$calculatedDistance", 1000] },
          selectedCategories: 1,
          businessHours: 1,
        },
      },
      {
        $limit: 50,
      },
    ]);

    console.log("geoBusinesses:", geoBusinesses.length);

    // Step 2: Filter businesses by open status on the specified date
    let filteredBusinesses = geoBusinesses;
    if (date) {
      const parsedDate = new Date(date as string);
      if (isNaN(parsedDate.getTime())) {
        return errorResponseHandler(
          "Invalid date format",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      const dayOfWeek = parsedDate
        .toLocaleDateString("en-US", { weekday: "long" })
        .toLowerCase();
      filteredBusinesses = geoBusinesses.filter((business) => {
        const hours = business.businessHours?.[dayOfWeek];
        return (
          !hours ||
          (hours.isOpen &&
            Array.isArray(hours.timeSlots) &&
            hours.timeSlots.length > 0)
        );
      });
    }

    console.log("filteredBusinesses:", filteredBusinesses.length);

    // Step 3: If no serviceOrVenue, return all filtered businesses
    if (
      !serviceOrVenue ||
      typeof serviceOrVenue !== "string" ||
      !serviceOrVenue.trim()
    ) {
      return successResponse(
        res,
        "Businesses within radius fetched successfully",
        {
          businesses: filteredBusinesses.map((business) => ({
            _id: business._id,
            businessName: business.businessName,
            businessProfilePic: business.businessProfilePic,
            businessAddress: business.businessAddress,
            coordinates: {
              latitude: business.coordinates.coordinates[1],
              longitude: business.coordinates.coordinates[0],
            },
            geodesicDistance: business.calculatedDistance,
          })),
          count: filteredBusinesses.length,
          radius: rad,
          center: { latitude: lat, longitude: lon },
        },
        httpStatusCode.OK
      );
    }

    // Step 4: Search by businessName, category, or service
    const searchValue = serviceOrVenue.trim();
    const regex = new RegExp(searchValue, "i");
    let businessIds = new Set<string>();

    // Search by businessName
    let matchedBusinesses = filteredBusinesses.filter((b) =>
      b.businessName?.toLowerCase().includes(searchValue.toLowerCase())
    );
    matchedBusinesses.forEach((b) => businessIds.add(b._id.toString()));
    console.log("matchedBusinesses (name):", matchedBusinesses.length);

    // Search by service businessId
    if (matchedBusinesses.length === 0) {
      const services = await Service.find({
        name: regex,
        isActive: true,
        isDeleted: false,
      });
      console.log(
        "services found:",
        services.length,
        services.map((s) => ({ name: s.name, businessId: s.businessId }))
      );

      const serviceBusinessIds = services
        .filter((s) => s.businessId)
        .map((s) => s.businessId.toString());
      matchedBusinesses = filteredBusinesses.filter((business) =>
        serviceBusinessIds.includes(business._id.toString())
      );
      matchedBusinesses.forEach((b) => businessIds.add(b._id.toString()));
      console.log(
        "matchedBusinesses (service businessId):",
        matchedBusinesses.length
      );
    }

    // Search by category name
    if (matchedBusinesses.length === 0) {
      const categories = await Category.find({
        name: regex,
        isActive: true,
        isDeleted: false,
      });
      console.log(
        "categories found:",
        categories.length,
        categories.map((c: any) => c.name)
      );

      const categoryIds = categories.map((c: any) => c._id.toString());
      matchedBusinesses = filteredBusinesses.filter((business) =>
        business.selectedCategories?.some(
          (gc: any) =>
            categoryIds.includes(gc.categoryId?.toString()) ||
            gc.name?.toLowerCase().includes(searchValue.toLowerCase())
        )
      );
      matchedBusinesses.forEach((b) => businessIds.add(b._id.toString()));
      console.log("matchedBusinesses (category):", matchedBusinesses.length);
    }

    // Search by service category
    if (matchedBusinesses.length === 0) {
      const services = await Service.find({
        name: regex,
        isActive: true,
        isDeleted: false,
      });
      console.log(
        "services (category) found:",
        services.length,
        services.map((s) => ({ name: s.name, categoryId: s.categoryId }))
      );

      const serviceCategoryIds = services
        .filter((s) => s.categoryId)
        .map((s) => s.categoryId.toString());
      const categories = await Category.find({
        _id: { $in: serviceCategoryIds },
        isActive: true,
        isDeleted: false,
      });
      const categoryIds = categories.map((c: any) => c._id.toString());
      console.log(
        "categories from services:",
        categories.length,
        categories.map((c) => c.name)
      );

      matchedBusinesses = filteredBusinesses.filter((business) =>
        business.selectedCategories?.some((gc: any) =>
          categoryIds.includes(gc.categoryId?.toString())
        )
      );
      matchedBusinesses.forEach((b) => businessIds.add(b._id.toString()));
      console.log(
        "matchedBusinesses (service category):",
        matchedBusinesses.length
      );
    }

    // Step 5: Prepare unique businesses
    const uniqueBusinesses = filteredBusinesses.filter((b) =>
      businessIds.has(b._id.toString())
    );
    console.log("uniqueBusinesses:", uniqueBusinesses.length);

    return successResponse(
      res,
      "Businesses within radius fetched successfully",
      {
        businesses: uniqueBusinesses.map((business) => ({
          _id: business._id,
          businessName: business.businessName,
          businessProfilePic: business.businessProfilePic,
          businessAddress: business.businessAddress,
          coordinates: {
            latitude: business.coordinates.coordinates[1],
            longitude: business.coordinates.coordinates[0],
          },
          geodesicDistance: business.calculatedDistance,
        })),
        count: uniqueBusinesses.length,
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

export const getBusinessProfileById = async (req: Request, res: Response) => {
  const session = await startSession();
  try {
    const { businessId, clientId } = req.query;

    if (!businessId) {
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
      _id: businessId,
      isDeleted: false,
      status: "active",
    });

    // --- FAVOURITE LOGIC ---
    let isFavourite = false;
    if (clientId && Types.ObjectId.isValid(clientId as string)) {
      const client = await RegisteredClient.findById(clientId).select(
        "favouriteBusinesses"
      );
      if (client && Array.isArray(client.favouriteBusinesses)) {
        isFavourite = client.favouriteBusinesses.some(
          (fav: any) => fav.businessId.toString() === businessId
        );
      }
    }
    // -----------------------

    const categories = await Category.find({
      businessId: businessId,
      isDeleted: false,
      isActive: true,
      $or: [{ isGlobal: { $exists: false } }, { isGlobal: false }],
    }).sort({ name: 1 });

    const categoryAndServices = [];

    for (const category of categories) {
      const services = await Service.find({
        categoryId: category._id,
        businessId: businessId,
        isDeleted: false,
        isActive: true,
      }).sort({ name: 1 });

      if (services.length > 0) {
        const serviceWithTeamMembers = await Promise.all(
          services.map(async (service) => {
            // Fetch only active and non-deleted team members
            const teamMembers = await TeamMember.find({
              _id: { $in: service.teamMembers.map((tm) => tm.memberId) },
              isActive: true,
              isDeleted: false,
            }).select(
              "profilePicture name email phoneNumber countryCode countryCallingCode "
            );

            return {
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
              isActive: service.isActive,
              teamMembers: teamMembers.map((tm) => ({
                memberId: tm._id,
                name: tm.name,
                profilePicture: tm.profilePicture,
                email: tm.email,
                phoneNumber: tm.phoneNumber,
                countryCode: tm.countryCode,
                countryCallingCode: tm.countryCallingCode,
                _id: tm._id,
              })),
            };
          })
        );

        categoryAndServices.push({
          _id: category._id,
          name: category.name,
          description: category.description,
          services: serviceWithTeamMembers,
        });
      }
    }

    const packages = await Package.find({
      businessId: businessId,
      isDeleted: false,
      isActive: true,
    }).sort({ name: 1 });

    if (!businessProfile) {
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
    return successResponse(res, "Business Profile fetched Successfully.", {
      businessProfile: {
        ...businessProfile.toObject(),
        isFavourite, // <-- include the key here
      },
      categoryAndServices,
      packages,
    });
  } catch (error: any) {
    console.error("Error fetching business profile:", error);
    return errorResponseHandler(
      "Failed to fetch business profile",
      httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
  }
};

export const getTeamMembersByServices = async (req: Request, res: Response) => {
  try {
    const idsParam = req.query.ids;
    const ids = typeof idsParam === "string" ? idsParam.split(",") : [];

    if (!ids || ids.length === 0) {
      return errorResponseHandler(
        "Service IDs are required to get Team Members.",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const services = (await Service.find({ _id: { $in: ids } }).populate(
      "teamMembers"
    )) as Array<typeof Service.prototype>;

    // Check if all requested IDs were found
    const foundServiceIds = services.map((service) =>
      (service._id as mongoose.Types.ObjectId).toString()
    );
    const notFoundIds = ids.filter((id) => !foundServiceIds.includes(id));

    if (notFoundIds.length > 0) {
      return errorResponseHandler(
        `Services not found for IDs: ${notFoundIds.join(", ")}`,
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    const returnServices = services.map((service) => ({
      service: {
        _id: service._id,
        name: service.name,
      },
      teamMember: service.teamMembers,
    }));

    return successResponse(
      res,
      "Services with Team Members fetched successfully.",
      returnServices
    );
  } catch (error: any) {
    console.error("Error fetching business services:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
  }
};

export const addFavouriteBusiness = async (req: Request, res: Response) => {
  try {
    const { clientId, businessId } = req.body;

    // Validate input
    if (!clientId || !businessId) {
      return errorResponseHandler(
        "clientId and businessId are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (
      !mongoose.Types.ObjectId.isValid(clientId) ||
      !mongoose.Types.ObjectId.isValid(businessId)
    ) {
      return res.status(404).json({
        success: false,
        message: "Client or Business not found",
      });
    }

    // Find the client
    const client = await RegisteredClient.findById(clientId);
    if (!client) {
      return errorResponseHandler(
        "Client not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Find the business
    const business = await UserBusinessProfile.findById(businessId);
    if (!business) {
      return errorResponseHandler(
        "Business not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Check if already in favourites
    const favIndex = client.favouriteBusinesses.findIndex(
      (fav: any) => fav.businessId.toString() === businessId
    );

    let action = "";
    if (favIndex !== -1) {
      // If present, remove it (un-favourite)
      client.favouriteBusinesses.splice(favIndex, 1);
      action = "removed";
    } else {
      // If not present, add it (favourite)
      client.favouriteBusinesses.push({
        businessId: business._id,
        name: business.businessName,
      });
      action = "added";
    }
    await client.save();

    return successResponse(res, `Business ${action} to favourites`, {
      favouriteBusinesses: client.favouriteBusinesses,
      action,
    });
  } catch (error: any) {
    console.error("Error updating favourite business:", error);
    return errorResponseHandler(
      error.message || "Internal server error",
      httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
  }
};

export const getFavouriteBusinesses = async (req: Request, res: Response) => {
  try {
    // Get clientId from token
    const { clientId } = req.params;

    if (!clientId || !mongoose.Types.ObjectId.isValid(clientId)) {
      return errorResponseHandler(
        "Invalid or missing clientId",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    // Find the client and get favouriteBusinesses array
    const client = await RegisteredClient.findById(clientId);
    if (!client) {
      return errorResponseHandler(
        "Client not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    const favouriteBusinessIds = client.favouriteBusinesses.map(
      (fav: any) => fav.businessId
    );

    if (!favouriteBusinessIds.length) {
      return successResponse(res, "No favourite businesses found", []);
    }

    // Fetch business details for all favourite businesses
    const businesses = await UserBusinessProfile.find({
      _id: { $in: favouriteBusinessIds },
      isDeleted: false,
      status: "active",
    }).select(
      "_id businessName email businessProfilePic businessDescription PhoneNumber countryCode countryCallingCode address"
    );

    // Format response as requested
    const formatted = businesses.map((b) => ({
      _id: b._id,
      name: b.businessName,
      email: b.email,
      profilePic: b.businessProfilePic,
      description: b.businessDescription,
      phoneNumber: b.PhoneNumber,
      countryCode: b.countryCode,
      callingCountryCode: b.countryCallingCode,
      address: b.address,
    }));

    return successResponse(
      res,
      "Favourite businesses fetched successfully",
      formatted
    );
  } catch (error: any) {
    return errorResponseHandler(
      error.message || "Internal server error",
      httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
  }
};
