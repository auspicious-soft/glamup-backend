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
  validateRequiredAppointmentFields,
} from "../../utils/appointment/appointmentUtils";
import {
  validateUserAuth,
  startSession,
  handleTransactionError,
} from "../../utils/user/usercontrollerUtils";
import ClientAppointment from "models/clientAppointment/clientAppointmentSchema";
import Service from "models/services/servicesSchema";
import Business from "models/business/userBusinessProfileSchema";
import Category from "models/category/categorySchema";
import Client from "models/client/clientSchema";
import User from "models/user/userSchema";
import RegisteredTeamMember from "models/registeredTeamMember/registeredTeamMemberSchema";

// Helper function to calculate end time based on services duration
const calculateEndTimeFromServices = async (
  startTime: string,
  serviceIds: string[]
): Promise<string> => {
  // Fetch all services to get their durations
  const services = await Service.find({ _id: { $in: serviceIds } });

  // Calculate total duration in minutes
  const totalDuration = services.reduce(
    (total, service) => total + (service.duration || 0),
    0
  );

  // Parse start time
  const [hours, minutes] = startTime.split(":").map(Number);
  let totalMinutes = hours * 60 + minutes + totalDuration;

  // Calculate end time
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;

  // Format as HH:MM
  return `${endHours.toString().padStart(2, "0")}:${endMinutes.toString().padStart(2, "0")}`;
};

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
      discount,
      isNewClient,
      name,
      email,
      phoneNumber,
      countryCode,
      countryCallingCode,
    } = req.body;

    // Get business ID first as it's needed for both paths
    const businessId = await validateBusinessProfile(userId, res, session);
    if (!businessId) return;

    // Handle new client creation if isNewClient is true
    let finalClientId = clientId;

    if (isNewClient === true) {
      // Validate required fields for new client
      if (!name || !phoneNumber || !countryCallingCode || !countryCode) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Name, phone number, country code, and country calling code are required for creating a new client",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }

      // Build query to check for existing clients with same phone number
      const phoneQuery = {
        phoneNumber,
        businessId,
        isDeleted: false,
      };

      // Check if client with same phone number exists
      const existingClientByPhone = (await Client.findOne(phoneQuery).session(
        session
      )) as (typeof Client.prototype & { _id: mongoose.Types.ObjectId }) | null;
      if (existingClientByPhone) {
        // Update the name of the existing client
        existingClientByPhone.name = name;
        await existingClientByPhone.save({ session });
        finalClientId = existingClientByPhone._id.toString();
      } else {
        // If email is provided, check for duplicate email
        if (email && email.trim() !== "") {
          const emailQuery = {
            email,
            businessId,
            isDeleted: false,
          };

          const existingClientByEmail =
            await Client.findOne(emailQuery).session(session);
          if (existingClientByEmail) {
            await session.abortTransaction();
            session.endSession();
            return errorResponseHandler(
              "A client with this email already exists in your business",
              httpStatusCode.CONFLICT,
              res
            );
          }
        }

        // Create new client with minimal information
        const newClient = (await Client.create(
          [
            {
              name,
              email: email || "",
              phoneNumber,
              countryCode: countryCode || "+91",
              countryCallingCode: countryCallingCode || "IN",
              profilePicture: "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/dummyClientPicture.png",
              birthday: null,
              gender: "prefer_not_to_say",
              address: {
                street: "",
                city: "",
                region: "",
                country: "",
              },
              notes: "",
              tags: [],
              businessId: businessId,
              preferredServices: [],
              preferredTeamMembers: [],
              lastVisit: null,
              isActive: true,
              isDeleted: false,
            },
          ],
          { session }
        )) as unknown as (typeof Client)[];

        finalClientId = (newClient[0] as any)._id.toString();
      }
    }

    // Validate and parse serviceIds
    let parsedServiceIds: string[] = [];
    if (typeof serviceIds === "string") {
      // Split comma-separated string and trim whitespace
      parsedServiceIds = serviceIds
        .split(",")
        .map((id) => id.trim())
        .filter((id) => id);
    } else if (Array.isArray(serviceIds)) {
      parsedServiceIds = serviceIds.map((id) => id.toString());
    }

    // Validate that serviceIds is not empty and contains valid ObjectIds
    if (!parsedServiceIds.length) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "At least one service ID is required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Validate each service ID
    for (const id of parsedServiceIds) {
      if (!mongoose.Types.ObjectId.isValid(id)) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          `Invalid service ID: ${id}`,
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
    }

    // Validate required fields for appointment
    if (
      !finalClientId ||
      !teamMemberId ||
      !startDate ||
      !startTime ||
      !serviceIds ||
      (Array.isArray(serviceIds) && serviceIds.length === 0)
    ) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Client, team member, date, time, and services are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Get the category from the first service - check both custom and global services
    let service;
    let categoryId;

    // First try to find the service in business-specific services
    service = await Service.findById(serviceIds[0]).session(session);

    // If not found, check in global services
    if (!service) {
      // Find in global services from the business's selected categories
      const business = await Business.findById(businessId).session(session);
      if (!business) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Business not found",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }

      // Get the business's selected global categories
      const selectedCategories = business.selectedCategories || [];

      // Find the global service within the selected categories
      for (const catId of selectedCategories) {
        const category = await Category.findById(catId)
          .populate("services")
          .session(session);
        const categoryServices = category?.get("services");
        if (category && categoryServices) {
          const globalService = categoryServices.find(
            (s: any) => s._id.toString() === serviceIds[0]
          );

          if (globalService) {
            service = globalService;
            categoryId = catId;
            break;
          }
        }
      }
    } else {
      categoryId = service.categoryId;
    }

    if (!service) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Service not found in either business services or global categories",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (!categoryId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Could not determine category for the service",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Check if the team member is available at the requested time
    const finalEndTime =
      endTime || (await calculateEndTimeFromServices(startTime, serviceIds));

    // Pass clientId to check for duplicate bookings by the same client
    const isAvailable = await isTimeSlotAvailable(
      teamMemberId,
      new Date(startDate),
      new Date(endDate || startDate),
      startTime,
      finalEndTime,
      finalClientId
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
      finalClientId,
      teamMemberId,
      categoryId.toString(), // Use the category from the service
      serviceIds || [],
      new Date(startDate),
      new Date(endDate || startDate),
      packageId,
      businessId.toString(),
      undefined,
      session
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
      finalEndTime,
      validationResult.totalDuration ?? 0,
      validationResult.totalPrice ?? 0,
      discount || 0,
      new mongoose.Types.ObjectId(userId)
    );

    const newAppointment = await Appointment.create([appointmentData], {
      session,
    });

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
        isActive: true,
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
      req.query.teamMemberId as string,
      req.query.clientId as string,
      undefined,
      req.query.status as string,
      dateQuery
    );

    if (query.error) {
      return errorResponseHandler(query.error, httpStatusCode.BAD_REQUEST, res);
    }

    const pagination = preparePagination(
      req.query.page as string,
      req.query.limit as string
    );

    const totalAppointments = await Appointment.countDocuments(query);

    const appointments = await Appointment.find(query)
      .populate("clientId")
      .populate("teamMemberId")
      .sort({ date: 1, startTime: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit);

    const paginationMetadata = preparePaginationMetadata(
      totalAppointments,
      pagination
    );

    // Parse the date from query
     const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0); 
    const inputDate = req.query.date ? new Date(req.query.date as string) : null;
    
    const baseDate = inputDate && !isNaN(inputDate.getTime()) && inputDate >= currentDate 
      ? inputDate 
      : currentDate;

    const endOfMonth = new Date(
      baseDate.getFullYear(),
      baseDate.getMonth() + 1,
      0,
      23,
      59,
      59,
      999
    );

    const dayOfWeek = baseDate.getDay();
    const daysUntilSunday = 7 - dayOfWeek;
    const endOfWeek = new Date(baseDate);
    endOfWeek.setDate(baseDate.getDate() + daysUntilSunday);
    endOfWeek.setHours(23, 59, 59, 999);
    if (endOfWeek > endOfMonth) endOfWeek.setTime(endOfMonth.getTime());

    const monthlyUpcomingAppointments = await Appointment.countDocuments({
      businessId,
      isDeleted: false,
      status: { $in: ["PENDING", "CONFIRMED"] },
      date: { $gte: baseDate, $lte: endOfMonth },
    });

    const weeklyUpcomingAppointments = await Appointment.countDocuments({
      businessId,
      isDeleted: false,
      status: { $in: ["PENDING", "CONFIRMED"] },
      date: { $gte: baseDate, $lte: endOfWeek },
    });


    return successResponse(res, "Appointments fetched successfully", {
         monthlyUpcomingAppointments,
      weeklyUpcomingAppointments,
      ...paginationMetadata,
      appointments,
    });
  } catch (error: any) {
    console.error("Error fetching appointments:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const getTeamMemberAppointments = async (
  req: Request,
  res: Response
) => {
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
        isActive: true,
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

    const { teamMemberId } = req.params;

    const teamMember = await validateTeamMemberAccess(
      teamMemberId,
      businessId,
      res
    );
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
      return errorResponseHandler(query.error, httpStatusCode.BAD_REQUEST, res);
    }

    const pagination = preparePagination(
      req.query.page as string,
      req.query.limit as string
    );

    const totalAppointments = await Appointment.countDocuments(query);

    const appointments = await Appointment.find(query)
      .populate({
        path: "clientId",
        match: { isDeleted: false }, // Only include appointments where client is not deleted
      })
      .sort({ date: 1, startTime: 1 })
      .skip(pagination.skip)
      .limit(pagination.limit);

    // Filter out appointments where client is deleted (populate returned null)
    const filteredAppointments = appointments.filter(
      (appointment) => appointment.clientId
    );

    // Recalculate pagination metadata with filtered results
    const paginationMetadata = preparePaginationMetadata(
      filteredAppointments.length, // Use filtered count instead of total
      pagination,
      filteredAppointments
    );

    return successResponse(
      res,
      "Team member appointments fetched successfully",
      {
        teamMember: prepareTeamMemberResponse(teamMember),
        ...paginationMetadata,
        appointments: filteredAppointments,
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

    const existingAppointment = await validateAppointmentAccess(
      appointmentId,
      businessId,
      res,
      session
    );
    if (!existingAppointment) return;

    // Check if this appointment was created by a client
    // First, check if the createdVia field exists and equals "client_booking"
    // If not, check if there's a corresponding client appointment with the same appointmentId
    let isClientBooking = existingAppointment.createdVia === "client_booking";

    if (!isClientBooking) {
      // Double-check by looking for a matching client appointment
      const clientAppointment = await ClientAppointment.findOne({
        appointmentId: existingAppointment.appointmentId,
        isDeleted: false,
      });

      isClientBooking = !!clientAppointment;
    }

    // For client bookings, only allow status updates and cancellation
    if (isClientBooking) {
      const { status, cancellationReason } = req.body;

      // Only allow status updates to "cancelled" or other non-structural changes
      if (
        req.body.teamMemberId ||
        req.body.categoryId ||
        req.body.serviceIds ||
        req.body.startDate ||
        req.body.endDate ||
        req.body.startTime ||
        req.body.endTime
      ) {
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
              updatedBy: new mongoose.Types.ObjectId(userId),
            },
          },
          { session }
        );

        // Find and update corresponding client appointment
        const clientAppointment = await ClientAppointment.findOne({
          appointmentId: existingAppointment.appointmentId,
          isDeleted: false,
        });

        if (clientAppointment) {
          await ClientAppointment.findByIdAndUpdate(
            clientAppointment._id,
            {
              $set: {
                status: "CANCELLED",
                cancellationReason:
                  cancellationReason || "Cancelled by business",
                cancellationDate: new Date(),
                cancellationBy: "business",
              },
            },
            { session }
          );
        }

        const updatedAppointment =
          await Appointment.findById(appointmentId).session(session);

        await session.commitTransaction();
        session.endSession();

        return successResponse(res, "Appointment cancelled successfully", {
          appointment: updatedAppointment,
        });
      }

      // For non-cancellation status updates
      const allowedUpdates = {
        status: status,
        updatedBy: new mongoose.Types.ObjectId(userId),
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
          isDeleted: false,
        });

        if (clientAppointment) {
          await ClientAppointment.findByIdAndUpdate(
            clientAppointment._id,
            { $set: { status: status } },
            { session }
          );
        }
      }

      const updatedAppointment =
        await Appointment.findById(appointmentId).session(session);

      await session.commitTransaction();
      session.endSession();

      return successResponse(res, "Appointment status updated successfully", {
        appointment: updatedAppointment,
      });
    }

    // For business-created appointments, proceed with normal update flow
    const { teamMemberId, status, serviceIds } = req.body;

    // If services are being updated, get the category from the first service
    let categoryId;
    if (serviceIds && serviceIds.length > 0) {
      // First try to find the service in business-specific services
      let service = await Service.findById(serviceIds[0]);

      // If not found, check in global services
      if (!service) {
        // Find in global services from the business's selected categories
        const business = await Business.findById(
          existingAppointment.businessId
        );
        if (!business) {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            "Business not found",
            httpStatusCode.BAD_REQUEST,
            res
          );
        }

        // Get the business's selected global categories
        const selectedCategories = business.selectedCategories || [];

        // Find the global service within the selected categories
        for (const catId of selectedCategories) {
          const category = await Category.findById(catId).populate("services");
          const categoryServices = category?.get("services");
          if (category && categoryServices) {
            const globalService = categoryServices.find(
              (s: any) => s._id.toString() === serviceIds[0]
            );

            if (globalService) {
              service = globalService;
              categoryId = catId;
              break;
            }
          }
        }
      } else {
        categoryId = service.categoryId;
      }

      if (!service) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Service not found in either business services or global categories",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }

      if (!categoryId) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Could not determine category for the service",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }

      req.body.categoryId = categoryId; // Add categoryId to request body
    }

    const teamMemberChanged = isTeamMemberChanged(
      teamMemberId,
      existingAppointment
    );

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
          updatedBy: new mongoose.Types.ObjectId(userId),
        },
      },
      { session }
    );

    const updatedAppointment =
      await Appointment.findById(appointmentId).session(session);

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Appointment updated successfully", {
      appointment: updatedAppointment,
    });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getAppointmentById = async (req: Request, res: Response) => {
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
        isActive: true,
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

    const { appointmentId } = req.params;

    const appointment = await validateAppointmentAccess(
      appointmentId,
      businessId,
      res
    );
    if (!appointment) return;

    return successResponse(res, "Appointment fetched successfully", {
      appointment,
    });
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

    const existingAppointment = await validateAppointmentAccess(
      appointmentId,
      businessId,
      res,
      session
    );
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
          updatedBy: new mongoose.Types.ObjectId(userId),
        },
      },
      { session }
    );

    // Check if this was a client booking
    let isClientBooking = existingAppointment.createdVia === "client_booking";

    // Find corresponding client appointment
    const clientAppointment = await ClientAppointment.findOne({
      appointmentId: existingAppointment.appointmentId,
      isDeleted: false,
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
            cancellationBy: "business",
          },
        },
        { session }
      );
    }

    const updatedAppointment =
      await Appointment.findById(appointmentId).session(session);

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Appointment cancelled successfully", {
      appointment: updatedAppointment,
      isClientBooking: isClientBooking,
    });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getPendingAppointments = async (req: Request, res: Response) => {
  try {
    const userId = await validateUserAuth(req, res);
    if (!userId) return;

    const user = await User.findById(userId);
    if (!user) {
      return errorResponseHandler(
        "User not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    let businessId;

    if (user.businessRole === "team-member") {
      const teamMembership = await RegisteredTeamMember.findOne({
        userId: userId,
        isDeleted: false,
        isActive: true,
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
      businessId = await validateBusinessProfile(userId, res);
      if (!businessId) return;
    }

    const pagination = preparePagination(
      req.query.page as string,
      req.query.limit as string
    );

    let dateQuery = {};
    if (req.query.date || req.query.startDate || req.query.endDate) {
      dateQuery = buildDateRangeQuery(
        req.query.date,
        req.query.startDate,
        req.query.endDate
      );

      if (dateQuery && (dateQuery as any).error) {
        return errorResponseHandler(
          (dateQuery as any).error,
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
    }

    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];
    const currentTime = now.toTimeString().split(' ')[0]; 

    const query: any = {
      businessId: businessId,
      status: "PENDING",
      isDeleted: false,
      $or: [
        { date: { $gt: currentDate } }, 
        {
          date: currentDate, 
          startTime: { $gte: currentTime }
        }
      ],
      ...dateQuery,
    };

    if (
      req.query.teamMemberId &&
      mongoose.Types.ObjectId.isValid(req.query.teamMemberId as string)
    ) {
      query.teamMemberId = req.query.teamMemberId;
    }

    if (
      req.query.clientId &&
      mongoose.Types.ObjectId.isValid(req.query.clientId as string)
    ) {
      query.clientId = req.query.clientId;
    }

    if (req.query.source === "client") {
      query.createdVia = "client_booking";
    } else if (req.query.source === "business") {
      query.createdVia = { $ne: "client_booking" };
    }

    const totalAppointments = await Appointment.countDocuments(query);

    const pendingAppointments = await Appointment.find(query)
      .sort({ date: 1, startTime: 1 }) 
      .skip(pagination.skip)
      .limit(pagination.limit);

    const paginationMetadata = preparePaginationMetadata(
      totalAppointments,
      pagination
    );

    return successResponse(res, "Pending appointments fetched successfully", {
      ...paginationMetadata,
      appointments: pendingAppointments,
    });
  } catch (error: any) {
    console.error("Error fetching pending appointments:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};