import mongoose from "mongoose";
import Appointment from "../../models/appointment/appointmentSchema";
import Client from "../../models/client/clientSchema";
import TeamMember from "../../models/team/teamMemberSchema";
import Service, { IService } from "../../models/services/servicesSchema";
import Category from "../../models/category/categorySchema";
import Package from "../../models/package/packageSchema";

/**
 * Checks for scheduling conflicts
 */
export const checkForConflicts = async (
  teamMemberId: mongoose.Types.ObjectId,
  startDate: Date,
  endDate: Date,
  startTime: string,
  endTime: string,
  excludeAppointmentId?: string
) => {
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
    status: { $in: ["pending", "confirmed"] },
    isDeleted: false
  };
  
  if (excludeAppointmentId) {
    query._id = { $ne: excludeAppointmentId };
  }
  
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
    
    if (
      appointmentDate.getFullYear() === checkDate.getFullYear() &&
      appointmentDate.getMonth() === checkDate.getMonth() &&
      appointmentDate.getDate() === checkDate.getDate()
    ) {
      const existingStartMinutes = convertToMinutes(appointment.startTime);
      const existingEndMinutes = convertToMinutes(appointment.endTime);
      
      if (
        (newStartMinutes >= existingStartMinutes && newStartMinutes < existingEndMinutes) ||
        (newEndMinutes > existingStartMinutes && newEndMinutes <= existingEndMinutes) ||
        (newStartMinutes <= existingStartMinutes && newEndMinutes >= existingEndMinutes)
      ) {
        return {
          hasConflict: true,
          conflictingAppointment: appointment
        };
      }
    } else {
      return {
        hasConflict: true,
        conflictingAppointment: appointment
      };
    }
  }
  
  return { hasConflict: false };
};

/**
 * Validates if a time slot is available for a team member
 */
export const isTimeSlotAvailable = async (
  teamMemberId: string,
  startDate: Date,
  endDate: Date,
  startTime: string,
  endTime: string,
  appointmentId?: string
) => {
  try {
    const result = await checkForConflicts(
      new mongoose.Types.ObjectId(teamMemberId),
      startDate,
      endDate,
      startTime,
      endTime,
      appointmentId
    );
    
    return !result.hasConflict;
  } catch (error) {
    console.error("Error checking time slot availability:", error);
    return false;
  }
};

/**
 * Calculates the end time based on start time and duration
 */
export const calculateEndTime = (startTime: string, durationMinutes: number): string => {
  const [hours, minutes] = startTime.split(':').map(Number);
  
  let totalMinutes = hours * 60 + minutes + durationMinutes;
  const endHours = Math.floor(totalMinutes / 60) % 24;
  const endMinutes = totalMinutes % 60;
  
  return `${endHours.toString().padStart(2, '0')}:${endMinutes.toString().padStart(2, '0')}`;
};

/**
 * Validates client, team member, services, and category for an appointment
 */
export const validateAppointmentEntities = async (
  clientId: string,
  teamMemberId: string,
  categoryId: string,
  serviceIds: string[],
  startDate: Date,
  endDate: Date,
  packageId?: string,
  businessId?: string
) => {
  try {
    const client = await Client.findById(clientId);
    if (!client || client.isDeleted) {
      return { valid: false, message: "Client not found or inactive" };
    }
      const teamMember = await TeamMember.findById(teamMemberId);
    if (!teamMember || !teamMember.isActive || teamMember.isDeleted) {
      return { valid: false, message: "Team member not found or inactive" };
    }
    
    const category = await Category.findById(categoryId);
    if (!category || !category.isActive || category.isDeleted) {
      return { valid: false, message: "Category not found or inactive" };
    }
    
    if (new Date(startDate) > new Date(endDate)) {
      return { valid: false, message: "Start date cannot be after end date" };
    }
    
    if (businessId) {
      if (client.businessId.toString() !== businessId) {
        return { valid: false, message: "Client does not belong to this business" };
      }
      
      if (teamMember.businessId && teamMember.businessId.toString() !== businessId) {
        return { valid: false, message: "Team member does not belong to this business" };
      }
      
      if (category.businessId.toString() !== businessId) {
        return { valid: false, message: "Category does not belong to this business" };
      }
    }
    
    let services: IService[] = [];
    let totalDuration = 0;
    let totalPrice = 0;
    
    if (serviceIds && serviceIds.length > 0) {
      services = await Service.find({
        _id: { $in: serviceIds },
        isActive: true,
        isDeleted: false
      });
      
      if (services.length !== serviceIds.length) {
        return { valid: false, message: "One or more services not found or inactive" };
      }
      
      for (const service of services) {
        totalDuration += service.duration;
        totalPrice += service.price;
      }
    }
    
    let packageData = null;
    if (packageId) {
      packageData = await Package.findOne({
        _id: packageId,
        isActive: true,
        isDeleted: false
      });
      
      if (!packageData) {
        return { valid: false, message: "Package not found or inactive" };
      }
      
      totalDuration = packageData.duration;
      totalPrice = packageData.finalPrice;
    }
    
    return {
      valid: true,
      client,
      teamMember,
      category,
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

/**
 * Helper function to get the next date based on recurring pattern
 */
const getNextDate = (date: Date, pattern: string): Date => {
  const nextDate = new Date(date);
  
  switch (pattern) {
    case "daily":
      nextDate.setDate(date.getDate() + 1);
      break;
    case "weekly":
      nextDate.setDate(date.getDate() + 7);
      break;
    case "biweekly":
      nextDate.setDate(date.getDate() + 14);
      break;
    case "monthly":
      nextDate.setMonth(date.getMonth() + 1);
      break;
  }
  
  return nextDate;
};

/**
 * Calculates the total duration in days between two dates
 */
export const calculateDateDuration = (startDate: Date, endDate: Date): number => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Reset time to compare just the dates
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  
  // Calculate difference in days
  const diffTime = Math.abs(end.getTime() - start.getTime());
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays + 1; // Include both start and end days
};

/**
 * Prepares appointment data for creation
 */
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
  userId: mongoose.Types.ObjectId
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
      services: packageData.services.map((svc: any) => ({
        serviceId: svc.serviceId,
        name: svc.name,
        duration: svc.duration,
        price: svc.price
      }))
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
    categoryId: category._id,
    categoryName: category.name,
    services: appointmentServices,
    package: appointmentPackage,
    totalPrice,
    discount: discountAmount,
    finalPrice,
    currency: "INR",
    createdBy: userId,
    updatedBy: userId
  };
};

