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
    
    // Check for duplicate category name
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

    // Build query for category search
    const query = buildCategorySearchQuery(businessId, search);

    // Get total count for pagination
    const totalCategories = await Category.countDocuments(query);
    
    // Get categories with pagination
    const categories = await Category.find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit);

    // Create pagination metadata
    const pagination = createPaginationMetadata(totalCategories, page, limit);

    return successResponse(res, "Categories fetched successfully", {
      categories,
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
    
    const category = await validateCategoryAccess(categoryId, businessId, res);
    if (!category) return;

    return successResponse(res, "Category fetched successfully", { category });
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
    
    const existingCategory = await validateCategoryAccess(categoryId, businessId, res, session);
    if (!existingCategory) return;

    const { name, description, isActive } = req.body;
    
    // Build update object
    const updateData: any = {};
    if (name) {
      // Check for duplicate name if name is being changed
      if (name.trim() !== (existingCategory as any).name) {
        if (await checkDuplicateCategoryName(name, businessId, categoryId, res, session)) return;
      }
      updateData.name = name.trim();
    }
    
    if (description !== undefined) updateData.description = description;
    if (isActive !== undefined) updateData.isActive = isActive;

    // Update the category
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
    
    const existingCategory = await validateCategoryAccess(categoryId, businessId, res, session);
    if (!existingCategory) return;

    // Check if there are any active services using this category
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

    // Soft delete the category
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

