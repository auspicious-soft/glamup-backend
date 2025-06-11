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
  validateUserAuth,
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
import mongoose from "mongoose";
import TeamMember from "models/team/teamMemberSchema";
import User from "models/user/userSchema";
import RegisteredTeamMember from "models/registeredTeamMember/registeredTeamMemberSchema";
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

    const businessProfile = await UserBusinessProfile.findOne({
      _id: businessId,
      "selectedCategories.categoryId": categoryId,
      isDeleted: false
    }).session(session);
    
    let isGlobalCategory = false;
    let categoryName = "";
    
    if (businessProfile && businessProfile.selectedCategories.some(cat => cat.categoryId.toString() === categoryId)) {
      isGlobalCategory = true;
      const globalCategory = businessProfile.selectedCategories.find(
        cat => cat.categoryId.toString() === categoryId
      );
      categoryName = globalCategory ? globalCategory.name : "";
    } else {
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
          isGlobalCategory: isGlobalCategory,
          isActive: true,
          isDeleted: false
        }
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    const service = newService[0];
    const responseService = service.toObject();
    
    if (service.teamMembers && service.teamMembers.length > 0) {
      const teamMemberIds = service.teamMembers.map(member => member.memberId);
      
      const teamMembersData = await TeamMember.find(
        {
          _id: { $in: teamMemberIds },
          businessId: businessId,
          isDeleted: false
        },
        {
          name: 1,
          email: 1,
          phoneNumber: 1,
          countryCode: 1,
          countryCallingCode: 1,
          profilePicture: 1,
          gender: 1,
          specialization: 1,
          role: 1
        }
      );
      
      const teamMemberMap = new Map();
      teamMembersData.forEach(member => {
        teamMemberMap.set(member._id.toString(), member);
      });
      
      const enhancedTeamMembers = service.teamMembers.map(member => {
        const memberData = teamMemberMap.get(member.memberId.toString());
        if (memberData) {
          return {
            _id: memberData._id.toString(),
            name: memberData.name,
            email: memberData.email,
            phoneNumber: memberData.phoneNumber || "",
            countryCode: memberData.countryCode || "",
            countryCallingCode: memberData.countryCallingCode || "",
            profilePicture: memberData.profilePicture || "",
            gender: memberData.gender || "",
            specialization: memberData.specialization || "",
            role: memberData.role || "staff"
          };
        }
        return {
          _id: member.memberId.toString(),
          name: member.name || ""
        };
      });
      
      (responseService as any).teamMembers = enhancedTeamMembers;
    }

    return successResponse(
      res,
      "Service created successfully",
      { service: responseService },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getAllServices = async (req: Request, res: Response) => {
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
    
    const query = buildServiceSearchQuery(businessId, search, categoryId);
    
    const totalServices = await Service.countDocuments(query);
    
    const services = await Service.find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit);
    
    // Get all team members for this business with only the needed fields
    const allTeamMembers = await TeamMember.find(
      {
        businessId: businessId,
        isDeleted: false
      },
      {
        name: 1,
        email: 1,
        phoneNumber: 1,
        countryCode: 1,
        countryCallingCode: 1,
        profilePicture: 1,
        gender: 1,
        specialization: 1,
        role: 1
      }
    );
    
    // Create a map for quick team member lookup
    const teamMemberMap = new Map();
    allTeamMembers.forEach(member => {
      teamMemberMap.set(member._id.toString(), member);
    });
    
    // Enhance services with team member details
    const enhancedServices = services.map(service => {
      const enhancedService = service.toObject();
      
      if (service.teamMembers && service.teamMembers.length > 0) {
        enhancedService.teamMembers = service.teamMembers.map(member => ({
          memberId: member.memberId,
          name: member.name || ""
        }));
      }
      
      return enhancedService;
    });
    
    // Create pagination metadata
    const paginationMeta = createPaginationMetadata(page, limit, totalServices);

    return successResponse(res, "Services fetched successfully", {
      services: enhancedServices,
      pagination: paginationMeta
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

    // Enhance service with team member details if it has team members
    let enhancedService = service.toObject();
    
    if (service.teamMembers && service.teamMembers.length > 0) {
      // Get team member IDs
      const teamMemberIds = service.teamMembers.map(member => member.memberId);
      
      // Fetch team member details
      const teamMembers = await TeamMember.find(
        {
          _id: { $in: teamMemberIds },
          businessId: businessId,
          isDeleted: false
        },
        {
          name: 1,
          email: 1,
          phoneNumber: 1,
          countryCode: 1,
          countryCallingCode: 1,
          profilePicture: 1,
          gender: 1,
          specialization: 1,
          role: 1
        }
      );
      
      // Create a map for quick lookup
      const teamMemberMap = new Map();
      teamMembers.forEach(member => {
        teamMemberMap.set(member._id.toString(), member);
      });
      
      // Replace team member IDs with only memberId and name to match TeamMemberService interface
      enhancedService.teamMembers = service.teamMembers.map(member => ({
        memberId: member.memberId,
        name: member.name || ""
      }));
    }
    return successResponse(res, "Service fetched successfully", {
      service: enhancedService
    });
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

    // Check if the service is inactive
    if (!(existingService as any).isActive) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "This service is inactive and cannot be updated. Please activate the service first.",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

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
      
      // Check if the category is active
      if (!(category as any).isActive) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Cannot assign service to an inactive category",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      
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

    // Get regular categories - only active ones
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

    // Get global categories - only active ones
    const globalCategories = businessProfile?.selectedCategories?.filter(gc => gc.isActive) || [];
    
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
    
    // Get all team members for this business with only the needed fields
    const allTeamMembers = await TeamMember.find(
      {
        businessId: businessId,
        isDeleted: false
      },
      {
        name: 1,
        email: 1,
        phoneNumber: 1,
        countryCode: 1,
        countryCallingCode: 1,
        profilePicture: 1,
        gender: 1,
        specialization: 1,
        role: 1
      }
    );
    
    // Create a map for quick team member lookup
    const teamMemberMap = new Map();
    allTeamMembers.forEach(member => {
      teamMemberMap.set(member._id.toString(), member);
    });
    
    // Function to enhance service with essential team member data
    const enhanceServiceWithTeamMembers = (service : any) => {
      const enhancedService = service.toObject ? service.toObject() : {...service};
      
      if (enhancedService.teamMembers && enhancedService.teamMembers.length > 0) {
        interface EnhancedTeamMember {
          _id: string;
          name: string;
          email?: string;
          phoneNumber?: string;
          countryCode?: string;
          countryCallingCode?: string;
          profilePicture?: string;
          gender?: string;
          specialization?: string;
          role?: string;
        }

        interface OriginalTeamMember {
          memberId: mongoose.Types.ObjectId | string;
          name?: string;
        }

        enhancedService.teamMembers = (enhancedService.teamMembers as OriginalTeamMember[]).map((member: OriginalTeamMember): EnhancedTeamMember => {
          const memberData = teamMemberMap.get(member.memberId.toString());
          if (memberData) {
            // Return only essential team member details with _id instead of memberId
            return {
              _id: memberData._id.toString(),
              name: memberData.name,
              email: memberData.email,
              phoneNumber: memberData.phoneNumber || "",
              countryCode: memberData.countryCode || "",
              countryCallingCode: memberData.countryCallingCode || "",
              profilePicture: memberData.profilePicture || "",
              gender: memberData.gender || "",
              specialization: memberData.specialization || "",
              role: memberData.role || "staff"
            };
          }
          // If member not found, return original with _id instead of memberId
          return {
            _id: member.memberId.toString(),
            name: member.name || ""
          };
        });
      }
      
      return enhancedService;
    };
    
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
        
        // Enhance services with essential team member data
        const enhancedServices = services.map(enhanceServiceWithTeamMembers);

        return {
          _id: category._id,
          name: category.name,
          description: category.description,
          isGlobal: false,
          services: enhancedServices
        };
      })
    );
    
    const globalCategoriesWithServices = await Promise.all(
      globalCategories.map(async (globalCat) => {
        // Only get active services
        const services = await Service.find({
          categoryId: globalCat.categoryId,
          businessId: businessId,
          isActive: true,
          isDeleted: false
        }).sort({ name: 1 });
        
        // Enhance services with essential team member data
        const enhancedServices = services.map(enhanceServiceWithTeamMembers);
        
        // Get global category details
        const globalCatDetails = globalCategoryMap.get(globalCat.categoryId.toString());

        return {
          _id: globalCat.categoryId,
          name: globalCat.name,
          description: globalCatDetails?.description || "",
          icon: globalCatDetails?.icon || "",
          isGlobal: true,
          services: enhancedServices
        };
      })
    );
    
    // Include all categories, even those with no services
    const allCategoriesWithServices = [
      ...regularCategoriesWithServices,
      ...globalCategoriesWithServices
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



