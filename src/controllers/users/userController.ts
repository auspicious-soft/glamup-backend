import { Request, Response } from 'express';
import { httpStatusCode } from '../../lib/constant';
import { successResponse } from '../../utils/userAuth/signUpAuth';
import { errorResponseHandler, errorParser } from '../../lib/errors/error-response-handler';
import UserBusinessProfile from '../../models/business/userBusinessProfileSchema';
import Service from '../../models/services/servicesSchema';
import mongoose from 'mongoose';


export const getAllServices = async (req: Request, res: Response) => {
  try {
    const services = await Service.find({ isActive: true }).sort({ name: 1 });
    return successResponse(
      res,
      "Services fetched successfully",
      { services }
    );
  } catch (error: any) {
    console.error("Error fetching services:", error);
    return errorResponseHandler(
      "Failed to fetch services",
      httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
  }
};


export const createBusinessProfile = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  
  try {
    let userId: string;
    if (typeof req.user === "string") {
      userId = req.user;
    } else if (req.user && typeof req.user === "object" && "id" in req.user) {
      userId = (req.user as any).id;
    } else {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler("Invalid user authentication", httpStatusCode.UNAUTHORIZED, res);
    }
    const { 
      businessName,
      businessDescription,
      phoneNumber,
      countryCode,
      websiteLink,
      businessProfilePic,
      address,
      selectedServices,
      businessHours
    } = req.body;
    
    if (!businessName) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler("Business name is required", httpStatusCode.BAD_REQUEST, res);
    }
    const existingBusiness = await UserBusinessProfile.findOne({ 
      ownerId: userId, 
      isDeleted: false 
    }).session(session);
    
    if (existingBusiness) {
      await session.abortTransaction();
      session.endSession();
      return res.status(httpStatusCode.BAD_REQUEST).json({
        success: false,
        message: "You already have a business profile"
      });
    }
    
    const processedServices = [];
    
    if (selectedServices && Array.isArray(selectedServices) && selectedServices.length > 0) {
      const serviceIds = selectedServices.map(service => service.serviceId);
      
      const existingServices = await Service.find({
        _id: { $in: serviceIds },
        isActive: true
      }).session(session);
      
      if (existingServices.length !== serviceIds.length) {
        await session.abortTransaction();
        session.endSession();
        return res.status(httpStatusCode.BAD_REQUEST).json({
          success: false,
          message: "One or more selected services do not exist"
        });
      }
      
      for (const service of selectedServices) {
        const existingService = existingServices.find(s => s._id.toString() === service.serviceId);
        
        if (existingService) {
          processedServices.push({
            serviceId: existingService._id,
            name: existingService.name,
            description: service.description || existingService.description,
            isActive: true
          });
        }
      }
    }
    
    const newBusinessProfile = await UserBusinessProfile.create([{
      businessName,
      businessDescription: businessDescription,
      PhoneNumber: phoneNumber,
      countryCode: countryCode,
      websiteLink: websiteLink,
      businessProfilePic: businessProfilePic,
      address: address,
      selectedServices: processedServices,
      businessHours: businessHours,
      ownerId: userId,
      status: "active"
    }], { session });
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Business profile created successfully",
      { businessProfile: newBusinessProfile[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {

    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    
    console.error("Error creating business profile:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};


export const getAllBusinessProfiles = async (req: Request, res: Response) => {
  try {
    // Fetch all active business profiles
    const businessProfiles = await UserBusinessProfile.find({ 
      isDeleted: false,
      status: "active"
    }).select(
      'businessName businessProfilePic PhoneNumber countryCode businessDescription selectedServices'
    ).sort({ createdAt: -1 });
    
    return successResponse(
      res,
      "Business profiles fetched successfully",
      { businessProfiles }
    );
  } catch (error: any) {
    console.error("Error fetching business profiles:", error);
    return errorResponseHandler(
      "Failed to fetch business profiles",
      httpStatusCode.INTERNAL_SERVER_ERROR,
      res
    );
  }
};
