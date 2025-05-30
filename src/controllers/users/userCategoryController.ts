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

    const query = buildCategorySearchQuery(businessId, search);

    const totalCategories = await Category.countDocuments(query);
    
    const categories = await Category.find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit);

    const businessProfile = await UserBusinessProfile.findOne({
      _id: businessId,
      isDeleted: false
    });

    const globalCategories = businessProfile?.selectedCategories || [];
    
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

export const deleteCategory = async (req: Request, res: Response) => {
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
        "Cannot delete global category. Global categories can only be removed from your business profile settings.",
        httpStatusCode.FORBIDDEN,
        res
      );
    }
    
    // Continue with regular category deletion
    const existingCategory = await validateCategoryAccess(categoryId, businessId, res, session);
    if (!existingCategory) return;

    const servicesUsingCategory = await Service.countDocuments({
      categoryId: categoryId,
      businessId: businessId,
      isDeleted: false
    }).session(session);

    if (servicesUsingCategory > 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Cannot delete category because it has services associated with it. Please delete or reassign those services first.",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    await Category.findByIdAndUpdate(
      categoryId,
      { $set: { isDeleted: true } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Category deleted successfully");
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

    const categories = await Category.find({
      businessId: businessId,
      isActive: true,
      isDeleted: false
    }).sort({ name: 1 });
    
    // Add global categories from business profile
    const globalCategories = business.selectedCategories || [];
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
