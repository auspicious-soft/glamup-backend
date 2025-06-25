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
import Appointment from "models/appointment/appointmentSchema";
import { customAlphabet } from "nanoid";

// Create a nanoid generator for appointment IDs
const appointmentId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 10);

// Create appointment as a client
export const createClientAppointment = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();
    
    const { 
      clientId, 
      businessId, 
      teamMemberId, 
      serviceIds, 
      date, 
      startTime, 
      endTime,
      notes
    } = req.body;
    
    // Validate required fields (categoryId removed)
    if (!clientId || !businessId || !teamMemberId || !serviceIds || !date || !startTime) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Missing required fields for appointment creation",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
    const appointmentDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (appointmentDate < today) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Cannot book appointments for past dates",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    
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
    
    // Check if services exist and belong to the business (category check removed)
    const services = await Service.find({
      _id: { $in: serviceIds },
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
    
    // Generate a unique appointment ID to link both records
    const uniqueAppointmentId = generateAppointmentId();
    
    // Create client appointment (categoryId/categoryName removed)
    const clientAppointmentData = {
      appointmentId: uniqueAppointmentId,
      clientId: client._id,
      businessId: business._id,
      businessName: business.businessName,
businessLogo: business.businessProfilePic || [],      businessAddress: business.address
        ? [business.address.street, business.address.city, business.address.region, business.address.country]
            .filter(Boolean)
            .join(", ")
        : "",
      businessPhone: business.PhoneNumber || "",
      
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
      
      status: "PENDING",
      notes: notes || "",
      
      location: {
        type: "business"
      }
    };
    
    // Create business appointment (categoryId/categoryName removed)
    const businessAppointmentData = {
      appointmentId: uniqueAppointmentId,
      clientId: client._id,
      clientName: client.fullName,
      clientEmail: client.email,
      clientPhone: client.phoneNumber || "",
      
      teamMemberId: teamMember._id,
      teamMemberName: teamMember.name,
      
      businessId: business._id,
      
      date: appointmentDate,
      endDate: appointmentDate,
      startTime,
      endTime: finalEndTime,
      duration: totalDuration,
      
      services: services.map(service => ({
        serviceId: service._id,
        name: service.name,
        duration: service.duration,
        price: service.price
      })),
      
      totalPrice,
      discount: 0,
      finalPrice: totalPrice,
      currency: "INR",
      
      paymentStatus: "PENDING",
      status: "PENDING",
      
      createdBy: business.ownerId,
      updatedBy: business.ownerId,
      createdVia: "client_booking"
    };
    
    // Create both records
    const newClientAppointment = await ClientAppointment.create([clientAppointmentData], { session });
    const newBusinessAppointment = await Appointment.create([businessAppointmentData], { session });
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Appointment created successfully",
      { appointment: newClientAppointment[0] },
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

// Helper function to generate a unique appointment ID
const generateAppointmentId = (): string => {
  // You can use a timestamp and random string for uniqueness
  return `APT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
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
    
    // Add timeStatus (Past/Upcoming) to each appointment
    const currentDateTime = new Date();
    const appointmentsWithTimeStatus = appointments.map(appointment => {
      // Combine date and startTime for full appointment date-time
      const appointmentDate = new Date(appointment.date);
      const [hours, minutes] = appointment.startTime.split(':').map(Number);
      appointmentDate.setHours(hours, minutes, 0, 0);
      
      // Determine if appointment is Past or Upcoming 
      const timeStatus = appointmentDate < currentDateTime ? 'Past' : 'Upcoming';
      return {
        ...appointment.toObject(),
        timeStatus
      };
    });
    
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
        appointments: appointmentsWithTimeStatus
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
  const session = await mongoose.startSession();
  
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
    
    // Find client appointment
    const clientAppointment = await ClientAppointment.findOne({
      _id: appointmentId,
      isDeleted: false,
      status: { $in: ["PENDING", "CONFIRMED"] }
    });
    
    if (!clientAppointment) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Appointment not found or cannot be cancelled",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // Update client appointment
    clientAppointment.status = "CANCELLED";
    clientAppointment.cancellationReason = cancellationReason || "Cancelled by client";
    clientAppointment.cancellationDate = new Date();
    clientAppointment.cancellationBy = "client";
    
    await clientAppointment.save({ session });
    
    // Find and update corresponding business appointment
    const businessAppointment = await Appointment.findOne({
      appointmentId: clientAppointment.appointmentId,
      isDeleted: false
    });
    
    if (businessAppointment) {
      businessAppointment.status = "CANCELLED";
      businessAppointment.cancellationReason = cancellationReason || "Cancelled by client";
      businessAppointment.cancellationDate = new Date();
      businessAppointment.cancellationBy = "client";
      
      await businessAppointment.save({ session });
    }
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Appointment cancelled successfully",
      { appointment: clientAppointment }
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
  const session = await mongoose.startSession();
  
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
    
    // Find client appointment
    const clientAppointment = await ClientAppointment.findOne({
      _id: appointmentId,
      isDeleted: false,
      status: { $in: ["PENDING", "CONFIRMED"] }
    });
    
    if (!clientAppointment) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Appointment not found or cannot be rescheduled",
        httpStatusCode.NOT_FOUND,
        res
      );
    }
    
    // If team member is being changed, validate
    let teamMember = null;
    if (teamMemberId && teamMemberId !== clientAppointment.teamMemberId.toString()) {
      teamMember = await TeamMember.findOne({
        _id: teamMemberId,
        businessId: clientAppointment.businessId,
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
    const finalTeamMemberId = teamMemberId || clientAppointment.teamMemberId;
    
    // Calculate end time if not provided
    let finalEndTime = endTime;
    if (!finalEndTime) {
      const services = clientAppointment.services;
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
    
    // Generate a new unique appointment ID for the rescheduled appointment
    const newUniqueAppointmentId = generateAppointmentId();
    
    // Create a new client appointment as a copy of the old one
    const newClientAppointmentData = {
      ...clientAppointment.toObject(),
      _id: undefined,
      appointmentId: newUniqueAppointmentId,
      date: appointmentDate,
      endDate: appointmentDate,
      startTime,
      endTime: finalEndTime,
      parentAppointmentId: clientAppointment._id,
      isRescheduled: true,
      status: "PENDING",
      createdAt: undefined,
      updatedAt: undefined
    };
    
    if (teamMember) {
      newClientAppointmentData.teamMemberId = teamMember._id;
      newClientAppointmentData.teamMemberName = teamMember.name;
      newClientAppointmentData.teamMemberProfilePic = teamMember.profilePicture || "";
    }
    
    // Mark the old client appointment as cancelled due to reschedule
    clientAppointment.status = "CANCELLED";
    clientAppointment.cancellationReason = "Rescheduled by client";
    clientAppointment.cancellationDate = new Date();
    clientAppointment.cancellationBy = "client";
    clientAppointment.isRescheduled = true;
    
    await clientAppointment.save({ session });
    
    // Create the new client appointment
    const newClientAppointment = await ClientAppointment.create([newClientAppointmentData], { session });
    
    // Find and update corresponding business appointment
    const businessAppointment = await Appointment.findOne({
      appointmentId: clientAppointment.appointmentId,
      isDeleted: false
    });
    
    if (businessAppointment) {
      // Mark old business appointment as cancelled
      businessAppointment.status = "CANCELLED";
      businessAppointment.cancellationReason = "Rescheduled by client";
      businessAppointment.cancellationDate = new Date();
      businessAppointment.cancellationBy = "client";
      businessAppointment.isRescheduled = true;
      
      await businessAppointment.save({ session });
      
      // Create new business appointment
      const newBusinessAppointmentData = {
        ...businessAppointment.toObject(),
        _id: undefined,
        appointmentId: newUniqueAppointmentId,
        date: appointmentDate,
        endDate: appointmentDate,
        startTime,
        endTime: finalEndTime,
        parentAppointmentId: businessAppointment._id,
        status: "PENDING",
        createdAt: undefined,
        updatedAt: undefined,
        createdVia: "client_booking"
      };
      
      if (teamMember) {
        newBusinessAppointmentData.teamMemberId = teamMember._id;
        newBusinessAppointmentData.teamMemberName = teamMember.name;
      }
      
      await Appointment.create([newBusinessAppointmentData], { session });
    }
    
    await session.commitTransaction();
    session.endSession();
    
    return successResponse(
      res,
      "Appointment rescheduled successfully",
      { 
        oldAppointment: clientAppointment,
        newAppointment: newClientAppointment[0]
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

// Get upcoming appointments for a client
export const getClientUpcomingAppointments = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { page = '1', limit = '10', sort = 'date' } = req.query;

    // Validate client ID
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

    // Build query for upcoming appointments 
    const query: any = {
      clientId,
      isDeleted: false,
      status: { $in: ["PENDING", "CONFIRMED"] },
      date: { $gte: new Date() }  
    };

    // Pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    let sortOption: any = { date: 1, startTime: 1 };
    if (sort === '-date') {
      sortOption = { date: -1, startTime: -1 };
    }

    // Get total count of upcoming appointments
    const totalAppointments = await ClientAppointment.countDocuments(query);

    // Get upcoming appointments
    const appointments = await ClientAppointment.find(query)
      .sort(sortOption)
      .skip(skip)
      .limit(limitNum);

    return successResponse(
      res,
      "Client upcoming appointments fetched successfully",
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
    console.error("Error fetching client upcoming appointments:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(
      parsedError.message,
      parsedError.code,
      res
    );
  }
};
