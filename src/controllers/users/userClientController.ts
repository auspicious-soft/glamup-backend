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


// Clients functions
export const createClient = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const businessId = await validateBusinessForClient(userId, res, session);
    if (!businessId) return;

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
          profilePicture: profilePicture || "",
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

export const deleteClientById = async (req: Request, res: Response) => {
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

    await Client.findByIdAndUpdate(
      clientId,
      { $set: { isDeleted: true } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Client deleted successfully");
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

