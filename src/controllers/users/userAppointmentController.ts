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
import {
  sendAppointmentBookedEmailClient,
  sendAppointmentCanceledEmailClient,
  sendAppointmentCompletedEmailClient,
  sendAppointmentConfirmedEmailClient,
} from "utils/mails/mail";
import RegisteredClient from "models/registeredClient/registeredClientSchema";
import Package from "models/package/packageSchema";

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

const calculateEndTimeFromPackage = async (
  startTime: string,
  packageId: string,
  session: mongoose.ClientSession
): Promise<string> => {
  const packageData = await Package.findById(packageId).session(session);
  if (!packageData) {
    throw new Error("Package not found");
  }
  const totalDuration = packageData.duration || 0;

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
      // startTime,
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
      notes,
    } = req.body;
    const startTime = new Date(startDate).toISOString().slice(11, 16);

    // Get business ID first as it's needed for both paths
    const businessId = await validateBusinessProfile(userId, res, session);
    if (!businessId) return;

    const user = await User.findById(userId);
    if (!user) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "User not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Handle new client creation if isNewClient is true
    let finalClientId = clientId;
    if (isNewClient === true && user.businessRole !== "client") {
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
              profilePicture:
                "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/dummyClientPicture.png",
              birthday: null,
              gender: "prefer_not_to_say",
              address: {
                street: "",
                city: "",
                region: "",
                country: "",
              },
              notes: notes || "",
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
    if (!packageId || (serviceIds && serviceIds.length > 0)) {
      if (typeof serviceIds === "string") {
        // Split comma-separated string and trim whitespace
        parsedServiceIds = serviceIds
          .split(",")
          .map((id) => id.trim())
          .filter((id) => id);
      } else if (Array.isArray(serviceIds)) {
        parsedServiceIds = serviceIds.map((id) => id.toString());
      }

      // Validate that serviceIds is not empty when no packageId is provided
      if (!packageId && !parsedServiceIds.length) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "At least one service ID is required when no package is provided",
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
    }

    // Validate required fields for appointment
    if (
      !finalClientId ||
      !teamMemberId ||
      !startDate ||
      !startTime ||
      (!packageId &&
        (!serviceIds || (Array.isArray(serviceIds) && serviceIds.length === 0)))
    ) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Client, team member, date, time, and either services or a package are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Get the category from the first service - check both custom and global services
    let service;
    let categoryId;
    if (packageId && (!serviceIds || serviceIds.length === 0)) {
      const packageData = await Package.findById(packageId).session(session);
      if (!packageData) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Package not found",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
      categoryId = packageData.categoryId; // Assuming Package has a categoryId field
      service = packageData.services?.[0]; // Use first service for compatibility, if needed
    } else {
      // Original service-based logic
      service = await Service.findById(parsedServiceIds[0]).session(session);
      if (!service) {
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

        const selectedCategories = business.selectedCategories || [];
        for (const catId of selectedCategories) {
          const category = await Category.findById(catId)
            .populate("services")
            .session(session);
          const categoryServices = category?.get("services");
          if (category && categoryServices) {
            const globalService = categoryServices.find(
              (s: any) => s._id.toString() === parsedServiceIds[0]
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
    }

    if (!service && !packageId) {
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
        "Could not determine category for the service or package",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    // Check if the team member is available at the requested time
    const finalEndTime =
      endTime ||
      (packageId && (!serviceIds || serviceIds.length === 0)
        ? (await Package.findById(packageId).session(session))?.duration
        : await calculateEndTimeFromServices(startTime, parsedServiceIds)) ||
      startTime;

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

    if (
      validationResult.client &&
      validationResult.client.constructor?.modelName === "RegisteredClient"
    ) {
      appointmentData.clientModel = "RegisteredClient";
    } else {
      appointmentData.clientModel = "Client";
    }

    const newAppointment = await Appointment.create([appointmentData], {
      session,
    });

    await session.commitTransaction();
    session.endSession();

    try {
      // Get client and business info
      const client = validationResult.client;
      const business = await Business.findById(businessId);

      if (
        (!validationResult.client?.createdVia ||
          validationResult.client.createdVia !== "client_booking") &&
        client &&
        client.email &&
        business &&
        business.businessName
      ) {
        await sendAppointmentBookedEmailClient(
          client.email,
          client.name, // or client.fullName if that's the field
          business.businessName,
          appointmentData.date.toISOString().split("T")[0],
          appointmentData.startTime,
          (validationResult.services || []).map((s: any) => s.name)
        );
      }
    } catch (mailErr) {
      console.error(
        "Failed to send appointment booked email to client:",
        mailErr
      );
      // Do not fail the API if email fails
    }

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
      .limit(pagination.limit)
      .lean();

    for (const appt of appointments) {
      const rawClient = appt.clientId;

      if (
        rawClient &&
        appt.clientModel === "RegisteredClient" &&
        typeof rawClient === "object" &&
        !("toHexString" in rawClient)
      ) {
        const clientObj = (rawClient as any).toObject
          ? (rawClient as any).toObject()
          : rawClient;

        clientObj.name = clientObj.fullName || clientObj.name || "";
        delete clientObj.fullName;
        clientObj.profilePicture =
          clientObj.profilePic || clientObj.profilePicture || "";
        delete clientObj.profilePic;
        // Assign cleaned object back to appointment
        (appt as any).clientId = clientObj;
      }

      // If no clientId but client_booking, fetch RegisteredClient
      if (
        (!appt.clientId || appt.clientId === null) &&
        appt.createdVia === "client_booking"
      ) {
        const registeredClient = await RegisteredClient.findById(rawClient);

        if (registeredClient) {
          (appt as any).clientDetails = {
            _id: registeredClient._id,
            name: registeredClient.fullName || "",
            email: registeredClient.email || "",
            phoneNumber: registeredClient.phoneNumber || "",
            countryCode: registeredClient.countryCode || "",
            countryCallingCode: registeredClient.countryCallingCode || "",
            profilePicture: registeredClient.profilePic || "",
            tags: [],
            businessId: null,
            preferredServices: [],
            preferredTeamMembers: [],
            lastVisit: null,
            isActive: true,
            isDeleted: false,
            clientId: null,
            createdAt: registeredClient.createdAt,
            updatedAt: registeredClient.updatedAt,
            __v: 0,
          };
        }
      }
    }

    const paginationMetadata = preparePaginationMetadata(
      totalAppointments,
      pagination
    );

    // Parse the date from query
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    const inputDate = req.query.date
      ? new Date(req.query.date as string)
      : null;

    const baseDate =
      inputDate && !isNaN(inputDate.getTime()) && inputDate >= currentDate
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
    const {
      teamMemberId,
      status,
      serviceIds,
      packageId,
      startDate,
      endDate,
      startTime,
      endTime,
      discount,
      cancellationReason,
      notes,
    } = req.body;

    const businessId = await validateBusinessProfile(userId, res, session);
    if (!businessId) return;

    const existingAppointment = await validateAppointmentAccess(
      appointmentId,
      businessId,
      res,
      session
    );
    if (!existingAppointment) return;

    let isClientBooking = existingAppointment.createdVia === "client_booking";
    if (!isClientBooking) {
      const clientAppointment = await ClientAppointment.findOne({
        appointmentId: existingAppointment.appointmentId,
        isDeleted: false,
      });
      isClientBooking = !!clientAppointment;
    }

    if (isClientBooking) {
      if (
        teamMemberId ||
        serviceIds ||
        packageId ||
        startDate ||
        endDate ||
        startTime ||
        endTime
      ) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Cannot modify core appointment details for client bookings. You can only update the status or cancel the appointment.",
          httpStatusCode.FORBIDDEN,
          res
        );
      }

      if (status === "CANCELLED") {
        await Appointment.findByIdAndUpdate(
          appointmentId,
          {
            $set: {
              status: "CANCELLED",
              cancellationReason: cancellationReason || "Cancelled by business",
              cancellationDate: new Date(),
              cancellationBy: "business",
              updatedBy: new mongoose.Types.ObjectId(userId),
              notes: notes !== undefined ? notes : existingAppointment.notes,
            },
          },
          { session }
        );

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
                notes: notes !== undefined ? notes : clientAppointment.notes,
              },
            },
            { session }
          );
        }
      } else if (status) {
        const allowedUpdates = {
          status: status,
          updatedBy: new mongoose.Types.ObjectId(userId),
          notes: notes !== undefined ? notes : existingAppointment.notes,
        };

        await Appointment.findByIdAndUpdate(
          appointmentId,
          { $set: allowedUpdates },
          { session }
        );

        const clientAppointment = await ClientAppointment.findOne({
          appointmentId: existingAppointment.appointmentId,
          isDeleted: false,
        });

        if (clientAppointment) {
          await ClientAppointment.findByIdAndUpdate(
            clientAppointment._id,
            {
              $set: {
                status: status,
                notes: notes !== undefined ? notes : clientAppointment.notes,
              },
            },
            { session }
          );
        }
      }
    } else {
      let categoryId;
      let finalServiceIds: string[] = [];
      let finalPackageId: string | undefined = undefined;
      let finalEndTime = endTime || existingAppointment.endTime;
      let totalDuration = existingAppointment.duration;
      let totalPrice = existingAppointment.totalPrice;

      // Handle serviceIds or packageId update
      if (serviceIds || packageId) {
        if (packageId && (!serviceIds || serviceIds.length === 0)) {
          // Updating to package-based appointment
          const packageData =
            await Package.findById(packageId).session(session);
          if (!packageData) {
            await session.abortTransaction();
            session.endSession();
            return errorResponseHandler(
              "Package not found",
              httpStatusCode.BAD_REQUEST,
              res
            );
          }
          categoryId = packageData.categoryId;
          finalServiceIds = packageData.services.map((s: any) =>
            s._id.toString()
          );
          finalPackageId = packageId;
          totalDuration = packageData.duration || 0;
          totalPrice = packageData.price || 0;
          if (startTime) {
            finalEndTime = await calculateEndTimeFromPackage(
              startTime,
              packageId,
              session
            );
          }
        } else if (serviceIds && serviceIds.length > 0) {
          // Updating to service-based appointment
          let parsedServiceIds: string[] = [];
          if (typeof serviceIds === "string") {
            parsedServiceIds = serviceIds
              .split(",")
              .map((id) => id.trim())
              .filter((id) => id);
          } else if (Array.isArray(serviceIds)) {
            parsedServiceIds = serviceIds.map((id) => id.toString());
          }

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

          let service = await Service.findById(parsedServiceIds[0]).session(
            session
          );
          if (!service) {
            const business = await Business.findById(
              existingAppointment.businessId
            ).session(session);
            if (!business) {
              await session.abortTransaction();
              session.endSession();
              return errorResponseHandler(
                "Business not found",
                httpStatusCode.BAD_REQUEST,
                res
              );
            }

            const selectedCategories = business.selectedCategories || [];
            for (const catId of selectedCategories) {
              const category = await Category.findById(catId)
                .populate("services")
                .session(session);
              const categoryServices = category?.get("services");
              if (category && categoryServices) {
                const globalService = categoryServices.find(
                  (s: any) => s._id.toString() === parsedServiceIds[0]
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

          finalServiceIds = parsedServiceIds;
          finalPackageId = undefined;
          const services = await Service.find({
            _id: { $in: parsedServiceIds },
          }).session(session);
          totalDuration = services.reduce(
            (total, service) => total + (service.duration || 0),
            0
          );
          totalPrice = services.reduce(
            (total, service) => total + (service.price || 0),
            0
          );
          if (startTime) {
            finalEndTime = await calculateEndTimeFromServices(
              startTime,
              parsedServiceIds
            );
          }
        } else {
          await session.abortTransaction();
          session.endSession();
          return errorResponseHandler(
            "Either serviceIds or packageId must be provided",
            httpStatusCode.BAD_REQUEST,
            res
          );
        }
      } else {
        // No service or package update, use existing values
        finalServiceIds = existingAppointment.services.map((s: any) =>
          s._id.toString()
        );
        finalPackageId = existingAppointment.packageId?.toString();
        categoryId = existingAppointment.categoryId;
      }

      // Validate team member availability if changed
      const teamMemberChanged = isTeamMemberChanged(
        teamMemberId,
        existingAppointment
      );
      const startDateChanged =
        startDate &&
        new Date(startDate).toISOString() !==
          existingAppointment.date.toISOString();
      const startTimeChanged =
        startTime && startTime !== existingAppointment.startTime;
      const endTimeChanged = endTime && endTime !== existingAppointment.endTime;

      if (
        teamMemberChanged ||
        startDateChanged ||
        startTimeChanged ||
        endTimeChanged
      ) {
        const updateData = {
          teamMemberId: teamMemberId || existingAppointment.teamMemberId,
          startDate: startDate ? new Date(startDate) : existingAppointment.date,
          endDate: endDate
            ? new Date(endDate)
            : existingAppointment.endDate || existingAppointment.date,
          startTime: startTime || existingAppointment.startTime,
          endTime: finalEndTime,
          clientId: existingAppointment.clientId,
          serviceIds: finalServiceIds,
          packageId: finalPackageId,
          categoryId,
        };

        const isAvailable = await isTimeSlotAvailable(
          updateData.teamMemberId,
          updateData.startDate,
          updateData.endDate,
          updateData.startTime,
          updateData.endTime,
          existingAppointment.clientId.toString(),
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
      // Validate appointment entities
      const validationResult = await validateAppointmentEntities(
        existingAppointment.clientId,
        teamMemberId || existingAppointment.teamMemberId,
        categoryId || existingAppointment.categoryId.toString(),
        finalServiceIds, // Use finalServiceIds directly as it's guaranteed to be string[]
        startDate ? new Date(startDate) : existingAppointment.date,
        endDate
          ? new Date(endDate)
          : existingAppointment.endDate || existingAppointment.date,
        finalPackageId,
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

      // Prepare appointment data
      const appointmentData = prepareAppointmentData(
        validationResult.client,
        validationResult.teamMember,
        validationResult.category,
        validationResult.services || [],
        validationResult.packageData,
        businessId,
        startDate ? new Date(startDate) : existingAppointment.date,
        endDate
          ? new Date(endDate)
          : existingAppointment.endDate || existingAppointment.date,
        startTime || existingAppointment.startTime,
        finalEndTime,
        totalDuration,
        totalPrice,
        discount !== undefined ? discount : existingAppointment.discount,
        new mongoose.Types.ObjectId(userId)
      );

      // Update clientModel if necessary
      if (
        validationResult.client &&
        validationResult.client.constructor?.modelName === "RegisteredClient"
      ) {
        appointmentData.clientModel = "RegisteredClient";
      } else {
        appointmentData.clientModel = "Client";
      }

      // Update appointment
      await Appointment.findByIdAndUpdate(
        appointmentId,
        {
          $set: {
            ...appointmentData,
            status: status !== undefined ? status : existingAppointment.status,
              notes: notes !== undefined ? notes : existingAppointment.notes,
            updatedBy: new mongoose.Types.ObjectId(userId),
          },
        },
        { session }
      );
    }

    const updatedAppointment =
      await Appointment.findById(appointmentId).session(session);

    if (status && updatedAppointment) {
      let client: any = null;
      if (updatedAppointment.clientModel === "RegisteredClient") {
        client = await RegisteredClient.findById(
          updatedAppointment.clientId
        ).session(session);
      } else {
        client = await Client.findById(updatedAppointment.clientId).session(
          session
        );
      }

      const business = await Business.findById(
        updatedAppointment.businessId
      ).session(session);

      if (client && client.email && business) {
        const serviceNames = (updatedAppointment.services || []).map(
          (s: any) => s.name
        );

        if (status === "CONFIRMED") {
          await sendAppointmentConfirmedEmailClient(
            client.email,
            client.name || client.fullName || "",
            business.businessName,
            updatedAppointment.date.toISOString().split("T")[0],
            updatedAppointment.startTime,
            serviceNames
          );
        } else if (status === "CANCELLED") {
          await sendAppointmentCanceledEmailClient(
            client.email,
            client.name || client.fullName || "",
            business.businessName,
            updatedAppointment.date.toISOString().split("T")[0],
            updatedAppointment.startTime,
            cancellationReason || ""
          );
        } else if (status === "COMPLETED") {
          await sendAppointmentCompletedEmailClient(
            client.email,
            client.name || client.fullName || "",
            business.businessName,
            updatedAppointment.date.toISOString().split("T")[0],
            serviceNames
          );
        }
      }
    }

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
    const currentDate = now.toISOString().split("T")[0];
    const currentTime = now.toTimeString().split(" ")[0];

    const query: any = {
      businessId: businessId,
      status: "PENDING",
      isDeleted: false,
      $or: [
        { date: { $gt: currentDate } },
        {
          date: currentDate,
          startTime: { $gte: currentTime },
        },
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

export const getClientServiceHistory = async (req: Request, res: Response) => {
  try {
    // Validate user authentication
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

    // Validate business access
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

    // Check if client exists and belongs to the business
    const client = await Client.findOne({
      _id: clientId,
      businessId,
      isDeleted: false,
    });

    if (!client) {
      return errorResponseHandler(
        "Client not found or does not belong to this business",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // Build query
    const query: any = {
      clientId: new mongoose.Types.ObjectId(clientId),
      businessId,
      isDeleted: false,
      status: { $in: ["PENDING", "CONFIRMED", "COMPLETED"] }, // Include only non-cancelled appointments
    };

    // Log the number of matching appointments
    const totalAppointments = await Appointment.countDocuments(query);
    console.log(
      `Total appointments found for client ${clientId}: ${totalAppointments}`
    );

    if (totalAppointments === 0) {
      return successResponse(res, "No appointments found for client", {
        client: {
          _id: client._id,
          name: client.name,
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
    const appointmentsWithServices =
      await Appointment.find(query).select("services");
    const appointmentsWithNonEmptyServices = appointmentsWithServices.filter(
      (appt) => appt.services && appt.services.length > 0
    );

    // Pagination
    const pagination = preparePagination(page as string, limit as string);
    const { skip, limit: limitNum, page: pageNum } = pagination;

    // Sorting
    let sortOption: any = { date: 1, startTime: 1 };
    if (sort === "-date") {
      sortOption = { date: -1, startTime: -1 };
    }

    // Aggregate to get service history
    const serviceHistory = await Appointment.aggregate([
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
              status: "$status",
              createdAt: "$createdAt",
              teamMemberId: "$teamMemberId",
            },
          },
        },
      },
      { $match: { _id: { $ne: null } } },
      { $sort: { count: -1, lastBooked: -1 } },
      {
        $facet: {
          paginatedResults: [{ $skip: skip }, { $limit: limitNum }],
          totalCount: [{ $count: "total" }],
        },
      },
    ]);

    const services = serviceHistory[0]?.paginatedResults || [];
    const totalServices = serviceHistory[0]?.totalCount[0]?.total || 0;

    // Format services for response
    const currentDateTime = new Date();
    const formattedServices = services.map((service: any) => ({
      serviceId: service.serviceId,
      name: service.name,
      count: service.count, // Number of times this service was used
      lastBooked: service.lastBooked,
      appointments: service.appointments.map((appointment: any) => {
        const appointmentDate = new Date(appointment.date);
        const [hours, minutes] = appointment.startTime.split(":").map(Number);
        appointmentDate.setHours(hours, minutes, 0, 0);
        const timeStatus =
          appointmentDate < currentDateTime ? "Past" : "Upcoming";
        return {
          appointmentId: appointment.appointmentId,
          date: appointment.date,
          startTime: appointment.startTime,
          businessId: appointment.businessId,
          status: appointment.status,
          timeStatus,
          createdAt: appointment.createdAt,
          teamMemberId: appointment.teamMemberId,
        };
      }),
    }));

    // Prepare pagination metadata
    const paginationMetadata = preparePaginationMetadata(
      totalServices,
      pagination
    );

    return successResponse(res, "Client service history fetched successfully", {
      client: {
        _id: client._id,
        name: client.name,
        email: client.email,
      },
      // pagination: paginationMetadata,
      services: formattedServices,
    });
  } catch (error: any) {
    console.error("Error fetching client service history:", error);
    const parsedError = errorParser(error);
    return errorResponseHandler(parsedError.message, parsedError.code, res);
  }
};
