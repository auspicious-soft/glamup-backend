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
  checkDuplicateCategoryName,
  buildCategorySearchQuery,
  buildPaginationParams,
  createPaginationMetadata
} from "../../utils/user/categoryServiceUtils";
import UserBusinessProfile from "models/business/userBusinessProfileSchema";
import mongoose from "mongoose";
import User from "models/user/userSchema";
import RegisteredTeamMember from "models/registeredTeamMember/registeredTeamMemberSchema";
import { validateBusinessProfile } from "utils/appointment/appointmentUtils";
import Package from "models/package/packageSchema";

// Category functions
export const createCategory = async (req: Request, res: Response) => {
 const session = await mongoose.startSession();
  session.startTransaction();
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
          isDeleted: false,
        },
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
    await session.abortTransaction();
    session.endSession();
    return handleTransactionError(session, error, res);
  }
};

export const getAllCategories = async (req: Request, res: Response) => {
  
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
      businessId = await validateBusinessProfile(userId, res);
      if (!businessId) return;
    }

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
    
    // Create pagination metadata
    const paginationMeta = createPaginationMetadata(page, limit, totalCategories);

    return successResponse(res, "Categories fetched successfully", {
      categories: categories,
      pagination: paginationMeta
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
      businessId = await validateBusinessProfile(userId, res);
      if (!businessId) return;
    }

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
    const categoriesToDelete = [];
    
    for (const categoryId of categoryIds) {
      const existingCategory = await validateCategoryAccess(categoryId, businessId, res, session);
      if (!existingCategory) return; // validateCategoryAccess already handles the error response
      
      categoriesToDelete.push({
        id: categoryId,
        name: (existingCategory as any).name
      });
    }

    // Now delete all categories and their services
    const deletedCategories = [];
    let totalServicesDeleted = 0;
    let totalPackagesUpdated = 0;
    
    for (const category of categoriesToDelete) {
      // Set category to deleted and inactive
      await Category.findByIdAndUpdate(
        category.id,
        { $set: { isDeleted: true, isActive: false } },
        { session }
      );

      // Get all services in this category
      const services = await Service.find({
        categoryId: category.id,
        businessId: businessId,
        isDeleted: false
      }, { _id: 1 }, { session });
      
      const serviceIds = services.map(service => service._id);

      // Set all services in this category to deleted and inactive
      const serviceResult = await Service.updateMany(
        {
          categoryId: category.id,
          businessId: businessId,
          isDeleted: false
        },
        { $set: { isDeleted: true, isActive: false } },
        { session }
      );

      const packagesWithCategory = await Package.find({
        businessId: businessId,
        isDeleted: false,
        "categories.categoryId": category.id
      }, { _id: 1 }, { session });
      
      for (const pkg of packagesWithCategory) {
        await Package.updateOne(
          { _id: pkg._id },
          { 
            $pull: { 
              categories: { categoryId: category.id },
              services: { serviceId: { $in: serviceIds } }
            } 
          },
          { session }
        );
      }
      
      const packagesWithServices = await Package.find({
        businessId: businessId,
        isDeleted: false,
        "services.serviceId": { $in: serviceIds }
      }, { _id: 1 }, { session });
      
      for (const pkg of packagesWithServices) {
        await Package.updateOne(
          { _id: pkg._id },
          { 
            $pull: { 
              services: { serviceId: { $in: serviceIds } }
            } 
          },
          { session }
        );
      }
      
      const uniquePackageIds = new Set([
        ...packagesWithCategory.map((p) => (p._id as mongoose.Types.ObjectId).toString()),
        ...packagesWithServices.map((p) => (p._id as mongoose.Types.ObjectId).toString())
      ]);
      
      const packageUpdateCount = uniquePackageIds.size;
      totalPackagesUpdated += packageUpdateCount;

      deletedCategories.push({
        id: category.id,
        name: category.name,
        servicesDeleted: serviceResult.modifiedCount,
        packagesUpdated: packageUpdateCount
      });
      
      totalServicesDeleted += serviceResult.modifiedCount;
    }

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Categories and related services deleted successfully", {
      deletedCategories,
      totalServicesDeleted,
      totalPackagesUpdated
    });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getBusinessCategories = async (req: Request, res: Response) => {
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
      businessId = await validateBusinessProfile(userId, res);
      if (!businessId) return;
    }

    // Only fetch active categories
    const categories = await Category.find({
      businessId: businessId,
      isActive: true,
      isDeleted: false
    }).sort({ name: 1 });
    
    const businessProfile = await UserBusinessProfile.findOne({
      _id: businessId,
      isDeleted: false
    });
    
    // Only include active global categories
    const globalCategories = businessProfile?.selectedCategories?.filter(gc => gc.isActive) || [];
    
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

export const swapCategoryOrder = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { replacingCategoryId, replacedCategoryId } = req.body;

    if (!replacingCategoryId || !replacedCategoryId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Both replacingCategoryId and replacedCategoryId are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (!(await validateObjectId(replacingCategoryId, "Category", res, session))) return;
    if (!(await validateObjectId(replacedCategoryId, "Category", res, session))) return;

    const [replacingCategory, replacedCategory] = await Promise.all([
      Category.findOne({ _id: replacingCategoryId, businessId, isDeleted: false }).session(session),
      Category.findOne({ _id: replacedCategoryId, businessId, isDeleted: false }).session(session),
    ]);

    if (!replacingCategory || !replacedCategory) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "One or both categories not found or you don't have access",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    const replacingOriginalOrder = replacingCategory.sortingOrderNo;
    const replacedOriginalOrder = replacedCategory.sortingOrderNo;

    // Use a temporary value to avoid unique constraint violation
    const tempOrder = -1 * Date.now(); 

    replacingCategory.sortingOrderNo = tempOrder;
    await replacingCategory.save({ session });

    replacedCategory.sortingOrderNo = replacingOriginalOrder;
    await replacedCategory.save({ session });

    replacingCategory.sortingOrderNo = replacedOriginalOrder;
    await replacingCategory.save({ session });

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Category order swapped successfully", {
      updatedCategories: [
        {
          _id: replacingCategory._id,
          name: replacingCategory.name,
          sortingOrderNo: replacingCategory.sortingOrderNo,
        },
        {
          _id: replacedCategory._id,
          name: replacedCategory.name,
          sortingOrderNo: replacedCategory.sortingOrderNo,
        },
      ],
    });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return handleTransactionError(session, error, res);
  }
};