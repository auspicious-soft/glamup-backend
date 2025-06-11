import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import { successResponse } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import GlobalCategory from "../../models/globalCategory/globalCategorySchema";
import { startSession } from "../../utils/user/usercontrollerUtils";
import mongoose from "mongoose";
import UserBusinessProfile from "models/business/userBusinessProfileSchema";

// Create a new global category (admin only)
export const createGlobalCategory = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const { name, description, icon } = req.body;
    
    if (!name) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Category name is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Check for duplicate category name
    const existingCategory = await GlobalCategory.findOne({ 
      name: new RegExp(`^${name.trim()}$`, 'i'),
      isDeleted: false 
    });
    
    if (existingCategory) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "A global category with this name already exists",
        httpStatusCode.CONFLICT,
        res
      );
    }
    
    const newCategory = await GlobalCategory.create(
      [
        {
          name: name.trim(),
          description: description || "",
          icon: icon || "",
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
      "Global category created successfully",
      { category: newCategory[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};

// Get all global categories (public access)
export const getAllGlobalCategories = async (req: Request, res: Response) => {
  try {
    const categories = await GlobalCategory.find({
      isActive: true,
      isDeleted: false
    }).sort({ name: 1 });

    return successResponse(
      res,
      "Global categories retrieved successfully",
      { categories },
      httpStatusCode.OK
    );
  } catch (error: any) {
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};

// Get a single global category by ID (public access)
export const getGlobalCategoryById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    
    const category = await GlobalCategory.findOne({
      _id: id,
      isActive: true,
      isDeleted: false
    });
    
    if (!category) {
      return errorResponseHandler(
        "Global category not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    return successResponse(
      res,
      "Global category retrieved successfully",
      { category },
      httpStatusCode.OK
    );
  } catch (error: any) {
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};

// Update a global category (admin only)
export const updateGlobalCategory = async (req: Request, res: Response) => {
  const session = await startSession();
  
  try {
    const { id } = req.params;
    const { name, description, icon, isActive } = req.body;
    
    const category = await GlobalCategory.findOne({
      _id: id,
      isDeleted: false
    });
    
    if (!category) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Global category not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Check for duplicate name if name is being updated
    if (name && name !== category.name) {
      const existingCategory = await GlobalCategory.findOne({
        name: new RegExp(`^${name.trim()}$`, 'i'),
        _id: { $ne: id },
        isDeleted: false
      });
      
      if (existingCategory) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "A global category with this name already exists",
          httpStatusCode.CONFLICT,
          res
        );
      }
    }
    
    const updatedCategory = await GlobalCategory.findByIdAndUpdate(
      id,
      {
        ...(name && { name: name.trim() }),
        ...(description !== undefined && { description }),
        ...(icon !== undefined && { icon }),
        ...(isActive !== undefined && { isActive }),
      },
      { new: true, session }
    );
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Global category updated successfully",
      { category: updatedCategory },
      httpStatusCode.OK
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};

// Delete a global category (admin only)
export const deleteGlobalCategory = async (req: Request, res: Response) => {
  const session = await startSession();
  
  try {
    const { id } = req.params;
    
    const category = await GlobalCategory.findOne({
      _id: id,
      isDeleted: false
    });
    
    if (!category) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Global category not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Soft delete the category
    await GlobalCategory.findByIdAndUpdate(
      id,
      { isDeleted: true },
      { session }
    );
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Global category deleted successfully",
      {},
      httpStatusCode.OK
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};

// Get businesses by global category IDs
export const getBusinessesByGlobalCategory = async (req: Request, res: Response) => {
  try {
    // Get categoryIds from query parameters
    const categoryIdsParam = req.query.categoryIds as string;
    
    if (!categoryIdsParam) {
      return errorResponseHandler(
        "Please provide categoryIds as a query parameter",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Parse the comma-separated string into an array
    const categoryIds = categoryIdsParam.split(',');
    
    if (categoryIds.length === 0) {
      return errorResponseHandler(
        "Please provide at least one category ID",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const invalidIds = categoryIds.filter(id => !mongoose.Types.ObjectId.isValid(id));
    if (invalidIds.length > 0) {
      return errorResponseHandler(
        "Invalid category ID format detected",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const globalCategories = await GlobalCategory.find({
      _id: { $in: categoryIds },
      isActive: true,
      isDeleted: false
    });
    
    if (globalCategories.length === 0) {
      return errorResponseHandler(
        "No valid global categories found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const skip = (page - 1) * limit;
    
    const query = {
      "selectedCategories.categoryId": { $in: categoryIds },
      isDeleted: false,
      status: "active"
    };
    
    const totalBusinesses = await UserBusinessProfile.countDocuments(query);
    
    const businessProfiles = await UserBusinessProfile.find(query)
      .select(
        "businessName businessProfilePic PhoneNumber countryCode email businessDescription " +
        "websiteLink facebookLink instagramLink messengerLink country "
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);
    
    const totalPages = Math.ceil(totalBusinesses / limit);
    
    return successResponse(
      res,
      "Business profiles fetched successfully",
      { 
        categories: globalCategories.map(cat => ({
          _id: cat._id,
          name: cat.name,
          description: cat.description || ""
        })),
        businessProfiles,
        count: businessProfiles.length,
        pagination: {
          totalBusinesses,
          totalPages,
          currentPage: page,
          limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        }
      },
      httpStatusCode.OK
    );
  } catch (error: any) {
    console.error("Error fetching businesses by global categories:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};


