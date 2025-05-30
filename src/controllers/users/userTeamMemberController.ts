import { Request, Response } from "express";
import { httpStatusCode } from "../../lib/constant";
import { successResponse } from "../../utils/userAuth/signUpAuth";
import {
  errorResponseHandler,
  errorParser,
} from "../../lib/errors/error-response-handler";
import mongoose from "mongoose";
import TeamMember from "../../models/team/teamMemberSchema";
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
} from "../../utils/user/usercontrollerUtils";


// Team Member functions
export const createTeamMember = async (req: Request, res: Response) => {
  const session = await startSession();

  try {
    const userId = await validateUserAuth(req, res, session);
    if (!userId) return;

    const { name, email, phoneNumber, countryCode, gender, birthday, countryCallingCode } =
      req.body;
    
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

    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const skip = (page - 1) * limit;

    const search = req.query.search as string;

    const business: any = await findUserBusiness(userId);
    const businessId = business ? business._id : null;

    let query: any = { isDeleted: false };

    if (businessId) {
      query.businessId = businessId;
    } else {
      query.userId = userId;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phoneNumber: { $regex: search, $options: "i" } },
        { specialization: { $regex: search, $options: "i" } },
      ];
    }

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

    const { memberId } = req.params;

    if (!(await validateObjectId(memberId, "Team member", res))) return;

    const business = await findUserBusiness(userId);
    const businessId = business ? business._id : null;

    const query = buildTeamMemberQuery(
      memberId,
      userId,
      businessId as mongoose.Types.ObjectId | null
    );
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

    const {
      name,
      email,
      phoneNumber,
      countryCode,
      countryCallingCode,
      gender,
      birthday,
      profilePicture,
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
    if (profilePicture !== undefined)
      updateData.profilePicture = profilePicture;
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

export const deleteTeamMember = async (req: Request, res: Response) => {
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
        "Team member not found or you don't have permission to delete it",
        httpStatusCode.NOT_FOUND,
        res
      );
    }

    await TeamMember.findByIdAndUpdate(
      memberId,
      { $set: { isDeleted: true } },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    return successResponse(res, "Team member deleted successfully");
  } catch (error: any) {
    return handleTransactionError(session, error, res);
  }
};

