import { NextFunction, Request, Response } from "express";
import { httpStatusCode } from "../lib/constant";
import mongoose from "mongoose";
import UserBusinessProfile from "../models/business/userBusinessProfileSchema";
import RegisteredTeamMember from "../models/registeredTeamMember/registeredTeamMemberSchema";

export const businessAccessMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Skip business access check for business profile creation endpoint
    if ( req.path.endsWith('/business-profile')) {
      return next();
    }
    
    // Get user ID from authenticated request
    const userId = (req.user as any)?.id || (req.user as any)?._id;
    
    if (!userId) {
      return res.status(httpStatusCode.UNAUTHORIZED).json({ 
        success: false, 
        message: "Unauthorized: User not authenticated" 
      });
    }

    // Get business ID from request params or query
    const businessId = req.params.businessId || req.query.businessId || req.body.businessId;
    
    if (!businessId) {
      // If no business ID is provided, check if user owns any business
      const ownedBusiness = await UserBusinessProfile.findOne({
        ownerId: userId,
        isDeleted: false,
        status: "active"
      });
      
      if (ownedBusiness) {
        // User is a business owner
        (req as any).businessId = ownedBusiness._id;
        (req as any).isBusinessOwner = true;
        return next();
      }
      
      // Check if user is a team member of any business
      const teamMembership = await RegisteredTeamMember.findOne({
        userId: userId,
        isDeleted: false,
        isActive: true
      });
      
      if (teamMembership) {
        // User is a team member
        (req as any).businessId = teamMembership.businessId;
        (req as any).isBusinessOwner = false;
        return next();
      }
      
      return res.status(httpStatusCode.FORBIDDEN).json({
        success: false,
        message: "You don't have access to any business"
      });
    }
    
    // If business ID is provided, validate access
    const ownedBusiness = await UserBusinessProfile.findOne({
      _id: businessId,
      ownerId: userId,
      isDeleted: false,
      status: "active"
    });
    
    if (ownedBusiness) {
      // User is the owner of this business
      (req as any).businessId = ownedBusiness._id;
      (req as any).isBusinessOwner = true;
      return next();
    }
    
    // Check if user is a team member of this business
    const teamMembership = await RegisteredTeamMember.findOne({
      businessId: businessId,
      userId: userId,
      isDeleted: false,
      isActive: true
    });
    
    if (teamMembership) {
      // User is a team member of this business
      (req as any).businessId = teamMembership.businessId;
      (req as any).isBusinessOwner = false;
      return next();
    }
    
    return res.status(httpStatusCode.FORBIDDEN).json({
      success: false,
      message: "You don't have access to this business"
    });
    
  } catch (error) {
    console.error("Business access middleware error:", error);
    return res.status(httpStatusCode.INTERNAL_SERVER_ERROR).json({
      success: false,
      message: "Server error during business access verification"
    });
  }
};
