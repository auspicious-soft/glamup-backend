import { Request, Response } from "express";
import mongoose from "mongoose";
import { httpStatusCode } from "../../lib/constant";
import { successResponse } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import Appointment from "../../models/appointment/appointmentSchema";
import { 
  validateAppointmentEntities, 
  isTimeSlotAvailable, 
  prepareAppointmentData 
} from "../../utils/appointment/appointmentUtils";
import { validateUserAuth, startSession, handleTransactionError } from "../../utils/user/usercontrollerUtils";

export const createAppointment = async (req: Request, res: Response) => {
  const session = await startSession();
  
  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;
    
    const { 
      clientId, 
      teamMemberId, 
      startDate, 
      endDate, 
      startTime, 
      endTime,
      status, 
      categoryId, 
      serviceIds,
      packageId,
      discount
    } = req.body;
    
    if (!clientId || !teamMemberId || !startDate || !startTime || !categoryId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Client, team member, date, time, and category are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const user = await mongoose.model('User').findById(userId).session(session);
    if (!user || !user.businessId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "User has no associated business",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const businessId = user.businessId;
    
    const isAvailable = await isTimeSlotAvailable(
      teamMemberId,
      new Date(startDate),
      new Date(endDate || startDate),
      startTime,
      endTime
    );
    
    if (!isAvailable) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Selected time slot is not available",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const validationResult = await validateAppointmentEntities(
      clientId,
      teamMemberId,
      categoryId,
      serviceIds || [],
      new Date(startDate),
      new Date(endDate || startDate),
      packageId,
      businessId.toString()
    );
    
    if (!validationResult.valid) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        validationResult.message || "Invalid appointment data",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const appointmentData = prepareAppointmentData(
      validationResult.client,
      validationResult.teamMember,
      validationResult.category,
      validationResult.services || [],
      validationResult.packageData,
      businessId,
      new Date(startDate),
      new Date(endDate || startDate),
      startTime,
      endTime,
      validationResult.totalDuration ?? 0,
      validationResult.totalPrice ?? 0,
      discount || 0,
      new mongoose.Types.ObjectId(userId)
    );
    
    const newAppointment = await Appointment.create(
      [appointmentData],
      { session }
    );
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Appointment created successfully",
      { appointment: newAppointment[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};