import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import { successResponse } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import Service from "../../models/services/servicesSchema";
import mongoose from "mongoose";
import {
  validateObjectId,
  startSession,
  handleTransactionError,
} from "../../utils/user/usercontrollerUtils";
import Package from "../../models/package/packageSchema";
import {
  validateUserAndGetBusiness,
  validateCategoryAccess,
  buildPaginationParams,
  createPaginationMetadata
} from "../../utils/user/categoryServiceUtils";

// Package functions
export const createPackage = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const businessId = await validateUserAndGetBusiness(req, res, session);
    if (!businessId) return;

    const { 
      name, 
      categoryId, 
      description, 
      services, 
      duration, 
      priceType, 
      price, 
      maxPrice, 
      discountPercentage,
      discountAmount,
      currency
    } = req.body;
    
    if (!name || !categoryId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Package name and category ID are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const category = await validateCategoryAccess(categoryId, businessId, res, session);
    if (!category) return;

    if (!services || !Array.isArray(services) || services.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "At least one service must be selected for the package",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const serviceIds = services.map(service => service.serviceId);
    const existingServices = await Service.find({
      _id: { $in: serviceIds },
      categoryId: categoryId,
      businessId: businessId,
      isDeleted: false
    }).session(session);

    if (existingServices.length !== serviceIds.length) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "One or more services do not exist, don't belong to the selected category, or don't belong to your business",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    const processedServices = services.map(service => {
      const existingService = existingServices.find(
        (s: any) => String(s._id) === service.serviceId
      );
      return {
        serviceId: service.serviceId,
        name: existingService?.name || '',
        duration: existingService?.duration || 0,
        price: existingService?.price || 0
      };
    });

    const totalServicesPrice = processedServices.reduce(
      (sum, service) => sum + service.price, 
      0
    );

    if (!['fixed', 'starting_from', 'range'].includes(priceType)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Price type must be one of: fixed, starting_from, range",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (price === undefined || price < 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Package price is required and must be a non-negative number",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (priceType === 'range' && (maxPrice === undefined || maxPrice <= price)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "For range price type, max price is required and must be greater than the min price",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    let finalPrice = price;
    let calculatedDiscountAmount = 0;
    let calculatedDiscountPercentage = 0;

    if (discountPercentage && discountPercentage > 0) {
      if (discountPercentage > 100) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Discount percentage cannot exceed 100%",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      calculatedDiscountPercentage = discountPercentage;
      calculatedDiscountAmount = (price * discountPercentage) / 100;
      finalPrice = price - calculatedDiscountAmount;
    } else if (discountAmount && discountAmount > 0) {
      if (discountAmount >= price) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Discount amount cannot be greater than or equal to the price",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      calculatedDiscountAmount = discountAmount;
      calculatedDiscountPercentage = (discountAmount / price) * 100;
      finalPrice = price - discountAmount;
    }

    const newPackage = await Package.create(
      [
        {
          name: name.trim(),
          categoryId: categoryId,
          categoryName: (category as any).name,
          description: description || "",
          services: processedServices,
          duration: duration || processedServices.reduce((sum, service) => sum + service.duration, 0),
          priceType: priceType,
          price: price,
          maxPrice: priceType === 'range' ? maxPrice : null,
          discountPercentage: calculatedDiscountPercentage,
          discountAmount: calculatedDiscountAmount,
          finalPrice: finalPrice,
          currency: currency || "INR",
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
      "Package created successfully",
      { 
        package: newPackage[0],
        totalServicesPrice: totalServicesPrice 
      },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getAllPackages = async (req: Request, res: Response) => {
  try {
    const businessId = await validateUserAndGetBusiness(req, res);
    if (!businessId) return;

    const { page, limit, skip } = buildPaginationParams(req);
    const search = req.query.search as string;
    const categoryId = req.query.categoryId as string;

    let query: any = { 
      businessId: businessId,
      isDeleted: false 
    };

    if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
      query.categoryId = categoryId;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { categoryName: { $regex: search, $options: "i" } }
      ];
    }

    const totalPackages = await Package.countDocuments(query);
    
    const packages = await Package.find(query)
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit);

    const pagination = createPaginationMetadata(totalPackages, page, limit);

    return successResponse(res, "Packages fetched successfully", {
      packages,
      pagination
    });
  } catch (error: any) {
    console.error("Error fetching packages:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const getPackageById = async (req: Request, res: Response) => {
  try {
    const businessId = await validateUserAndGetBusiness(req, res);
    if (!businessId) return;

    const { packageId } = req.params;
    
    if (!(await validateObjectId(packageId, "Package", res))) return;
    
    const packageItem = await Package.findOne({
      _id: packageId,
      businessId: businessId,
      isDeleted: false
    });
    
    if (!packageItem) {
      return errorResponseHandler(
        "Package not found or you don't have permission to access it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    return successResponse(res, "Package fetched successfully", { package: packageItem });
  } catch (error: any) {
    console.error("Error fetching package:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};
