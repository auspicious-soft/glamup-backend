import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import { successResponse } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import Service from "../../models/services/servicesSchema";
import Category from "../../models/category/categorySchema";
import UserBusinessProfile from "../../models/business/userBusinessProfileSchema";
import mongoose from "mongoose";
import RegisteredClient from "../../models/registeredClient/registeredClientSchema";
import TeamMember from "../../models/team/teamMemberSchema";
import { isTimeSlotAvailable } from "../../utils/appointment/appointmentUtils";
import ClientAppointment from "../../models/clientAppointment/clientAppointmentSchema";
import { startSession } from "../../utils/user/usercontrollerUtils";

// Create appointment as a client
export const createClientAppointment = async (req: Request, res: Response) => {
  const session = await startSession();
  
  try {
    const { 
      clientId, 
      businessId, 
      teamMemberId, 
      categoryId, 
      serviceIds, 
      date, 
      startTime, 
      endTime,
      notes
    } = req.body;
    
    // Validate required fields
    if (!clientId || !businessId || !teamMemberId || !categoryId || !serviceIds || !date || !startTime) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Missing required fields for appointment creation",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Check if business exists and is active
    const business = await UserBusinessProfile.findOne({
      _id: businessId,
      status: "active",
      isDeleted: false
    });
    
    if (!business) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Business profile not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Check if client exists
    const client = await RegisteredClient.findById(clientId);
    if (!client) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Client not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Check if team member exists and is active
    const teamMember = await TeamMember.findOne({
      _id: teamMemberId,
      businessId: businessId,
      isActive: true,
      isDeleted: false
    });
    
    if (!teamMember) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Team member not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Check if category exists (could be global or business-specific)
    let category;
    let isGlobalCategory = false;
    
    // Check if it's a global category
    isGlobalCategory = business.selectedCategories.some(
      cat => cat.categoryId.toString() === categoryId
    );
    
    if (isGlobalCategory) {
      const globalCat = business.selectedCategories.find(
        cat => cat.categoryId.toString() === categoryId
      );
      if (!globalCat) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Category not found",
          httpStatusCode.NOT_FOUND,
          res
        );
      }
      category = { _id: globalCat.categoryId, name: globalCat.name };
    } else {
      // Check if it's a business-specific category
      category = await Category.findOne({
        _id: categoryId,
        businessId: businessId,
        isActive: true,
        isDeleted: false
      });
      
      if (!category) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Category not found",
          httpStatusCode.NOT_FOUND,
          res
        );
      }
    }
    
    // Check if services exist and belong to the category and business
    const services = await Service.find({
      _id: { $in: serviceIds },
      categoryId: categoryId,
      businessId: businessId,
      isActive: true,
      isDeleted: false
    });
    
    if (services.length !== serviceIds.length) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "One or more services not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Check if time slot is available
    const appointmentDate = new Date(date);
    const isAvailable = await isTimeSlotAvailable(
      teamMemberId,
      appointmentDate,
      appointmentDate,
      startTime,
      endTime || calculateEndTime(startTime, services)
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
    
    // Calculate total duration and price
    const totalDuration = services.reduce((sum, service) => sum + service.duration, 0);
    const totalPrice = services.reduce((sum, service) => sum + service.price, 0);
    const finalEndTime = endTime || calculateEndTime(startTime, services);
    
    // Create appointment
    const appointmentData = {
      clientId: client._id,
      businessId: business._id,
      businessName: business.businessName,
      businessLogo: business.businessProfilePic || "",
      businessAddress: business.address
        ? [business.address.street, business.address.city, business.address.region, business.address.country]
            .filter(Boolean)
            .join(", ")
        : "",
      businessPhone: business.PhoneNumber || "",
      
      categoryId: category._id,
      categoryName: category.name,
      
      services: services.map(service => ({
        serviceId: service._id,
        name: service.name,
        duration: service.duration,
        price: service.price
      })),
      
      teamMemberId: teamMember._id,
      teamMemberName: teamMember.name,
      teamMemberProfilePic: teamMember.profilePicture || "",
      
      date: appointmentDate,
      endDate: appointmentDate,
      startTime,
      endTime: finalEndTime,
      duration: totalDuration,
      
      totalPrice,
      discount: 0,
      finalPrice: totalPrice,
      
      status: "pending",
      notes: notes || "",
      
      location: {
        type: "business"
      }
    };
    
    const newAppointment = await ClientAppointment.create([appointmentData], { session });
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Appointment created successfully",
      { appointment: newAppointment[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    console.error("Error creating client appointment:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};

// Helper function to calculate end time based on services duration
const calculateEndTime = (startTime: string, services: any[]): string => {
  const totalDuration = services.reduce((sum, service) => sum + service.duration, 0);
  
  const [hours, minutes] = startTime.split(':').map(Number);
  let totalMinutes = hours * 60 + minutes + totalDuration;
  
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  
  return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
};

// Get all appointments for a client
export const getClientAppointments = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { status, page = '1', limit = '10', sort = 'date' } = req.query;
    
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return errorResponseHandler(
        "Invalid client ID format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Check if client exists
    const client = await RegisteredClient.findById(clientId);
    if (!client) {
      return errorResponseHandler(
        "Client not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Build query
    const query: any = {
      clientId,
      isDeleted: false
    };
    
    // Add status filter if provided
    if (status) {
      if (Array.isArray(status)) {
        query.status = { $in: status };
      } else {
        query.status = status;
      }
    }
    
    // Pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;
    
    // Sorting
    let sortOption: any = { date: 1, startTime: 1 };
    if (sort === '-date') {
      sortOption = { date: -1, startTime: -1 };
    }
    
    // Get total count
    const totalAppointments = await ClientAppointment.countDocuments(query);
    
    // Get appointments
    const appointments = await ClientAppointment.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum);
    
    return successResponse(
      res,
      "Client appointments fetched successfully",
      {
        client: {
          _id: client._id,
          name: client.fullName,
          email: client.email
        },
        pagination: {
          total: totalAppointments,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(totalAppointments / limitNum)
        },
        appointments
      }
    );
  } catch (error: any) {
    console.error("Error fetching client appointments:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};

// Get appointment details by ID
export const getClientAppointmentById = async (req: Request, res: Response) => {
  try {
    const { appointmentId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      return errorResponseHandler(
        "Invalid appointment ID format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Find appointment
    const appointment = await ClientAppointment.findOne({
      _id: appointmentId,
      isDeleted: false
    });
    
    if (!appointment) {
      return errorResponseHandler(
        "Appointment not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    return successResponse(
      res,
      "Appointment details fetched successfully",
      { appointment }
    );
  } catch (error: any) {
    console.error("Error fetching appointment details:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};

// Cancel an appointment
export const cancelClientAppointment = async (req: Request, res: Response) => {
  const session = await startSession();
  
  try {
    session.startTransaction();
    
    const { appointmentId } = req.params;
    const { cancellationReason } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Invalid appointment ID format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Find appointment
    const appointment = await ClientAppointment.findOne({
      _id: appointmentId,
      isDeleted: false,
      status: { $in: ["pending", "confirmed"] }
    });
    
    if (!appointment) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Appointment not found or cannot be cancelled",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Update appointment
    appointment.status = "cancelled";
    appointment.cancellationReason = cancellationReason || "Cancelled by client";
    appointment.cancellationDate = new Date();
    appointment.cancellationBy = "client";
    
    await appointment.save({ session });
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Appointment cancelled successfully",
      { appointment }
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    console.error("Error cancelling appointment:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};

// Reschedule an appointment
export const rescheduleClientAppointment = async (req: Request, res: Response) => {
  const session = await startSession();
  
  try {
    session.startTransaction();
    
    const { appointmentId } = req.params;
    const { date, startTime, endTime, teamMemberId } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Invalid appointment ID format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    if (!date || !startTime) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Date and start time are required for rescheduling",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    // Find appointment
    const appointment = await ClientAppointment.findOne({
      _id: appointmentId,
      isDeleted: false,
      status: { $in: ["pending", "confirmed"] }
    });
    
    if (!appointment) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Appointment not found or cannot be rescheduled",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // If team member is being changed, validate
    let teamMember: any = null;
    if (teamMemberId && teamMemberId !== appointment.teamMemberId.toString()) {
      teamMember = await TeamMember.findOne({
        _id: teamMemberId,
        businessId: appointment.businessId,
        isActive: true,
        isDeleted: false
      });
      
      if (!teamMember) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Team member not found or inactive",
          httpStatusCode.NOT_FOUND,
          res
        );
      }
    }
    
    // Check if time slot is available
    const appointmentDate = new Date(date);
    const finalTeamMemberId = teamMemberId || appointment.teamMemberId;
    
    // Calculate end time if not provided
    let finalEndTime = endTime;
    if (!finalEndTime) {
      const services = appointment.services;
      const totalDuration = services.reduce((sum, service) => sum + service.duration, 0);
      
      const [hours, minutes] = startTime.split(':').map(Number);
      let totalMinutes = hours * 60 + minutes + totalDuration;
      
      const endHours = Math.floor(totalMinutes / 60) % 24;
      const endMinutes = totalMinutes % 60;
      
      finalEndTime = `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
    }
    
    const isAvailable = await isTimeSlotAvailable(
      finalTeamMemberId,
      appointmentDate,
      appointmentDate,
      startTime,
      finalEndTime,
      appointmentId
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
    
    // Create a new appointment as a copy of the old one
    const newAppointmentData = {
      ...appointment.toObject(),
      _id: undefined,
      date: appointmentDate,
      endDate: appointmentDate,
      startTime,
      endTime: finalEndTime,
      parentAppointmentId: appointment._id,
      isRescheduled: true,
      status: "pending",
      createdAt: undefined,
      updatedAt: undefined
    };
    
    if (teamMember) {
      newAppointmentData.teamMemberId = teamMember._id;
      newAppointmentData.teamMemberName = teamMember.name;
      newAppointmentData.teamMemberProfilePic = teamMember.profilePicture || "";
    }
    
    // Mark the old appointment as cancelled due to reschedule
    appointment.status = "cancelled";
    appointment.cancellationReason = "Rescheduled by client";
    appointment.cancellationDate = new Date();
    appointment.cancellationBy = "client";
    appointment.isRescheduled = true;
    
    await appointment.save({ session });
    
    // Create the new appointment
    const newAppointment = await ClientAppointment.create([newAppointmentData], { session });
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Appointment rescheduled successfully",
      { 
        oldAppointment: appointment,
        newAppointment: newAppointment[0]
      }
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    
    console.error("Error rescheduling appointment:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};

