import mongoose from "mongoose";
import Appointment from "../../models/appointment/appointmentSchema";
import Client from "../../models/client/clientSchema";
import TeamMember from "../../models/team/teamMemberSchema";
import Service, { IService } from "../../models/services/servicesSchema";
import Category from "../../models/category/categorySchema";
import Package from "../../models/package/packageSchema";
import UserBusinessProfile from "../../models/business/userBusinessProfileSchema";
import Business from "../../models/business/userBusinessProfileSchema";
import { Response } from "express";
import { errorResponseHandler } from "../../lib/errors/error-response-handler";
import { httpStatusCode } from "../../lib/constant";
import RegisteredTeamMember from "models/registeredTeamMember/registeredTeamMemberSchema";

//  Validates business profile and returns business ID
export const validateBusinessProfile = async (
  userId: string,
  res: Response,
  session?: mongoose.ClientSession
): Promise<mongoose.Types.ObjectId | null> => {
  // Get user to check role
  const user = session
    ? await mongoose.model('User').findById(userId).session(session)
    : await mongoose.model('User').findById(userId);
  
  if (!user) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "User not found",
      httpStatusCode.NOT_FOUND,
      res
    );
    return null;
  }
  
  // If user is a team member, get the business ID from team membership
  if (user.businessRole === "team-member") {
    const teamMembership = session
      ? await RegisteredTeamMember.findOne({
          userId: userId,
          isDeleted: false,
          isActive: true
        }).session(session)
      : await RegisteredTeamMember.findOne({
          userId: userId,
          isDeleted: false,
          isActive: true
        });
    
    if (teamMembership && teamMembership.businessId) {
      return teamMembership.businessId as mongoose.Types.ObjectId;
    }
    
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "You don't have access to any business",
      httpStatusCode.FORBIDDEN,
      res
    );
    return null;
  }
  
  // For business owners, use the original logic
  const businessProfile = session
    ? await UserBusinessProfile.findOne({
        ownerId: userId,
        isDeleted: false
      }).session(session)
    : await UserBusinessProfile.findOne({
        ownerId: userId,
        isDeleted: false
      });
  
  if (!businessProfile) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Business profile not found",
      httpStatusCode.NOT_FOUND,
      res
    );
    return null;
  }
  
  return businessProfile._id;
};

// Validates appointment existence and ownership
export const validateAppointmentAccess = async (
  appointmentId: string,
  businessId: mongoose.Types.ObjectId,
  res: Response,
  session?: mongoose.ClientSession
): Promise<any | null> => {
  if (!appointmentId) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Appointment ID is required",
      httpStatusCode.BAD_REQUEST,
      res
    );
    return null;
  }
  
  const appointment = session
    ? await Appointment.findOne({
        _id: appointmentId,
        businessId: businessId,
        isDeleted: false
      }).session(session)
    : await Appointment.findOne({
        _id: appointmentId,
        businessId: businessId,
        isDeleted: false
      });
  
  if (!appointment) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Appointment not found or doesn't belong to your business",
      httpStatusCode.NOT_FOUND,
      res
    );
    return null;
  }
  
  return appointment;
};

// Validates team member existence and ownership
export const validateTeamMemberAccess = async (
  teamMemberId: string,
  businessId: mongoose.Types.ObjectId,
  res: Response,
  session?: mongoose.ClientSession
): Promise<any | null> => {
  if (!teamMemberId) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Team member ID is required",
      httpStatusCode.BAD_REQUEST,
      res
    );
    return null;
  }
  
  const teamMember = session
    ? await TeamMember.findOne({
        _id: teamMemberId,
        businessId: businessId,
        isDeleted: false
      }).session(session)
    : await TeamMember.findOne({
        _id: teamMemberId,
        businessId: businessId,
        isDeleted: false
      });
  
  if (!teamMember) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    errorResponseHandler(
      "Team member not found or doesn't belong to your business",
      httpStatusCode.NOT_FOUND,
      res
    );
    return null;
  }
  
  return teamMember;
};

// Builds date range query for appointments
export const buildDateRangeQuery = (dateParam: any, startDateParam: any, endDateParam: any): any => {
  if (dateParam) {
    const queryDate = new Date(dateParam);
    
    if (isNaN(queryDate.getTime())) {
      return { error: "Invalid date format. Please use YYYY-MM-DD" };
    }
    
    const startOfDay = new Date(queryDate);
    startOfDay.setHours(0, 0, 0, 0);
    
    const endOfDay = new Date(queryDate);
    endOfDay.setHours(23, 59, 59, 999);
    
    return {
      $or: [
        { date: { $gte: startOfDay, $lte: endOfDay } },
        { endDate: { $gte: startOfDay, $lte: endOfDay } },
        { date: { $lte: startOfDay }, endDate: { $gte: endOfDay } }
      ]
    };
  } else if (startDateParam && endDateParam) {
    const start = new Date(startDateParam);
    const end = new Date(endDateParam);
    
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return { error: "Invalid date format. Please use YYYY-MM-DD" };
    }
    
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
    
    return {
      $or: [
        { date: { $gte: start, $lte: end } },
        { endDate: { $gte: start, $lte: end } },
        { date: { $lte: start }, endDate: { $gte: end } }
      ]
    };
  }
  
  return null;
};

// Validates appointment status
export const validateAppointmentStatus = (status: string): { valid: boolean; message?: string } => {
  const validStatuses = ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"];
  
  if (!validStatuses.includes(status)) {
    return {
      valid: false,
      message: "Invalid status. Must be one of: PENDING, CONFIRMED, CANCELLED, COMPLETED, NO_SHOW"
    };
  }
  
  return { valid: true };
};

//  Builds query for appointment filtering
export const buildAppointmentQuery = (
  businessId: mongoose.Types.ObjectId,
  teamMemberId?: string,
  clientId?: string,
  categoryId?: string,
  status?: string,
  dateQuery?: any
): any => {
  const query: any = {
    businessId: businessId,
    isDeleted: false
  };
  
  if (teamMemberId) {
    query.teamMemberId = teamMemberId;
  }
  
  if (clientId) {
    query.clientId = clientId;
  }
  
  if (categoryId) {
    query.categoryId = categoryId;
  }
  
 if (status !== undefined && status !== "") {
  const statusValidation = validateAppointmentStatus(status);
  if (!statusValidation.valid) {
    return { error: statusValidation.message };
  }
  query.status = status;
}
  
  if (dateQuery) {
    if (dateQuery.error) {
      return { error: dateQuery.error };
    }
    query.$or = dateQuery.$or;
  }
  
  return query;
};

// Prepares pagination parameters
export const preparePagination = (page?: string, limit?: string): { skip: number; limit: number; page: number } => {
  const pageNum = parseInt(page || '1');
  let limitNum = parseInt(limit || '20'); // Default to 20
  if (isNaN(limitNum) || limitNum <= 0) limitNum = 20;
  if (limitNum > 100) limitNum = 100; // Enforce max limit of 20
  const skip = (pageNum - 1) * limitNum;

  return {
    skip,
    limit: limitNum,
    page: pageNum
  };
};

// Checks if team member is changed and needs availability check
export const isTeamMemberChanged = (
  teamMemberId: string | undefined,
  existingAppointment: any
): boolean => {
  return teamMemberId !== undefined && 
         existingAppointment.teamMemberId && 
         teamMemberId !== existingAppointment.teamMemberId.toString();
};

//  Prepares appointment update data from request and existing appointment
export const prepareAppointmentUpdateData = (
  req: any,
  existingAppointment: any
): {
  clientId: string;
  teamMemberId: string;
  categoryId: string;
  serviceIds: string[];
  startDate: Date;
  endDate: Date;
  startTime: string;
  endTime: string;
} => {
  const { 
    clientId, 
    teamMemberId, 
    startDate, 
    startTime, 
    endTime,
    categoryId, 
    serviceIds
  } = req.body;
  
  const checkClientId = clientId !== undefined ? clientId : 
                       (existingAppointment.clientId ? existingAppointment.clientId.toString() : '');
  
  const checkTeamMemberId = teamMemberId !== undefined ? teamMemberId : 
                           (existingAppointment.teamMemberId ? existingAppointment.teamMemberId.toString() : '');
  
  const checkCategoryId = categoryId !== undefined ? categoryId : 
                         (existingAppointment.categoryId ? existingAppointment.categoryId.toString() : '');
  
  const checkServiceIds = serviceIds !== undefined ? serviceIds : 
                         (existingAppointment.services && Array.isArray(existingAppointment.services) ? 
                          existingAppointment.services.map((s: any) => s.serviceId ? s.serviceId.toString() : '') : []);
  
  const checkStartDate = startDate !== undefined ? new Date(startDate) : existingAppointment.date;
  const checkEndDate = checkStartDate; // Use same date for end date
  const checkStartTime = startTime !== undefined ? startTime : existingAppointment.startTime;
  const checkEndTime = endTime !== undefined ? endTime : existingAppointment.endTime;
  
  return {
    clientId: checkClientId,
    teamMemberId: checkTeamMemberId,
    categoryId: checkCategoryId,
    serviceIds: checkServiceIds.filter((id: string) => id),
    startDate: checkStartDate,
    endDate: checkEndDate,
    startTime: checkStartTime,
    endTime: checkEndTime
  };
};

//  Checks for scheduling conflicts
export const checkForConflicts = async (
  teamMemberId: mongoose.Types.ObjectId,
  startDate: Date,
  endDate: Date,
  startTime: string,
  endTime: string,
  clientId?: string,
  excludeAppointmentId?: string
) => {
  // Base query for team member availability
  const query: any = {
    teamMemberId,
    $or: [
      { 
        date: { $gte: startDate, $lte: endDate } 
      },
      { 
        endDate: { $gte: startDate, $lte: endDate } 
      },
      {
        date: { $lte: startDate },
        endDate: { $gte: endDate }
      }
    ],
    status: { $in: ["PENDING", "CONFIRMED"] }, // Make sure status is uppercase to match schema
    isDeleted: false
  };
  
  if (excludeAppointmentId) {
    query._id = { $ne: excludeAppointmentId };
  }
  
  // Check for any conflicting appointments for this team member
  const appointments = await Appointment.find(query);
  
  const convertToMinutes = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  };
  
  const newStartMinutes = convertToMinutes(startTime);
  const newEndMinutes = convertToMinutes(endTime);
  
  for (const appointment of appointments) {
    const appointmentDate = new Date(appointment.date);
    const appointmentEndDate = new Date(appointment.endDate);
    const checkDate = new Date(startDate);
    
    // Check if dates overlap
    if (
      appointmentDate.getFullYear() === checkDate.getFullYear() &&
      appointmentDate.getMonth() === checkDate.getMonth() &&
      appointmentDate.getDate() === checkDate.getDate()
    ) {
      const existingStartMinutes = convertToMinutes(appointment.startTime);
      const existingEndMinutes = convertToMinutes(appointment.endTime);
      
      // Check if time slots overlap
      if (
        (newStartMinutes >= existingStartMinutes && newStartMinutes < existingEndMinutes) ||
        (newEndMinutes > existingStartMinutes && newEndMinutes <= existingEndMinutes) ||
        (newStartMinutes <= existingStartMinutes && newEndMinutes >= existingEndMinutes)
      ) {
        // If clientId is provided, check if this is the same client trying to book the same slot
        if (clientId && appointment.clientId.toString() === clientId.toString()) {
          return {
            hasConflict: true,
            conflictingAppointment: appointment,
            isSameClient: true
          };
        }
        
        return {
          hasConflict: true,
          conflictingAppointment: appointment,
          isSameClient: false
        };
      }
    }
  }
  
  return { hasConflict: false };
};

//  Validates if a time slot is available for a team member
export const isTimeSlotAvailable = async (
  teamMemberId: string,
  startDate: Date,
  endDate: Date,
  startTime: string,
  endTime: string,
  clientId?: string,
  appointmentId?: string
) => {
  try {
    const result = await checkForConflicts(
      new mongoose.Types.ObjectId(teamMemberId),
      startDate,
      endDate,
      startTime,
      endTime,
      clientId,
      appointmentId
    );
    
    return !result.hasConflict;
  } catch (error) {
    console.error("Error checking time slot availability:", error);
    return false;
  }
};

// Calculates the end time based on start time and duration
export const calculateEndTime = (startTime: string, durationMinutes: number): string => {
  const [hours, minutes] = startTime.split(':').map(Number);
  
  let totalMinutes = hours * 60 + minutes + durationMinutes;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  
  return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
};

// Validates client, team member, services, and category for an appointment
export const validateAppointmentEntities = async (
  clientId: string,
  teamMemberId: string,
  categoryId: string | undefined,
  serviceIds: string[],
  startDate: Date,
  endDate: Date,
  packageId?: string,
  businessId?: string,
  finalClientId?: string,
  session?: mongoose.ClientSession
): Promise<any> => {
  try {
    // Validate client - use session if provided
    const clientQuery = {
      _id: clientId,
      isDeleted: false
    };
    
    const client = session 
      ? await Client.findOne(clientQuery).session(session)
      : await Client.findOne(clientQuery);
    
    if (!client) {
      console.log(`Client not found with ID: ${clientId}`);
      return { valid: false, message: "Client not found" };
    }
    
    // Validate team member - use session if provided
    const teamMemberQuery = {
      _id: teamMemberId,
      isDeleted: false
    };
    
    const teamMember = session
      ? await TeamMember.findOne(teamMemberQuery).session(session)
      : await TeamMember.findOne(teamMemberQuery);
    
    if (!teamMember) {
      return { valid: false, message: "Team member not found" };
    }
    
    // Validate services and calculate total duration and price
    let services: IService[] = [];
    let totalDuration = 0;
    let totalPrice = 0;
    let category;
    
    if (packageId && (!serviceIds || serviceIds.length === 0)) {
      // Handle package-only case
      const packageItem = await Package.findOne({
        _id: packageId,
        isDeleted: false
      })
      
      if (!packageItem) {
        return { valid: false, message: "Package not found" };
      }
      
      totalDuration = packageItem.duration || 0;
      totalPrice = packageItem.price || 0;
      services = packageItem.services as any || []; // Include package services if available
      category = {
        _id: packageItem.categoryId,
        name: packageItem.categoryName || "Package Category" // Adjust based on Package schema
      };
    } else if (serviceIds && serviceIds.length > 0) {
      // Original service validation logic
      services = await Service.find({
        _id: { $in: serviceIds },
        isDeleted: false
      })
      
      const foundServiceIds = services.map(s => {
        const id = (s as any)._id || (s as any).id || (s as any).serviceId;
        return id ? id.toString() : '';
      });
      const missingServiceIds = serviceIds.filter(id => !foundServiceIds.includes(id));
      
      if (missingServiceIds.length > 0 && businessId) {
        const business = await Business.findById(businessId)
        if (business) {
          const selectedCategories = business.selectedCategories || [];
          for (const catId of selectedCategories) {
            const categoryData = await Category.findById(catId).populate('services')
            const populatedServices = categoryData?.get('services') as any[] | undefined;
            if (categoryData && populatedServices) {
              for (const missingId of missingServiceIds) {
                const globalService = populatedServices.find(
                  (s: any) => s._id.toString() === missingId
                );
                if (globalService) {
                  services.push(globalService);
                }
              }
            }
          }
        }
      }
      
      // If we still have missing services, return error
      // if (services.length !== serviceIds.length) {
      //   return { 
      //     valid: false, 
      //     message: "One or more services not found" 
      //   };
      // }
      
      // Calculate total duration and price
      for (const service of services) {
        totalDuration += service.duration || 0;
        totalPrice += service.price || 0;
      }
    }
    
    // For global category services, we don't need to validate the category
    // since we've already validated the services
    // let category;
    // const isGlobalCategoryService = services.some(s => s.isGlobalCategory);
    
    // if (!isGlobalCategoryService) {
    //   // Only validate category for non-global services
    //   category = await Category.findOne({
    //     _id: categoryId,
    //     isActive: true,
    //     isDeleted: false
    //   });
      
    //   if (!category) {
    //     return { valid: false, message: "Category not found or inactive" };
    //   }
    // } else {
    //   // For global category services, get the category info from the business profile
    //   if (businessId) {
    //     const business = await Business.findById(businessId);
    //     if (business) {
    //       const globalCatInfo = business.selectedCategories.find(
    //         (cat: any) => cat.categoryId.toString() === categoryId
    //       );
          
    //       if (globalCatInfo) {
    //         category = {
    //           _id: globalCatInfo.categoryId,
    //           name: globalCatInfo.name
    //         };
    //       }
    //     }
    //   }
      
    //   if (!category) {
    //     // Try to get the category directly from GlobalCategory model
    //     const globalCategory = await mongoose.model("GlobalCategory").findOne({
    //       _id: categoryId,
    //       isActive: true,
    //       isDeleted: false
    //     });
        
    //     if (globalCategory) {
    //       category = {
    //         _id: globalCategory._id,
    //         name: globalCategory.name
    //       };
    //     } else {
    //       return { valid: false, message: "Global category not found or inactive" };
    //     }
    //   }
    // }
    
    // Validate package if provided
    let packageData = null;
    if (packageId) {
      const packageItem = await Package.findOne({
        _id: packageId,
        isDeleted: false
      });
      
      if (!packageItem) {
        return { valid: false, message: "Package not found" };
      }
      
      packageData = packageItem;
    }
    
    return {
      valid: true,
      client,
      teamMember,
      // category,
      services,
      packageData,
      totalDuration,
      totalPrice
    };
  } catch (error) {
    console.error("Error validating appointment entities:", error);
    return { valid: false, message: "Error validating appointment data" };
  }
};

// Prepares appointment data for creation
export const prepareAppointmentData = (
  client: any,
  teamMember: any,
  category: any,
  services: any[],
  packageData: any,
  businessId: mongoose.Types.ObjectId,
  date: Date,
  endDate: Date,
  startTime: string,
  endTime: string,
  totalDuration: number,
  totalPrice: number,
  discount: number,
  userId: mongoose.Types.ObjectId,
  clientModel?: string,
) => {
  const discountAmount = discount || 0;
  const finalPrice = totalPrice - discountAmount;

  const appointmentServices = services.map(service => ({
    serviceId: service._id,
    name: service.name,
    duration: service.duration,
    price: service.price
  }));

  let appointmentPackage = null;
  if (packageData) {
    appointmentPackage = {
      packageId: packageData._id,
      name: packageData.name,
      duration: packageData.duration,
      price: packageData.price,
      services: packageData.services?.map((svc: any) => ({
        serviceId: svc.serviceId || svc._id,
        name: svc.name,
        duration: svc.duration,
        price: svc.price
      })) || []
    };
  }

  return {
    clientId: client._id,
    clientName: client.name,
    clientEmail: client.email,
    clientPhone: client.phoneNumber || "",
    teamMemberId: teamMember._id,
    teamMemberName: teamMember.name,
    businessId: businessId,
    date: new Date(date),
    endDate: new Date(endDate),
    startTime,
    endTime,
    duration: totalDuration,
    categoryId: category?._id,
    categoryName: category?.name,
    services: appointmentServices,
    package: appointmentPackage,
    totalPrice,
    discount: discountAmount,
    finalPrice,
    currency: "INR",
    createdBy: userId,
    updatedBy: userId,
    ...(clientModel ? { clientModel } : {}),
  };
};

// Validates required appointment fields
export const validateRequiredAppointmentFields = (
  clientId?: string,
  teamMemberId?: string,
  startDate?: string,
  startTime?: string,
  categoryId?: string
): boolean => {
  if (!clientId || !teamMemberId || !startDate || !startTime || !categoryId) {
    return false;
  }
  return true;  
};

// Formats date for response
export const formatDateForResponse = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

// Prepares team member data for response
export const prepareTeamMemberResponse = (teamMember: any): any => {
  if (!teamMember) return null;
  
  return {
    _id: teamMember._id,
    name: teamMember.name,
    email: teamMember.email,
    phoneNumber: teamMember.phoneNumber,
    specialization: teamMember.specialization,
    isActive: teamMember.isActive
  };
};
// Prepares pagination metadata for response
export const preparePaginationMetadata = (
  totalItems: number,
  pagination: { skip: number; limit: number; page: number },
  filteredItems?: any[]
): {
  totalItems: number;
  totalPages: number;
  currentPage: number;
  limit: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
} => {
  // If filtered items are provided, use their length instead of total
  const count = filteredItems ? filteredItems.length : totalItems;
  const totalPages = Math.ceil(count / pagination.limit);
  
  return {
    totalItems: count,
    totalPages,
    currentPage: pagination.page,
    limit: pagination.limit,
    hasNextPage: pagination.page < totalPages,
    hasPrevPage: pagination.page > 1
  };
};


