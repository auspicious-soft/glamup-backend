import mongoose from 'mongoose';
import { Request, Response } from 'express';
import { errorResponseHandler } from '../lib/errors/error-response-handler'; // Adjust import based on your project

type TransactionCallback<T> = (session: mongoose.ClientSession) => Promise<T>;

/**
 * Wraps a function in a Mongoose transaction, handling session and transaction lifecycle.
 * @param callback - The function containing transaction logic, receives session as parameter.
 * @param res - Express response object for error handling.
 * @returns The result of the callback or throws an error.
 */
export const withTransaction = async <T>(
  callback: TransactionCallback<T>,
  res: Response
): Promise<T | null> => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const result = await callback(session);
    await session.commitTransaction();
    return result;
  } catch (error: any) {
    await session.abortTransaction();
    console.error('Transaction error:', error);
    const parsedError = errorParser(error); // Adjust based on your errorParser
    errorResponseHandler(parsedError.message, parsedError.code, res);
    return null;
  } finally {
    session.endSession();
  }
};

function errorParser(error: any): { message: string; code: number } {
    // Example implementation; adjust as needed for your error structure
    return {
        message: error.message || 'An unknown error occurred.',
        code: error.code || 500
    };
}


// Usage Example

// export const joinExistingBusiness = async (req: Request, res: Response) => {
//   return withTransaction(async (session) => {
//     const { businessId, userId } = req.body;

//     // Validate inputs
//     if (!businessId || !userId) {
//       return errorResponseHandler(
//         'Business ID and User ID are required',
//         httpStatusCode.BAD_REQUEST,
//         res
//       );
//     }

//     // Validate business ID
//     if (!mongoose.Types.ObjectId.isValid(businessId)) {
//       return errorResponseHandler(
//         'Invalid business ID format',
//         httpStatusCode.BAD_REQUEST,
//         res
//       );
//     }

//     // Validate user ID
//     if (!mongoose.Types.ObjectId.isValid(userId)) {
//       return errorResponseHandler(
//         'Invalid user ID format',
//         httpStatusCode.BAD_REQUEST,
//         res
//       );
//     }

//     // Check if business exists
//     const business = await UserBusinessProfile.findOne({
//       _id: businessId,
//       isDeleted: false,
//       status: 'active',
//     }).session(session);

//     if (!business) {
//       return errorResponseHandler(
//         'Business not found or inactive',
//         httpStatusCode.NOT_FOUND,
//         res
//       );
//     }

//     // Check if user exists
//     const user = await User.findOne({
//       _id: userId,
//       isDeleted: false,
//       isActive: true,
//     }).session(session);

//     if (!user) {
//       return errorResponseHandler(
//         'User not found or inactive',
//         httpStatusCode.NOT_FOUND,
//         res
//       );
//     }

//     // Check if user is already a team member
//     const existingTeamMember = await RegisteredTeamMember.findOne({
//       userId: userId,
//       businessId: businessId,
//       isDeleted: false,
//     }).session(session);

//     if (existingTeamMember) {
//       return errorResponseHandler(
//         'User is already a team member of this business',
//         httpStatusCode.CONFLICT,
//         res
//       );
//     }

//     // Create new registered team member
//     const newTeamMember = await RegisteredTeamMember.create(
//       [{
//         fullName: user.fullName,
//         email: user.email,
//         phoneNumber: user.phoneNumber || '',
//         countryCode: user.countryCode || '+91',
//         countryCallingCode: user.countryCallingCode || 'IN',
//         password: user.password,
//         profilePic: user.profilePic || 'https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/DummyTeamMemberPic.png',
//         businessId: businessId,
//         userId: userId,
//         isVerified: user.isVerified,
//         verificationMethod: user.verificationMethod || 'email',
//       }],
//       { session }
//     );

//     // Update user's business role
//     await User.findByIdAndUpdate(
//       userId,
//       { businessRole: 'team-member' },
//       { session }
//     );

//     // Remove sensitive data
//     const { password, ...teamMemberResponse } = newTeamMember[0].toObject();

//     return successResponse(
//       res,
//       'Successfully joined business as team member',
//       { teamMember: teamMemberResponse },
//       httpStatusCode.CREATED
//     );
//   }, res);
// };