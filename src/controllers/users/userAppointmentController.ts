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
  prepareAppointmentData, 
  validateBusinessProfile,
  validateTeamMemberAccess,
  buildDateRangeQuery,
  buildAppointmentQuery,
  validateAppointmentAccess,
  isTeamMemberChanged,
  prepareAppointmentUpdateData,
  preparePagination,
  formatDateForResponse,
  preparePaginationMetadata,
  prepareTeamMemberResponse,
  validateRequiredAppointmentFields
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
    
    if (!validateRequiredAppointmentFields(
      clientId, teamMemberId, startDate, startTime, categoryId
    )) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Client, team member, date, time, and category are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const businessId = await validateBusinessProfile(userId, res, session);
    if (!businessId) return;
    
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

export const getAppointmentsByDate = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;
    
    const businessId = await validateBusinessProfile(userId, res);
    if (!businessId) return;
    
    const { date } = req.query;
    
    if (!date) {
      return errorResponseHandler(
        "Date is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const dateQuery = buildDateRangeQuery(date, null, null);
    
    if (dateQuery && dateQuery.error) {
      return errorResponseHandler(
        dateQuery.error,
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const queryDate = new Date(date as string);
    
    const appointments = await Appointment.find({
      businessId: businessId,
      ...dateQuery,
      isDeleted: false
    }).sort({ date: 1, startTime: 1 });
    
    return successResponse(
      res,
      "Appointments fetched successfully",
      { 
        date: formatDateForResponse(queryDate),
        count: appointments.length,
        appointments 
      }
    );
  } catch (error: any) {
    console.error("Error fetching appointments by date:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const getTeamMemberAppointments = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;
    
    const { teamMemberId } = req.params;
    
    const businessId = await validateBusinessProfile(userId, res);
    if (!businessId) return;
    
    const teamMember = await validateTeamMemberAccess(teamMemberId, businessId, res);
    if (!teamMember) return;
    
    const dateQuery = buildDateRangeQuery(
      req.query.date, 
      req.query.startDate, 
      req.query.endDate
    );
    
    if (dateQuery && dateQuery.error) {
      return errorResponseHandler(
        dateQuery.error,
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const query = buildAppointmentQuery(
      businessId,
      teamMemberId,
      req.query.clientId as string,
      req.query.categoryId as string,
      req.query.status as string,
      dateQuery
    );
    
    if (query.error) {
      return errorResponseHandler(
        query.error,
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const pagination = preparePagination(
      req.query.page as string,
      req.query.limit as string
    );
    
    const totalAppointments = await Appointment.countDocuments(query);
    
    const appointments = await Appointment.find(query)
      .sort({ date: 1, startTime: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit);
    
    const paginationMetadata = preparePaginationMetadata(
      totalAppointments,
      pagination,
      appointments
    );
    
    return successResponse(
      res,
      "Team member appointments fetched successfully",
      {
        teamMember: prepareTeamMemberResponse(teamMember),
        ...paginationMetadata,
        appointments
      }
    );
  } catch (error: any) {
    console.error("Error fetching team member appointments:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const updateAppointment = async (req: Request, res: Response) => {
  const session = await startSession();
  
  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;
    
    const { appointmentId } = req.params;
    
    const businessId = await validateBusinessProfile(userId, res, session);
    if (!businessId) return;
    
    const existingAppointment = await validateAppointmentAccess(appointmentId, businessId, res, session);
    if (!existingAppointment) return;
    
    const { teamMemberId, status } = req.body;
    
    const teamMemberChanged = isTeamMemberChanged(teamMemberId, existingAppointment);
    
    if (teamMemberChanged) {
      const updateData = prepareAppointmentUpdateData(req, existingAppointment);
      
      const isAvailable = await isTimeSlotAvailable(
        updateData.teamMemberId,
        updateData.startDate,
        updateData.endDate,
        updateData.startTime,
        updateData.endTime,
        appointmentId
      );
      
      if (!isAvailable) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Selected time slot is not available for the team member",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
    }
    
    const updateData = prepareAppointmentUpdateData(req, existingAppointment);
    
    const validationResult = await validateAppointmentEntities(
      updateData.clientId,
      updateData.teamMemberId,
      updateData.categoryId,
      updateData.serviceIds,
      updateData.startDate,
      updateData.endDate,
      undefined,
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
      null, 
      businessId,
      updateData.startDate,
      updateData.endDate,
      updateData.startTime,
      updateData.endTime,
      validationResult.totalDuration ?? existingAppointment.duration,
      validationResult.totalPrice ?? existingAppointment.totalPrice,
      existingAppointment.discount || 0,
      new mongoose.Types.ObjectId(userId)
    );
    
    await Appointment.findByIdAndUpdate(
      appointmentId,
      {
        $set: {
          ...appointmentData,
          status: status !== undefined ? status : existingAppointment.status,
          updatedBy: new mongoose.Types.ObjectId(userId)
        }
      },
      { session }
    );
    
    const updatedAppointment = await Appointment.findById(appointmentId).session(session);
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Appointment updated successfully",
      { appointment: updatedAppointment }
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};


export const getAppointmentById = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;
    
    const { appointmentId } = req.params;
    
    const businessId = await validateBusinessProfile(userId, res);
    if (!businessId) return;
    
    const appointment = await validateAppointmentAccess(appointmentId, businessId, res);
    if (!appointment) return;
    
    return successResponse(
      res,
      "Appointment fetched successfully",
      { appointment }
    );
  } catch (error: any) {
    console.error("Error fetching appointment:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

