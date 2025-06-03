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
import ClientAppointment from "models/clientAppointment/clientAppointmentSchema";
import Service from "models/services/servicesSchema";

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
      serviceIds,
      packageId,
      discount
    } = req.body;
    
    if (!validateRequiredAppointmentFields(
      clientId, teamMemberId, startDate, startTime, serviceIds
    )) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Client, team member, date, time, and services are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const businessId = await validateBusinessProfile(userId, res, session);
    if (!businessId) return;
    
    // Get the category from the first service
    const service = await Service.findById(serviceIds[0]);
    if (!service) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Service not found",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const categoryId = service.categoryId;
    
    // Check if the team member is available at the requested time
    const finalEndTime = endTime || await calculateEndTimeFromServices(startTime, serviceIds);
    
    // Pass clientId to check for duplicate bookings by the same client
    const isAvailable = await isTimeSlotAvailable(
      teamMemberId,
      new Date(startDate),
      new Date(endDate || startDate),
      startTime,
      finalEndTime,
      clientId
    );
    
    if (!isAvailable) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Selected time slot is not available. Either the team member already has an appointment at this time or this client already has a booking for this time slot.",
        httpStatusCode.CONFLICT,
        res
      );
    }

    const validationResult = await validateAppointmentEntities(
      clientId,
      teamMemberId,
      categoryId.toString(), // Use the category from the service
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
    
    // Check if this appointment was created by a client
    // First, check if the createdVia field exists and equals "client_booking"
    // If not, check if there's a corresponding client appointment with the same appointmentId
    let isClientBooking = existingAppointment.createdVia === "client_booking";
    
    if (!isClientBooking) {
      // Double-check by looking for a matching client appointment
      const clientAppointment = await ClientAppointment.findOne({
        appointmentId: existingAppointment.appointmentId,
        isDeleted: false
      });
      
      isClientBooking = !!clientAppointment;
    }
    
    // For client bookings, only allow status updates and cancellation
    if (isClientBooking) {
      const { status, cancellationReason } = req.body;
      
      // Only allow status updates to "cancelled" or other non-structural changes
      if (req.body.teamMemberId || req.body.categoryId || req.body.serviceIds || 
          req.body.startDate || req.body.endDate || req.body.startTime || req.body.endTime) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Cannot modify core appointment details for client bookings. You can only update the status or cancel the appointment.",
          httpStatusCode.FORBIDDEN,
          res
        );
      }
      
      // If cancelling, update both business and client appointment records
      if (status === "CANCELLED") {
        // Update business appointment
        await Appointment.findByIdAndUpdate(
          appointmentId,
          {
            $set: {
              status: "CANCELLED",
              cancellationReason: cancellationReason || "Cancelled by business",
              cancellationDate: new Date(),
              cancellationBy: "business",
              updatedBy: new mongoose.Types.ObjectId(userId)
            }
          },
          { session }
        );
        
        // Find and update corresponding client appointment
        const clientAppointment = await ClientAppointment.findOne({
          appointmentId: existingAppointment.appointmentId,
          isDeleted: false
        });
        
        if (clientAppointment) {
          await ClientAppointment.findByIdAndUpdate(
            clientAppointment._id,
            {
              $set: {
                status: "CANCELLED",
                cancellationReason: cancellationReason || "Cancelled by business",
                cancellationDate: new Date(),
                cancellationBy: "business"
              }
            },
            { session }
          );
        }
        
        const updatedAppointment = await Appointment.findById(appointmentId).session(session);
        
        await session.commitTransaction();
        session.endSession();
        
        return successResponse(
          res,
          "Appointment cancelled successfully",
          { appointment: updatedAppointment }
        );
      }
      
      // For non-cancellation status updates
      const allowedUpdates = {
        status: status,
        updatedBy: new mongoose.Types.ObjectId(userId)
      };
      
      await Appointment.findByIdAndUpdate(
        appointmentId,
        { $set: allowedUpdates },
        { session }
      );
      
      // Update client appointment status if it exists
      if (status) {
        const clientAppointment = await ClientAppointment.findOne({
          appointmentId: existingAppointment.appointmentId,
          isDeleted: false
        });
        
        if (clientAppointment) {
          await ClientAppointment.findByIdAndUpdate(
            clientAppointment._id,
            { $set: { status: status } },
            { session }
          );
        }
      }
      
      const updatedAppointment = await Appointment.findById(appointmentId).session(session);
      
      await session.commitTransaction();
      session.endSession();
      
      return successResponse(
        res,
        "Appointment status updated successfully",
        { appointment: updatedAppointment }
      );
    }
    
    // For business-created appointments, proceed with normal update flow
    const { teamMemberId, status, serviceIds } = req.body;
    
    // If services are being updated, get the category from the first service
    let categoryId;
    if (serviceIds && serviceIds.length > 0) {
      const service = await Service.findById(serviceIds[0]);
      if (!service) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Service not found",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      categoryId = service.categoryId;
      req.body.categoryId = categoryId; // Add categoryId to request body
    }
    
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

// Cancel an appointment (works for both business-created and client-created appointments)
export const cancelAppointment = async (req: Request, res: Response) => {
  const session = await startSession();
  
  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;
    
    const { appointmentId } = req.params;
    const { cancellationReason } = req.body;
    
    const businessId = await validateBusinessProfile(userId, res, session);
    if (!businessId) return;
    
    const existingAppointment = await validateAppointmentAccess(appointmentId, businessId, res, session);
    if (!existingAppointment) return;
    
    if (existingAppointment.status === "CANCELLED") {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Appointment is already cancelled",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Update business appointment
    await Appointment.findByIdAndUpdate(
      appointmentId,
      {
        $set: {
          status: "CANCELLED",
          cancellationReason: cancellationReason || "Cancelled by business",
          cancellationDate: new Date(),
          cancellationBy: "business",
          updatedBy: new mongoose.Types.ObjectId(userId)
        }
      },
      { session }
    );
    
    // Check if this was a client booking
    let isClientBooking = existingAppointment.createdVia === "client_booking";
    
    // Find corresponding client appointment
    const clientAppointment = await ClientAppointment.findOne({
      appointmentId: existingAppointment.appointmentId,
      isDeleted: false
    });
    
    // If client appointment exists, update it too
    if (clientAppointment) {
      isClientBooking = true;
      await ClientAppointment.findByIdAndUpdate(
        clientAppointment._id,
        {
          $set: {
            status: "CANCELLED",
            cancellationReason: cancellationReason || "Cancelled by business",
            cancellationDate: new Date(),
            cancellationBy: "business"
          }
        },
        { session }
      );
    }
    
    const updatedAppointment = await Appointment.findById(appointmentId).session(session);
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Appointment cancelled successfully",
      { 
        appointment: updatedAppointment,
        isClientBooking: isClientBooking
      }
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

// Helper function to calculate end time based on services duration
const calculateEndTimeFromServices = async (startTime: string, serviceIds: string[]): Promise<string> => {
  // Fetch all services to get their durations
  const services = await Service.find({ _id: { $in: serviceIds } });
  
  // Calculate total duration in minutes
  const totalDuration = services.reduce((total, service) => total + (service.duration || 0), 0);
  
  // Parse start time
  const [hours, minutes] = startTime.split(':').map(Number);
  let totalMinutes = hours * 60 + minutes + totalDuration;
  
  // Calculate end time
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  
  // Format as HH:MM
  return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
};







