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
  checkDuplicateCategoryName,
  buildCategorySearchQuery,
  buildPaginationParams,
  createPaginationMetadata
} from "../../utils/user/categoryServiceUtils";
import UserBusinessProfile from "models/business/userBusinessProfileSchema";
import mongoose from "mongoose";

// Category functions
export const createCategory = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { name, description } = req.body;
    
    if (!name) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Category name is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    if (await checkDuplicateCategoryName(name, businessId, null, res, session)) return;
    
    const newCategory = await Category.create(
      [
        {
          name: name.trim(),
          description: description || "",
          businessId: businessId,
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
      "Category created successfully",
      { category: newCategory[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getAllCategories = async (req: Request, res: Response) => {
  try {
    const businessId = await validateUserAndGetBusiness(req, res);
    if (!businessId) return;

    const { page, limit, skip } = buildPaginationParams(req);
    const search = req.query.search as string;

    // Update query to only include active categories
    const query = {
      ...buildCategorySearchQuery(businessId, search),
      isActive: true
    };

    const totalCategories = await Category.countDocuments(query);
    
    const categories = await Category.find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit);

    const businessProfile = await UserBusinessProfile.findOne({
      _id: businessId,
      isDeleted: false
    });

    // Only include active global categories
    const globalCategories = businessProfile?.selectedCategories?.filter(gc => gc.isActive) || [];
    
    // Get the global category IDs
    const globalCategoryIds = globalCategories.map(gc => gc.categoryId);
    
    // Fetch the full details of global categories from GlobalCategory collection
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
    
    // Format global categories with descriptions from the GlobalCategory collection
    const formattedGlobalCategories = globalCategories.map(gc => {
      const globalCatDetails = globalCategoryMap.get(gc.categoryId.toString());
      return {
        _id: gc.categoryId,
        name: gc.name,
        description: globalCatDetails?.description || "",
        icon: globalCatDetails?.icon || "",
        businessId: businessId,
        isActive: gc.isActive,
        isDeleted: false,
        isGlobal: true
      };
    });

    const allCategories = [...categories, ...formattedGlobalCategories];

    const pagination = createPaginationMetadata(totalCategories + formattedGlobalCategories.length, page, limit);

    return successResponse(res, "Categories fetched successfully", {
      categories: allCategories,
      pagination
    });
  } catch (error: any) {
    console.error("Error fetching categories:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const getCategoryById = async (req: Request, res: Response) => {
  try {
    const businessId = await validateUserAndGetBusiness(req, res);
    if (!businessId) return;

    const { categoryId } = req.params;
    
    // Check if this is a regular category
    const category = await Category.findOne({
      _id: categoryId,
      businessId: businessId,
      isDeleted: false
    });
    
    if (category) {
      return successResponse(res, "Category fetched successfully", { 
        category,
        isGlobal: false 
      });
    }
    
    // If not found as regular category, check if it's a global category
    const businessProfile = await UserBusinessProfile.findOne({
      _id: businessId,
      "selectedCategories.categoryId": categoryId,
      isDeleted: false
    });
    
    if (!businessProfile) {
      return errorResponseHandler(
        "Category not found or you don't have access to it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Find the global category in the business profile
    const globalCatInfo = businessProfile.selectedCategories.find(
      cat => cat.categoryId.toString() === categoryId
    );
    
    // Get full global category details
    const globalCategory = await mongoose.model("GlobalCategory").findOne({
      _id: categoryId,
      isActive: true,
      isDeleted: false
    });
    
    if (!globalCategory) {
      return errorResponseHandler(
        "Global category not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Format the global category to match the expected structure
    const formattedGlobalCategory = {
      _id: globalCategory._id,
      name: globalCategory.name,
      description: globalCategory.description || "",
      icon: globalCategory.icon || "",
      businessId: businessId,
      isActive: globalCatInfo?.isActive || true,
      isDeleted: false,
      isGlobal: true
    };
    
    return successResponse(res, "Global category fetched successfully", { 
      category: formattedGlobalCategory 
    });
  } catch (error: any) {
    console.error("Error fetching category:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { categoryId } = req.params;
    
    // Check if this is a global category
    const businessProfile = await UserBusinessProfile.findOne({
      _id: businessId,
      "selectedCategories.categoryId": categoryId,
      isDeleted: false
    }).session(session);
    
    if (businessProfile) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Cannot update global category. Global categories can only be modified by administrators.",
        httpStatusCode.FORBIDDEN,
        res
      );
    }
    
    // Continue with regular category update
    const existingCategory = await validateCategoryAccess(categoryId, businessId, res, session);
    if (!existingCategory) return;

    const { name, description, isActive } = req.body;
    
    const updateData: any = {};
    if (name) {
      if (name.trim() !== (existingCategory as any).name) {
        if (await checkDuplicateCategoryName(name, businessId, categoryId, res, session)) return;
      }
      updateData.name = name.trim();
    }
    
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updatedCategory = await Category.findByIdAndUpdate(
      categoryId,
      { $set: updateData },
      { new: true, session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Category updated successfully", { category: updatedCategory });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const deleteCategories = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { categoryIds } = req.body;

    if (!categoryIds || !Array.isArray(categoryIds) || categoryIds.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Please provide an array of category IDs",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // First check if any of the categories are global categories
    for (const categoryId of categoryIds) {
      if (!(await validateObjectId(categoryId, "Category", res, session))) {
        return; // validateObjectId already handles the error response
      }
      
      // Check if this is a global category
      const businessProfile = await UserBusinessProfile.findOne({
        _id: businessId,
        "selectedCategories.categoryId": categoryId,
        isDeleted: false
      }).session(session);
      
      if (businessProfile) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          `Cannot delete global category (ID: ${categoryId}). Global categories can only be removed from your business profile settings.`,
          httpStatusCode.FORBIDDEN,
          res
        );
      }
    }

    // Then validate access to all categories before making any changes
    const categoriesToDeactivate = [];
    
    for (const categoryId of categoryIds) {
      const existingCategory = await validateCategoryAccess(categoryId, businessId, res, session);
      if (!existingCategory) return; // validateCategoryAccess already handles the error response
      
      categoriesToDeactivate.push({
        id: categoryId,
        name: (existingCategory as any).name
      });
    }

    // Now deactivate all categories and their services
    const deactivatedCategories = [];
    let totalServicesDeactivated = 0;
    
    for (const category of categoriesToDeactivate) {
      // Set category to inactive instead of deleted
      await Category.findByIdAndUpdate(
        category.id,
        { $set: { isActive: false } },
        { session }
      );

      // Set all services in this category to inactive
      const result = await Service.updateMany(
        {
          categoryId: category.id,
          businessId: businessId,
          isDeleted: false
        },
        { $set: { isActive: false } },
        { session }
      );

      deactivatedCategories.push({
        id: category.id,
        name: category.name,
        servicesDeactivated: result.modifiedCount
      });
      
      totalServicesDeactivated += result.modifiedCount;
    }

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Categories and related services deactivated successfully", {
      deactivatedCategories,
      totalServicesDeactivated
    });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getBusinessCategories = async (req: Request, res: Response) => {
  try {
    const { businessId } = req.params;

    if (!(await validateObjectId(businessId, "Business", res))) return;

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

    // Only fetch active categories
    const categories = await Category.find({
      businessId: businessId,
      isActive: true,
      isDeleted: false
    }).sort({ name: 1 });
    
    // Only include active global categories
    const globalCategories = business.selectedCategories?.filter(gc => gc.isActive) || [];
    
    const formattedGlobalCategories = globalCategories.map(gc => ({
      _id: gc.categoryId,
      name: gc.name,
      description: "",
      businessId: businessId,
      isActive: gc.isActive,
      isDeleted: false,
      isGlobal: true
    }));
    
    const allCategories = [...categories, ...formattedGlobalCategories];

    return successResponse(res, "Business categories fetched successfully", {
      categories: allCategories
    });
  } catch (error: any) {
    console.error("Error fetching business categories:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};
