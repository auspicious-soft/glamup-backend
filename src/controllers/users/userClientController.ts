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
import { createS3Client, uploadStreamToS3 } from "../../config/s3";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import mongoose from "mongoose";

// Helper function to handle file upload to S3
const uploadProfilePictureToS3 = async (req: Request, userEmail: string): Promise<string | null> => {
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
          fileStream.resume(); // Skip this file
          return;
        }

        const { filename, mimeType } = fileInfo;

        const readableStream = new Readable();
        readableStream._read = () => {}; // Required implementation

        fileStream.on("data", (chunk: any) => {
          readableStream.push(chunk);
        });

        fileStream.on("end", () => {
          readableStream.push(null); // End of stream
        });

        uploadPromise = uploadStreamToS3(
          readableStream,
          filename,
          mimeType,
          userEmail
        );
      }
    );

    busboy.on("field", (fieldname, val) => {
      // Store form fields in req.body
      if (!req.body) req.body = {};
      req.body[fieldname] = val;
    });

    busboy.on("finish", async () => {
      try {
        if (uploadPromise) {
          const imageKey = await uploadPromise;
          resolve(imageKey);
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

    // Handle file upload if it's a multipart request
    let profilePictureUrl = null;
    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      try {
        // Get business email for S3 folder structure
        const business = await mongoose.model("UserBusinessProfile").findById(businessId);
        const businessEmail = business?.email || userId.toString();
        
        profilePictureUrl = await uploadProfilePictureToS3(req, businessEmail);
      } catch (uploadError) {
        await session.abortTransaction();
        session.endSession();
        console.error("Error uploading profile picture:", uploadError);
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
    } = req.body;

    if (!name || !email || !countryCallingCode) {
      await session.abortTransaction();
      session.endSession();
      return errorResponseHandler(
        "Name, email and countryCallingCode are required",
        httpStatusCode.BAD_REQUEST,
        res
      );
    }

    if (!(await validateEmail(email, res, session))) return;

    if (await checkDuplicateClientEmail("", email, businessId, res, session)) return;

    const newClient = await Client.create(
      [
        {
          name,
          email,
          phoneNumber: phoneNumber || "",
          countryCode: countryCode || "+91",
          countryCallingCode: countryCallingCode || "IN",
          profilePicture: profilePictureUrl || "",
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

    const businessId = await validateBusinessForClient(userId, res);
    if (!businessId) return;

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

    const { clientId } = req.params;
    if (!(await validateObjectId(clientId, "Client", res))) return;

    const businessId = await validateBusinessForClient(userId, res);
    if (!businessId) return;

    const client = await validateClientAccess(clientId, businessId, res);
    if (!client) return;

    return successResponse(res, "Client fetched successfully", {
      client,
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

    const {
      name,
      email,
      phoneNumber,
      countryCode,
      countryCallingCode,
      profilePicture,
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
        profilePicture,
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

