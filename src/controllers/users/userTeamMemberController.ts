import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import { successResponse } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import mongoose from "mongoose";
import TeamMember from "../../models/team/teamMemberSchema";
import User from "models/user/userSchema";
import RegisteredTeamMember from "models/registeredTeamMember/registeredTeamMemberSchema";
import {
  validateUserAuth,
  findUserBusiness,
  validateObjectId,
  buildTeamMemberQuery,
  validateEmail,
  validateAndProcessServices,
  startSession,
  handleTransactionError,
  checkDuplicateTeamMemberEmail,
  buildTeamMemberSearchQuery,
} from "../../utils/user/usercontrollerUtils";
import { Readable } from "stream";
import Busboy from "busboy";
import {
  createS3Client,
  uploadStreamToS3ofTeamMember,
  getS3FullUrl,
  AWS_BUCKET_NAME,
} from "../../config/s3";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { sendTeamMemberReassignEmailClient } from "utils/mails/mail";
import RegisteredClient from "models/registeredClient/registeredClientSchema";
import Client from "models/client/clientSchema";
import Appointment from "models/appointment/appointmentSchema";
import UserBusinessProfile from "models/business/userBusinessProfileSchema";

// Helper function to handle file upload to S3
const uploadProfilePictureToS3 = async (
  req: Request,
  userEmail: string
): Promise<string | null> => {
  return new Promise((resolve, reject) => {
    if (!req.headers["content-type"]?.includes("multipart/form-data")) {
      resolve(null);
      return;
    }

    const busboy = Busboy({ headers: req.headers });
    let uploadPromise: Promise<string> | null = null;

    busboy.on(
      "file",
      async (fieldname: string, fileStream: any, fileInfo: any) => {
        if (fieldname !== "profilePicture") {
          fileStream.resume();
          return;
        }

        const { filename, mimeType } = fileInfo;

        const readableStream = new Readable();
        readableStream._read = () => {};

        fileStream.on("data", (chunk: any) => {
          readableStream.push(chunk);
        });

        fileStream.on("end", () => {
          readableStream.push(null);
        });

        uploadPromise = uploadStreamToS3ofTeamMember(
          readableStream,
          filename,
          mimeType,
          userEmail
        );
      }
    );

    busboy.on("field", (fieldname, val) => {
      if (!req.body) req.body = {};
      req.body[fieldname] = val;
    });

    busboy.on("finish", async () => {
      try {
        if (uploadPromise) {
          const imageKey = await uploadPromise;
          const fullUrl = getS3FullUrl(imageKey);
          resolve(fullUrl);
        } else {
          resolve(null);
        }
      } catch (error) {
        reject(error);
      }
    });

    req.pipe(busboy);
  });
};

// Team Member functions
export const createTeamMember = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    // Handle profile picture upload if it's a multipart request
    let profilePictureUrl = "";
    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      try {
        const business = (await findUserBusiness(userId, session)) as {
          email?: string;
        } | null;
        const businessEmail =
          (business as { email?: string })?.email || userId.toString();

        const uploadResult = await uploadProfilePictureToS3(req, businessEmail);
        if (uploadResult) {
          profilePictureUrl = uploadResult;
        }
      } catch (uploadError) {
        console.error("Error uploading profile picture:", uploadError);
      }
    }

    const {
      name,
      email,
      phoneNumber,
      countryCode,
      gender,
      birthday,
      countryCallingCode,
    } = req.body;

    if (!name || !email || !countryCallingCode) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Name, email, and countryCallingCode are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (!(await validateEmail(email, res, session))) return;

    const business = await findUserBusiness(userId, session);
    const businessId = business ? business._id : null;

    if (business) {
      const existingMember = await TeamMember.findOne({
        email,
        businessId: businessId,
        isDeleted: false,
      }).session(session);

      if (existingMember) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "A team member with this email already exists in your business",
          httpStatusCode.CONFLICT,
          res
        );
      }
    }

    const newTeamMember = await TeamMember.create(
      [
        {
          name,
          email,
          phoneNumber,
          countryCode,
          countryCallingCode,
          gender,
          birthday,
          businessId: businessId,
          userId: userId,
          profilePicture:
            profilePictureUrl ||
            "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/DummyTeamMemberPic.png",
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(
      res,
      "Team member created successfully",
      { teamMember: newTeamMember[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getAllTeamMembers = async (req: Request, res: Response) => {
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

    let businessId: mongoose.Types.ObjectId | null = null;

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

      businessId = teamMembership.businessId as mongoose.Types.ObjectId;
    } else {
      // For business owners, use the existing logic
      const business = await findUserBusiness(userId);
      businessId = business ? (business._id as mongoose.Types.ObjectId) : null;

      if (!businessId) {
        return errorResponseHandler(
          "You need to create a business profile first",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const search = req.query.search as string;

    if (!businessId) {
      return errorResponseHandler(
        "Business ID is required to fetch team members",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    let query = buildTeamMemberSearchQuery(businessId, search);

    const totalTeamMembers = await TeamMember.countDocuments(query);
    const teamMembers = await TeamMember.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(totalTeamMembers / limit);

    return successResponse(res, "Team members fetched successfully", {
      teamMembers,
      pagination: {
        totalTeamMembers,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: any) {
    console.error("Error fetching team members:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const getTeamMemberById = async (req: Request, res: Response) => {
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
      // For business owners, use the existing logic
      const business = await findUserBusiness(userId);
      businessId = business ? business._id : null;
    }

    const { memberId } = req.params;

    if (!(await validateObjectId(memberId, "Team member", res))) return;

    // Build query to find the team member
    const query = {
      _id: memberId,
      businessId: businessId,
      isDeleted: false,
    };

    const teamMember = await TeamMember.findOne(query);

    if (!teamMember) {
      return errorResponseHandler(
        "Team member not found or you don't have permission to access it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    return successResponse(res, "Team member fetched successfully", {
      teamMember,
    });
  } catch (error: any) {
    console.error("Error fetching team member:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const updateTeamMember = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { memberId } = req.params;

    if (!(await validateObjectId(memberId, "Team member", res, session)))
      return;

    const business = await findUserBusiness(userId, session);
    const businessId = business ? business._id : null;

    const query = buildTeamMemberQuery(
      memberId,
      userId,
      businessId as mongoose.Types.ObjectId | null
    );
    const existingTeamMember = await TeamMember.findOne(query).session(session);

    if (!existingTeamMember) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Team member not found or you don't have permission to update it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    let profilePictureUrl = existingTeamMember.profilePicture;
    let isDummyImage = profilePictureUrl.includes("DummyTeamMemberPic.png");

    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      try {
        const businessEmail =
          (business as { email?: string })?.email || userId.toString();

        // Upload new profile picture
        const uploadResult = await uploadProfilePictureToS3(req, businessEmail);
        if (uploadResult) {
          // If it's not a dummy image, we should delete the old one from S3
          if (!isDummyImage) {
            try {
              const s3Client = createS3Client();
              // Extract the key from the full URL
              const oldKey = profilePictureUrl.split("amazonaws.com/")[1];

              if (oldKey) {
                const deleteParams = {
                  Bucket: AWS_BUCKET_NAME,
                  Key: oldKey,
                };

                await s3Client.send(new DeleteObjectCommand(deleteParams));
                console.log(
                  "Successfully deleted old profile picture:",
                  oldKey
                );
              }
            } catch (deleteError) {
              console.error("Error deleting old profile picture:", deleteError);
              // Continue with the update even if deletion fails
            }
          }

          profilePictureUrl = uploadResult;
          console.log("New profile picture URL:", profilePictureUrl);
        }
      } catch (uploadError) {
        console.error("Profile picture upload error:", uploadError);
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Unable to process profile image. Please try again with a different image or format.",
          httpStatusCode.BAD_REQUEST,
          res
        );
      }
    }

    const {
      name,
      email,
      phoneNumber,
      countryCode,
      countryCallingCode,
      gender,
      birthday,
      role,
      specialization,
      services,
      employmentStatus,
      joinDate,
      permissions,
    } = req.body;

    if (email && email !== existingTeamMember.email) {
      if (!(await validateEmail(email, res, session))) return;

      if (
        businessId instanceof mongoose.Types.ObjectId &&
        (await checkDuplicateTeamMemberEmail(
          email,
          memberId,
          businessId,
          res,
          session
        ))
      ) {
        return;
      }
    }

    const updateData: any = {};

    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (phoneNumber !== undefined) updateData.phoneNumber = phoneNumber;
    if (countryCode !== undefined) updateData.countryCode = countryCode;
    if (countryCallingCode !== undefined)
      updateData.countryCallingCode = countryCallingCode;
    if (gender !== undefined) updateData.gender = gender;
    if (birthday !== undefined) updateData.birthday = birthday;

    // Always update profile picture if we have a new one
    if (profilePictureUrl !== existingTeamMember.profilePicture) {
      updateData.profilePicture = profilePictureUrl;
    }

    if (role !== undefined) updateData.role = role;
    if (specialization !== undefined)
      updateData.specialization = specialization;
    if (employmentStatus !== undefined)
      updateData.employmentStatus = employmentStatus;
    if (joinDate !== undefined) updateData.joinDate = joinDate;

    if (services && Array.isArray(services) && services.length > 0) {
      const processedServices = await validateAndProcessServices(
        services,
        res,
        session
      );
      if (processedServices === null) return;
      updateData.services = processedServices;
    }

    if (permissions && typeof permissions === "object") {
      updateData.permissions = {
        ...existingTeamMember.permissions,
        ...permissions,
      };
    }
    const updatedTeamMember = await TeamMember.findByIdAndUpdate(
      memberId,
      { $set: updateData },
      { new: true, session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Team member updated successfully", {
      teamMember: updatedTeamMember,
    });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};
// Helper function to add delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const deleteTeamMembers = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { teamIds } = req.body;

    if (!teamIds || !Array.isArray(teamIds) || teamIds.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Please provide an array of team member IDs",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const business = await findUserBusiness(userId, session) as InstanceType<typeof UserBusinessProfile> | null;
    const businessId = business ? business._id : null;

    if (!businessId) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Business not found",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    // First validate all IDs and collect appointment data
    const teamMembers: { id: string; name: string }[] = [];
    const notificationData: Array<{
      email: string;
      clientName: string;
      date: string;
      startTime: string;
      services: string[];
      teamMemberName: string;
    }> = [];
    let affectedAppointmentsCount = 0;

    // Email validation regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    for (const memberId of teamIds) {
      // Validate object ID
      if (!mongoose.Types.ObjectId.isValid(memberId)) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          `Invalid team member ID format: ${memberId}`,
          httpStatusCode.BAD_REQUEST,
          res
        );
      }

      // Build query to find the team member
      const query = buildTeamMemberQuery(
        memberId,
        userId,
        businessId as mongoose.Types.ObjectId | null
      );
      
      const existingTeamMember = await TeamMember.findOne(query).session(session);

      if (!existingTeamMember) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          `Team member not found or you don't have permission to delete it: ${memberId}`,
          httpStatusCode.NOT_FOUND,
          res
        );
      }

      // Find all non-cancelled appointments for this team member
      const appointments = await Appointment.find({
        teamMemberId: memberId,
        businessId: businessId,
        isDeleted: false,
        status: { $in: ["PENDING", "CONFIRMED"] }
      }).populate('clientId').session(session);

      teamMembers.push({
        id: memberId,
        name: existingTeamMember.name || 'Unknown'
      });

      // Collect notification data for each appointment
      for (const appointment of appointments) {
        let client: any = null;
        
        // Check if client is from RegisteredClient or Client model
        if (appointment.clientModel === "RegisteredClient") {
          client = await RegisteredClient.findById(appointment.clientId).session(session);
        } else {
          client = await Client.findById(appointment.clientId).session(session);
        }

        if (client && client.email && emailRegex.test(client.email)) {
          notificationData.push({
            email: client.email,
            clientName: client.name || client.fullName || "Customer",
            date: appointment.date.toISOString().split("T")[0],
            startTime: appointment.startTime,
            services: appointment.services.map((s: any) => s.name || 'Unknown Service'),
            teamMemberName: existingTeamMember.name || "Team Member"
          });
        }
      }

      affectedAppointmentsCount += appointments.length;

      // Mark team member as deleted and update appointments
      await TeamMember.findByIdAndUpdate(
        memberId,
        { $set: { isDeleted: true } },
        { session }
      );


    }

    await session.commitTransaction();
    session.endSession();

    // Send response immediately
    const response = successResponse(res, "Team members deleted successfully", {
      deletedTeamMembers: teamMembers,
      affectedAppointments: affectedAppointmentsCount,
      notifiedClients: notificationData.length
    });

    // Send notifications asynchronously with a 1-second delay between each
    setImmediate(async () => {
      try {
        const results = [];
        for (const data of notificationData) {
          const result = await sendTeamMemberReassignEmailClient(
            [data.email],
            data.clientName,
            business?.businessName || "Business",
            data.date,
            data.startTime,
            data.services,
            data.teamMemberName
          ).catch(error => {
            return { email: data.email, status: 'failed', error };
          });
          results.push(result);
          await delay(1000); // 1-second delay between emails
        }
      } catch (error) {
        // Silent error handling to prevent crashing
      }
    });

    return response;
  } catch (error: any) {
    await session.abortTransaction();
    session.endSession();
    return handleTransactionError(session, error, res);
  }
};
