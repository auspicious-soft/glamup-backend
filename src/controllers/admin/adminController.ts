import { Request, Response } from 'express';
import { httpStatusCode } from '../../lib/constant';
import { successResponse } from '../../utils/userAuth/signUpAuth';
import { errorResponseHandler, errorParser } from '../../lib/errors/error-response-handler';
import Service from '../../models/services/servicesSchema';

export const createService = async (req: Request, res: Response) => {
  try {
    const { name, description, category, icon } = req.body;
    
    if (!name) {
      return errorResponseHandler("Service name is required", httpStatusCode.BAD_REQUEST, res);
    }
    
    const existingService = await Service.findOne({ name: name.trim() });
    if (existingService) {
      return errorResponseHandler("Service with this name already exists", httpStatusCode.BAD_REQUEST, res);
    }
    
    const newService = await Service.create({
      name: name.trim(),
      description: description || "",
      category: category || "",
      icon: icon || "",
      isActive: true
    });
    
    return successResponse(
      res,
      "Service created successfully",
      { service: newService },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    console.error("Error creating service:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

