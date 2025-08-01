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
import {
  sendAppointmentBookedEmailBusiness,
  sendAppointmentCanceledEmailBusiness,
} from "utils/mails/mail";
import Package from "models/package/packageSchema";
import moment from "moment";

// Create a nanoid generator for appointment IDs
const appointmentId = customAlphabet(
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  10
);

// Helper function to generate a unique appointment ID
const generateAppointmentId = (): string => {
  // You can use a timestamp and random string for uniqueness
  return `APT-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
};

// Helper function to get current date and time in IST (UTC+5:30)
const getISTDateTime = () => {
  const now = new Date();
  // Adjust to IST (UTC+5:30)
  const istOffset = 5.5 * 60 * 60 * 1000; // 5 hours 30 minutes in milliseconds
  const istNow = new Date(now.getTime() + istOffset);
  return {
    date: istNow,
    dateStr: istNow.toISOString().split("T")[0], // YYYY-MM-DD in IST
    timeStr: istNow.toTimeString().slice(0, 5), // HH:MM in IST
  };
};


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
      packageId,
      date,
      // startTime,
      endTime,
      notes,
    } = req.body;

    const startTime = new Date(date).toISOString().slice(11, 16);
    console.log(startTime)
    // Validate required fields
    if (!clientId || !businessId || !teamMemberId || !date || !startTime) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Missing required fields for appointment creation",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Validate that either serviceIds or packageId is provided, but not both
    if (serviceIds && packageId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Cannot provide both serviceIds and packageId",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }
    if (!serviceIds && !packageId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Either serviceIds or packageId is required",
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
      isDeleted: false,
    }).session(session);

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
    const client = await RegisteredClient.findById(clientId).session(session);
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
      isDeleted: false,
    }).session(session);

    if (!teamMember) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Team member not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    let services: any[] = [];
    let totalDuration = 0;
    let totalPrice = 0;
    let finalEndTime = endTime;
    let appointmentPackage = null;

    if (packageId) {
      // Handle package-based appointment
      const packageData = await Package.findOne({
        _id: packageId,
        businessId: businessId,
        isActive: true,
        isDeleted: false,
      }).session(session);

      if (!packageData) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Package not found or inactive",
          httpStatusCode.NOT_FOUND,
          res
        );
      }

      services = await Service.find({
        _id: { $in: packageData.services.map((s: any) => s._id) },
        businessId: businessId,
        isActive: true,
        isDeleted: false,
      }).session(session);

      totalDuration = packageData.duration || 0;
      totalPrice = packageData.price || 0;
      finalEndTime = endTime || calculateEndTime(startTime, totalDuration);
      appointmentPackage = {
        packageId: packageData._id,
        name: packageData.name,
        duration: packageData.duration,
        price: packageData.price,
        services: packageData.services.map((svc: any) => ({
          serviceId: svc._id,
          name: svc.name,
          duration: svc.duration,
          price: svc.price,
        })),
      };
    } else {
      // Handle service-based appointment
      services = await Service.find({
        _id: { $in: serviceIds },
        businessId: businessId,
        isActive: true,
        isDeleted: false,
      }).session(session);

      if (services.length !== serviceIds.length) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "One or more services not found or inactive",
          httpStatusCode.NOT_FOUND,
          res
        );
      }

      totalDuration = services.reduce(
        (sum, service) => sum + service.duration,
        0
      );
      totalPrice = services.reduce(
        (sum, service) => sum + service.price,
        0
      );
      finalEndTime = endTime || calculateEndTime(startTime, totalDuration);
    }

    // Check if time slot is available
    const isAvailable = await isTimeSlotAvailable(
      teamMemberId,
      appointmentDate,
      appointmentDate,
      startTime,
      finalEndTime
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

    // Generate a unique appointment ID to link both records
    const uniqueAppointmentId = generateAppointmentId();

    // Create client appointment
    const clientAppointmentData = {
      appointmentId: uniqueAppointmentId,
      clientId: client._id,
      businessId: business._id,
      businessName: business.businessName,
      businessLogo: business.businessProfilePic || [],
      businessAddress: business.address
        ? [
            business.address.street,
            business.address.city,
            business.address.region,
            business.address.country,
          ]
            .filter(Boolean)
            .join(", ")
        : "",
      businessPhone: business.PhoneNumber || "",
      services: services.map((service) => ({
        serviceId: service._id,
        name: service.name,
        duration: service.duration,
        price: service.price,
      })),
      package: appointmentPackage,
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
        type: "business",
      },
    };

    // Create business appointment
    const businessAppointmentData = {
      appointmentId: uniqueAppointmentId,
      clientId: client._id,
      clientModel: "RegisteredClient",
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
      services: services.map((service) => ({
        serviceId: service._id,
        name: service.name,
        duration: service.duration,
        price: service.price,
      })),
      package: appointmentPackage,
      totalPrice,
      discount: 0,
      finalPrice: totalPrice,
      currency: "INR",
      paymentStatus: "PENDING",
      status: "PENDING",
      notes: notes || "",
      createdBy: business.ownerId,
      updatedBy: business.ownerId,
      createdVia: "client_booking",
    };

    // Create both records
    const newClientAppointment = await ClientAppointment.create(
      [clientAppointmentData],
      { session }
    );
    const newBusinessAppointment = await Appointment.create(
      [businessAppointmentData],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    try {
      await sendAppointmentBookedEmailBusiness(
        business.email,
        client.fullName,
        business.businessName,
        appointmentDate.toISOString().split("T")[0],
        startTime,
        services.map((service) => service.name)
      );
    } catch (mailErr) {
      console.error(
        "Failed to send appointment booked email to business:",
        mailErr
      );
    }

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
    return errorResponseHandler(parsedError.message, parsedError.code, res);
  }
};




// Helper function to calculate end time based on services duration
const calculateEndTime = (startTime: string, duration: number): string => {
  const [hours, minutes] = startTime.split(":").map(Number);
  let totalMinutes = hours * 60 + minutes + duration;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  return `${endHours.toString().padStart(2, "0")}:${endMinutes.toString().padStart(2, "0")}`;
};

// Get all appointments for a client
export const getClientAppointments = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { status, page = "1", limit = "10", sort = "date" } = req.query;

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
      isDeleted: false,
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
    if (sort === "-date") {
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
    const appointmentsWithTimeStatus = appointments.map((appointment) => {
      // Combine date and startTime for full appointment date-time
      const appointmentDate = new Date(appointment.date);
      const [hours, minutes] = appointment.startTime.split(":").map(Number);
      appointmentDate.setHours(hours, minutes, 0, 0);

      // Determine if appointment is Past or Upcoming
      const timeStatus =
        appointmentDate < currentDateTime ? "Past" : "Upcoming";
      return {
        ...appointment.toObject(),
        timeStatus,
      };
    });

    return successResponse(res, "Client appointments fetched successfully", {
      client: {
        _id: client._id,
        name: client.fullName,
        email: client.email,
      },
      pagination: {
        total: totalAppointments,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(totalAppointments / limitNum),
      },
      appointments: appointments,
    });
  } catch (error: any) {
    console.error("Error fetching client appointments:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
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
      isDeleted: false,
    });

    if (!appointment) {
      return errorResponseHandler(
        "Appointment not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    return successResponse(res, "Appointment details fetched successfully", {
      appointment,
    });
  } catch (error: any) {
    console.error("Error fetching appointment details:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
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
      status: { $in: ["PENDING", "CONFIRMED"] },
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
    clientAppointment.cancellationReason =
      cancellationReason || "Cancelled by client";
    clientAppointment.cancellationDate = new Date();
    clientAppointment.cancellationBy = "client";

    await clientAppointment.save({ session });

    // Find and update corresponding business appointment
    const businessAppointment = await Appointment.findOne({
      appointmentId: clientAppointment.appointmentId,
      isDeleted: false,
    });

    if (businessAppointment) {
      businessAppointment.status = "CANCELLED";
      businessAppointment.cancellationReason =
        cancellationReason || "Cancelled by client";
      businessAppointment.cancellationDate = new Date();
      businessAppointment.cancellationBy = "client";

      await businessAppointment.save({ session });
    }

    await session.commitTransaction();
    session.endSession();
    try {
      // Get business email and name
      const businessProfile = await UserBusinessProfile.findById(
        clientAppointment.businessId
      );
      // Get client name and phone
      const client = await RegisteredClient.findById(
        clientAppointment.clientId
      );

      if (
        businessProfile &&
        businessProfile.email &&
        businessProfile.businessName &&
        client &&
        client.fullName &&
        client.phoneNumber
      ) {
        await sendAppointmentCanceledEmailBusiness(
          businessProfile.email, // business email
          client.fullName, // clientName
          businessProfile.businessName, // businessName
          clientAppointment.date.toISOString().split("T")[0], // date
          clientAppointment.startTime, // startTime
          clientAppointment.cancellationReason, // cancellationReason
          client.phoneNumber // clientPhoneNumber
        );
      }
    } catch (mailErr) {
      console.error(
        "Failed to send appointment cancelled email to business:",
        mailErr
      );
      // Do not fail the API if email fails
    }

    return successResponse(res, "Appointment cancelled successfully", {
      appointment: clientAppointment,
    });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();

    console.error("Error cancelling appointment:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
  }
};

// Reschedule an appointment
export const rescheduleClientAppointment = async (
  req: Request,
  res: Response
) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { appointmentId } = req.params;
    const { date, endTime, teamMemberId } = req.body;

    const startTime = new Date(date).toISOString().slice(11, 16);


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
      status: { $in: ["PENDING", "CONFIRMED"] },
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
    if (
      teamMemberId &&
      teamMemberId !== clientAppointment.teamMemberId.toString()
    ) {
      teamMember = await TeamMember.findOne({
        _id: teamMemberId,
        businessId: clientAppointment.businessId,
        isActive: true,
        isDeleted: false,
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
      const totalDuration = services.reduce(
        (sum, service) => sum + service.duration,
        0
      );

      const [hours, minutes] = startTime.split(":").map(Number);
      let totalMinutes = hours * 60 + minutes + totalDuration;

      const endHours = Math.floor(totalMinutes / 60) % 24;
      const endMinutes = totalMinutes % 60;

      finalEndTime = `${endHours.toString().padStart(2, "0")}:${endMinutes.toString().padStart(2, "0")}`;
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
      updatedAt: undefined,
    };

    if (teamMember) {
      newClientAppointmentData.teamMemberId = teamMember._id;
      newClientAppointmentData.teamMemberName = teamMember.name;
      newClientAppointmentData.teamMemberProfilePic =
        teamMember.profilePicture || "";
    }

    // Mark the old client appointment as cancelled due to reschedule
    clientAppointment.status = "CANCELLED";
    clientAppointment.cancellationReason = "Rescheduled by client";
    clientAppointment.cancellationDate = new Date();
    clientAppointment.cancellationBy = "client";
    clientAppointment.isRescheduled = true;

    await clientAppointment.save({ session });

    // Create the new client appointment
    const newClientAppointment = await ClientAppointment.create(
      [newClientAppointmentData],
      { session }
    );

    // Find and update corresponding business appointment
    const businessAppointment = await Appointment.findOne({
      appointmentId: clientAppointment.appointmentId,
      isDeleted: false,
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
        createdVia: "client_booking",
         cancellationReason: "",
      };

      if (teamMember) {
        newBusinessAppointmentData.teamMemberId = teamMember._id;
        newBusinessAppointmentData.teamMemberName = teamMember.name;
      }

      await Appointment.create([newBusinessAppointmentData], { session });
    }

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Appointment rescheduled successfully", {
      oldAppointment: clientAppointment,
      newAppointment: newClientAppointment[0],
    });
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();

    console.error("Error rescheduling appointment:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
  }
};

export const getClientUpcomingAppointments = async (
  req: Request,
  res: Response 
) => {
  try {
    const { clientId } = req.params;
    const { page = "1", limit = "10", sort = "date" } = req.query;

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

    // Get current time in UTC to match database timezone
    const now = new Date();
    const nowUTC = new Date(now.toISOString()); // Ensure UTC
    const todayStr = nowUTC.toISOString().split("T")[0]; // 'YYYY-MM-DD' in UTC
    const currentTimeStr = nowUTC.toTimeString().slice(0, 5); // 'HH:MM' in UTC, e.g., "06:34"

    // Build query for upcoming appointments
    const query: any = {
      clientId,
      isDeleted: false,
      status: { $in: ["PENDING", "CONFIRMED"] },
      $or: [
        // Appointments after today
        {
          date: { $gt: new Date(todayStr + 'T23:59:59.999Z') },
        },
        // Appointments today with startTime >= current time
        {
          date: { $gte: new Date(todayStr), $lte: new Date(todayStr + 'T23:59:59.999Z') },
          startTime: { $gte: currentTimeStr },
        },
      ],
    };

    // Pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    const sortOption: { [key: string]: 1 | -1 } = sort === "-date"
      ? { date: -1, startTime: -1 }
      : { date: 1, startTime: 1 };

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
          email: client.email,
        },
        pagination: {
          total: totalAppointments,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(totalAppointments / limitNum),
        },
        appointments,
      }
    );
  } catch (error: any) {
    console.error("Error fetching client upcoming appointments:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
  }
};

// Update client appointment
export const updateClientAppointment = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();

  try {
    session.startTransaction();

    const { appointmentId } = req.params;
    const {
      clientId,
      businessId,
      teamMemberId,
      serviceIds,
      packageId,
      date,
      // startTime,
      endTime,
      notes,
    } = req.body;

let startTime: string | undefined;

if (date) {
  const parsedDate = moment.utc(date);
  if (!parsedDate.isValid()) {
    await session.abortTransaction();
    session.endSession();
    return errorResponseHandler("Invalid date format", httpStatusCode.BAD_REQUEST, res);
  }
  startTime = parsedDate.format("HH:mm");
}

    // Validate appointmentId
    if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Invalid appointment ID format",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Find the client appointment
    const clientAppointment = await ClientAppointment.findOne({
      _id: appointmentId,
      isDeleted: false,
    }).session(session);

    if (!clientAppointment) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Appointment not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Only the client who created the appointment can update it
    if (clientAppointment.clientId.toString() !== clientId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "You are not authorized to update this appointment",
        httpStatusCode.FORBIDDEN,
        res
      );
    }

    // Validate required fields
    if (!businessId || !teamMemberId || !date || !startTime) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Missing required fields for appointment update",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Validate that either serviceIds or packageId is provided, but not both
    if (serviceIds && packageId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Cannot provide both serviceIds and packageId",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Validate business
    const business = await UserBusinessProfile.findOne({
      _id: businessId,
      status: "active",
      isDeleted: false,
    }).session(session);

    if (!business) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Business profile not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Validate client
    const client = await RegisteredClient.findById(clientId).session(session);
    if (!client) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Client not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Validate team member
    const teamMember = await TeamMember.findOne({
      _id: teamMemberId,
      businessId: businessId,
      isActive: true,
      isDeleted: false,
    }).session(session);

    if (!teamMember) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Team member not found or inactive",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Validate date (cannot update to a past date)
    const appointmentDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (appointmentDate < today) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Cannot update appointment to a past date",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    let updatedServices: any[] = [];
    let totalDuration = clientAppointment.duration;
    let totalPrice = clientAppointment.totalPrice;
    let finalEndTime = endTime || clientAppointment.endTime;
    let appointmentPackage = clientAppointment.package;

    if (serviceIds || packageId) {
      if (packageId) {
        // Handle package-based appointment
        const packageData = await Package.findOne({
          _id: packageId,
          businessId: businessId,
          isActive: true,
          isDeleted: false,
        }).session(session);

        if (!packageData) {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            "Package not found or inactive",
            httpStatusCode.NOT_FOUND,
            res
          );
        }

        updatedServices = await Service.find({
          _id: { $in: packageData.services.map((s: any) => s._id) },
          businessId: businessId,
          isActive: true,
          isDeleted: false,
        }).session(session);

        totalDuration = packageData.duration || 0;
        totalPrice = packageData.price || 0;
        finalEndTime = endTime || calculateEndTime(startTime, totalDuration);
        appointmentPackage = {
          packageId: packageData._id as mongoose.Types.ObjectId ,
          name: packageData.name,
          duration: packageData.duration,
          price: packageData.price,
          services: packageData.services.map((svc: any) => ({
            serviceId: svc._id,
            name: svc.name,
            duration: svc.duration,
            price: svc.price,
          })),
        };
      } else {
        // Handle service-based appointment
        updatedServices = await Service.find({
          _id: { $in: serviceIds },
          businessId: businessId,
          isActive: true,
          isDeleted: false,
        }).session(session);

        if (updatedServices.length !== serviceIds.length) {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            "One or more services not found or inactive",
            httpStatusCode.NOT_FOUND,
            res
          );
        }

        totalDuration = updatedServices.reduce(
          (sum, service) => sum + service.duration,
          0
        );
        totalPrice = updatedServices.reduce(
          (sum, service) => sum + service.price,
          0
        );
        finalEndTime = endTime || calculateEndTime(startTime, totalDuration);
        appointmentPackage = null; // Clear package if switching to services
      }
    } else {
      // Use existing services and package
      updatedServices = clientAppointment.services;
      appointmentPackage = clientAppointment.package;
    }

    const newTeamMemberId = teamMemberId || clientAppointment.teamMemberId.toString();
    const newDate = date ? new Date(date) : clientAppointment.date;
    const newStartTime = startTime || clientAppointment.startTime;

    // Only check time slot if team member, date, startTime, or endTime is changed
    const shouldCheckTimeSlot =
      (teamMemberId && teamMemberId !== clientAppointment.teamMemberId.toString()) ||
      (date && new Date(date).toISOString() !== clientAppointment.date.toISOString()) ||
      (startTime && startTime !== clientAppointment.startTime) ||
      (endTime && endTime !== clientAppointment.endTime);

    if (shouldCheckTimeSlot) {
      const isAvailable = await isTimeSlotAvailable(
        newTeamMemberId,
        newDate,
        newDate,
        newStartTime,
        finalEndTime,
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

    // Update the client appointment
    clientAppointment.teamMemberId = newTeamMemberId;
    clientAppointment.teamMemberName = teamMember ? teamMember.name : clientAppointment.teamMemberName;
    clientAppointment.teamMemberProfilePic = teamMember
      ? teamMember.profilePicture || ""
      : clientAppointment.teamMemberProfilePic;
    clientAppointment.services = updatedServices.map((service) => ({
      serviceId: (service as any)._id ?? (service as any).serviceId,
      name: service.name,
      duration: service.duration,
      price: service.price,
    }));
    clientAppointment.package = appointmentPackage;
    clientAppointment.date = newDate;
    clientAppointment.endDate = newDate;
    clientAppointment.startTime = newStartTime;
    clientAppointment.endTime = finalEndTime;
    clientAppointment.duration = totalDuration;
    clientAppointment.totalPrice = totalPrice;
    clientAppointment.finalPrice = totalPrice;
    clientAppointment.status = "PENDING";
    clientAppointment.notes = notes !== undefined ? notes : clientAppointment.notes;
    await clientAppointment.save({ session });

    // Update the corresponding business appointment
    const businessAppointment = await Appointment.findOne({
      appointmentId: clientAppointment.appointmentId,
      isDeleted: false,
    }).session(session);

    if (businessAppointment) {
      businessAppointment.teamMemberId = newTeamMemberId;
      businessAppointment.teamMemberName = teamMember
        ? teamMember.name
        : businessAppointment.teamMemberName;
      businessAppointment.services = clientAppointment.services;
      businessAppointment.package = appointmentPackage;
      businessAppointment.date = newDate;
      businessAppointment.endDate = newDate;
      businessAppointment.startTime = newStartTime;
      businessAppointment.endTime = finalEndTime;
      businessAppointment.duration = totalDuration;
      businessAppointment.totalPrice = totalPrice;
      businessAppointment.finalPrice = totalPrice;
      businessAppointment.status = "PENDING";
      businessAppointment.notes = notes !== undefined ? notes : businessAppointment.notes;
      await businessAppointment.save({ session });
    }

    await session.commitTransaction();
    session.endSession();

    return successResponse(
      res,
      "Appointment updated successfully",
      { appointment: clientAppointment },
      httpStatusCode.OK
    );
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    console.error("Error updating client appointment:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
  }
};

// Get history of services booked by a client
export const getClientServiceHistory = async (req: Request, res: Response) => {
  try {
    const { clientId } = req.params;
    const { page = "1", limit = "10", sort = "date" } = req.query;

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

    // Build query
    const query: any = {
      clientId: new mongoose.Types.ObjectId(clientId),
      isDeleted: false,
      status: { $in: ["PENDING", "CONFIRMED", "COMPLETED"] }, // Include only non-cancelled appointments
    };

    // Log the number of matching appointments
    const totalAppointments = await ClientAppointment.countDocuments(query);
    console.log(`Total appointments found for client ${clientId}: ${totalAppointments}`);

    if (totalAppointments === 0) {
      return successResponse(res, "No appointments found for client", {
        client: {
          _id: client._id,
          name: client.fullName,
          email: client.email,
        },
        pagination: {
          total: 0,
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          pages: 0,
        },
        services: [],
      });
    }
    // Check if appointments have services
    const appointmentsWithServices = await ClientAppointment.find(query).select("services");
    const appointmentsWithNonEmptyServices = appointmentsWithServices.filter(
      (appt) => appt.services && appt.services.length > 0
    );
    // Pagination
    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const skip = (pageNum - 1) * limitNum;

    // Sorting
    let sortOption: any = { date: 1, startTime: 1 };
    if (sort === "-date") {
      sortOption = { date: -1, startTime: -1 };
    }

    // Aggregate to get service history
    const serviceHistory = await ClientAppointment.aggregate([
      { $match: query },
      { $unwind: { path: "$services", preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: "$services.serviceId",
          name: { $first: "$services.name" },
          count: { $sum: 1 },
          lastBooked: { $max: "$date" },
          appointments: {
            $push: {
              appointmentId: "$_id",
              date: "$date",
              startTime: "$startTime",
              businessId: "$businessId",
              businessName: "$businessName",
              status: "$status",
            },
          },
        },
      },
      { $match: { _id: { $ne: null } } }, 
      { $sort: { count: -1, lastBooked: -1 } },
      {
        $facet: {
          paginatedResults: [
            { $skip: skip },
            { $limit: limitNum },
          ],
          totalCount: [
            { $count: "total" },
          ],
        },
      },
    ]);


    const services = serviceHistory[0]?.paginatedResults || [];
    const totalServices = serviceHistory[0]?.totalCount[0]?.total || 0;
    const currentDateTime = new Date();
    const formattedServices = services.map((service: any) => ({
      serviceId: service._id,
      name: service.name,
      count: service.count,
      lastBooked: service.lastBooked,
      appointments: service.appointments.map((appointment: any) => {
        const appointmentDate = new Date(appointment.date);
        const [hours, minutes] = appointment.startTime.split(":").map(Number);
        appointmentDate.setHours(hours, minutes, 0, 0);
        const timeStatus = appointmentDate < currentDateTime ? "Past" : "Upcoming";
        return {
          ...appointment,
          timeStatus,
        };
      }),
    }));

    return successResponse(res, "Client service history fetched successfully", {
      client: {
        _id: client._id,
        name: client.fullName,
        email: client.email,
      },
      pagination: {
        total: totalServices,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(totalServices / limitNum),
      },
      services: formattedServices,
    });
  } catch (error: any) {
    console.error("Error fetching client service history:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
  }
};