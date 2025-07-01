import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import { successResponse } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import {
  validateUserAuth,
  validateObjectId,
  validateEmail,
  validateAndProcessServices,
  startSession,
  handleTransactionError,
  validateBusinessForClient,
  checkDuplicateClientEmail,
  buildClientSearchQuery,
  validateClientAccess,
  processClientUpdateData,
} from "../../utils/user/usercontrollerUtils";
import Client from "models/client/clientSchema";
import { Readable } from "stream";
import Busboy from "busboy";
import { createS3Client, uploadStreamToS3ofClient, getS3FullUrl } from "../../config/s3";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import mongoose from "mongoose";
import RegisteredTeamMember from "models/registeredTeamMember/registeredTeamMemberSchema";
import User from "models/user/userSchema";
import Appointment from "models/appointment/appointmentSchema";

// Helper function to handle file upload to S3
const uploadProfilePictureToS3 = async (req: Request, userEmail: string): Promise<{ key: string, fullUrl: string } | null> => {
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

        uploadPromise = uploadStreamToS3ofClient(
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
          resolve({ key: imageKey, fullUrl });
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

// Clients functions
export const createClient = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const businessId = await validateBusinessForClient(userId, res, session);
    if (!businessId) return;

    let profilePictureUrl = null;
    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      try {
        const business = await mongoose.model("UserBusinessProfile").findById(businessId);
        const businessEmail = business?.email || userId.toString();
        
        const uploadResult = await uploadProfilePictureToS3(req, businessEmail);
        profilePictureUrl = uploadResult?.fullUrl || null;
      } catch (uploadError) {
        // Log the error but continue with client creation
        console.error("Error uploading profile picture:", uploadError);
        // No need to abort transaction or return error
      }
    }

    const {
      name,
      email,
      phoneNumber,
      countryCode,
      countryCallingCode,
      birthday,
      gender,
      address,
      notes,
      tags,
      preferredServices,
      preferredTeamMembers,
    } = req.body;

    if (!name || !countryCallingCode) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Name, email and countryCallingCode are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

  if (email) {
  if (!(await validateEmail(email, res, session))) return;
  if (await checkDuplicateClientEmail("", email, businessId, res, session)) return;
}

    const newClient = await Client.create(
      [
        {
          name,
          email: email ? email : "" ,
          phoneNumber: phoneNumber || "",
          countryCode: countryCode || "+91",
          countryCallingCode: countryCallingCode || "IN",
          // If no profile picture was uploaded, the schema default will be used
          profilePicture: profilePictureUrl || "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/dummyClientPicture.png" ,
          birthday: birthday || null,
          gender: gender || "prefer_not_to_say",
          address: address || {
            street: "",
            city: "",
            region: "",
            country: "",
          },
          notes: notes || "",
          tags: tags || [],
          businessId: businessId,
          preferredServices: preferredServices || [],
          preferredTeamMembers: preferredTeamMembers || [],
          lastVisit: null,
          isActive: true,
          isDeleted: false,
        },
      ],
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(
      res,
      "Client created successfully",
      { client: newClient[0] },
      httpStatusCode.CREATED
    );
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const getAllClients = async (req: Request, res: Response) => {
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
        isActive: true
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
      businessId = await validateBusinessForClient(userId, res);
      if (!businessId) return;
    }

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search as string;

    const query = buildClientSearchQuery(businessId, search);
    
    const totalClients = await Client.countDocuments(query);
    const clients = await Client.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const totalPages = Math.ceil(totalClients / limit);

    return successResponse(res, "Clients fetched successfully", {
      clients,
      pagination: {
        totalClients,
        totalPages,
        currentPage: page,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: any) {
    console.error("Error fetching clients:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const getClientById = async (req: Request, res: Response) => {
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
        isActive: true
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
      businessId = await validateBusinessForClient(userId, res);
      if (!businessId) return;
    }

    const { clientId } = req.params;
    if (!(await validateObjectId(clientId, "Client", res))) return;

    // Find the client that belongs to this business
    const client = await Client.findOne({
      _id: clientId,
      businessId: businessId,
      isDeleted: false
    });
    
    if (!client) {
      return errorResponseHandler(
        "Client not found or you don't have permission to access it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

      const appointments = await Appointment.find({
      clientId: client._id,
      businessId: businessId,
      isDeleted: false
    })
      .sort({ date: -1, startTime: -1 })
      .select({
        status: 1,
        description: 1,
        services: 1,
        duration: 1,
        startTime: 1,
        endTime: 1,
        date: 1,
        teamMemberId: 1,
        totalPrice: 1,
        discount: 1,
        createdAt: 1,
        updatedAt: 1,
      })
      .populate([
        { path: "services", select: "name duration price" },
        { path: "teamMemberId", select: "name email" },
        // { path: "categoryId", select: "name" }
      ])
      .lean();


       const appointmentHistory = appointments.map((appt: any) => ({
      status: appt.status,
      description: appt.description,
      services: Array.isArray(appt.services)
        ? appt.services.map((s: any) => ({
            name: s.name,
          }))
        : [],
      duration: appt.duration,
      startTime: appt.startTime,
      endTime: appt.endTime,
      date: appt.date,
      teamMember: appt.teamMemberId
        ? { name: appt.teamMemberId.name, email: appt.teamMemberId.email }
        : null,
      totalPrice: appt.totalPrice,
      discount: appt.discount,
      createdAt: appt.createdAt,
      updatedAt: appt.updatedAt,
    }));

    return successResponse(res, "Client fetched successfully", {
      client,
      appointmentHistory,
    });
  } catch (error: any) {
    console.error("Error fetching client:", error);
    const parsedError = errorParser(error);
    return res.status(parsedError.code).json({
      success: false,
      message: parsedError.message,
    });
  }
};

export const updateClientById = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { clientId } = req.params;
    if (!(await validateObjectId(clientId, "Client", res, session))) return;

    const businessId = await validateBusinessForClient(userId, res, session);
    if (!businessId) return;

    const existingClient = await validateClientAccess(clientId, businessId, res, session);
    if (!existingClient) return;

    let profilePictureUrl = existingClient.get('profilePicture');
    let isDummyImage = profilePictureUrl.includes('dummyClientPicture.png');
    
    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      try {
        const business = await mongoose.model("UserBusinessProfile").findById(businessId);
        const businessEmail = business?.email || userId.toString();
        
        const uploadResult = await uploadProfilePictureToS3(req, businessEmail);
        
        if (uploadResult && uploadResult.fullUrl) {
          // Only try to delete the old image if it's not the dummy image
          if (!isDummyImage && existingClient.get('profilePicture')) {
            try {
              // Extract the key from the full URL
              const oldPictureUrl = existingClient.get('profilePicture');
              const oldKey = oldPictureUrl.includes('amazonaws.com/') 
                ? oldPictureUrl.split('amazonaws.com/')[1]
                : oldPictureUrl;
                
              if (oldKey && oldKey.startsWith('clients/')) {
                const s3Client = createS3Client();
                await s3Client.send(new DeleteObjectCommand({
                  Bucket: process.env.AWS_BUCKET_NAME as string,
                  Key: oldKey
                }));
                console.log("Successfully deleted old client profile picture:", oldKey);
              }
            } catch (deleteError) {
              console.error("Error deleting old profile picture:", deleteError);
              // Continue with the update even if deletion fails
            }
          }
          
          profilePictureUrl = uploadResult.fullUrl;
          console.log("New client profile picture URL:", profilePictureUrl);
        } else {
          // If upload failed or returned no URL, keep the existing profile picture
          console.log("No new profile picture uploaded, keeping existing one");
        }
      } catch (uploadError) {
        await session.abortTransaction();
        session.endSession();
        return errorResponseHandler(
          "Error uploading profile picture",
          httpStatusCode.INTERNAL_SERVER_ERROR,
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
      birthday,
      gender,
      address,
      notes,
      tags,
      preferredServices,
      preferredTeamMembers,
      isActive,
    } = req.body;

    if (email && email !== existingClient.get('email')) {
      if (!(await validateEmail(email, res, session))) return;
      if (await checkDuplicateClientEmail(clientId, email, businessId, res, session)) return;
    }

    let processedServices = undefined;
    if (preferredServices && Array.isArray(preferredServices) && preferredServices.length > 0) {
      processedServices = await validateAndProcessServices(
        preferredServices,
        res,
        session
      );
      if (processedServices === null) return;
    }

    const updateData = processClientUpdateData(
      existingClient, 
      {
        name,
        email,
        phoneNumber,
        countryCode,
        countryCallingCode,
        profilePicture: profilePictureUrl, // Use the updated profile picture URL
        birthday,
        gender,
        address,
        notes,
        tags,
        preferredTeamMembers,
        isActive
      },
      processedServices
    );

    const updatedClient = await Client.findByIdAndUpdate(
      clientId,
      { $set: updateData },
      { new: true, session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Client updated successfully", {
      client: updatedClient,
    });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

export const deleteClients = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { clientIds } = req.body;

    if (!clientIds || !Array.isArray(clientIds) || clientIds.length === 0) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Please provide an array of client IDs",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    const businessId = await validateBusinessForClient(userId, res, session);
    if (!businessId) return;

    // First validate all IDs before making any changes
    for (const clientId of clientIds) {
      // Validate object ID
      if (!(await validateObjectId(clientId, "Client", res, session))) {
        return; // validateObjectId already handles the error response
      }

      // Check if client exists and belongs to the business
      const existingClient = await validateClientAccess(clientId, businessId, res, session);
      if (!existingClient) return; // validateClientAccess already handles the error response
    }

    // If we get here, all IDs are valid, so proceed with deletion
    const clients = [];
    
    for (const clientId of clientIds) {
      // Find the client to get its name for the response
      const client = await Client.findOne({
        _id: clientId,
        businessId: businessId,
        isDeleted: false
      }).session(session);
      
      // Mark the client as deleted
      await Client.findByIdAndUpdate(
        clientId,
        { $set: { isDeleted: true } },
        { session }
      );
      
      clients.push({
        id: clientId,
        name: client?.name || 'Unknown'
      });
    }

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Clients deleted successfully", {
      deletedClients: clients
    });
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};
