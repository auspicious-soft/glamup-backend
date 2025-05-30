import mongoose from "mongoose";
import { customAlphabet } from "nanoid";

const teamMemberId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 10);

const teamMemberSchema = new mongoose.Schema(
  {
    memberId: {
      type: String,
      unique: true,
      default: () => teamMemberId(),
    },
    // Basic Information
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phoneNumber: {
      type: String,
      default: "",
    },
    countryCode: {
      type: String,
      default: "+91",
    },
    countryCallingCode: {
      type: String,
      required: true,
      default: "IN", 
    },
    profilePicture: {
      type: String,
      default: "https://example.com/default-profile.png",
    },
    birthday: {
      type: Date,
      default: null,
    },
    gender: {
      type: String,
      enum: ["male", "female", "other", "prefer_not_to_say"],
      default: "prefer_not_to_say",
    },
    
    // Business Association
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserBusinessProfile',
      default: null,
    },
    role: {
      type: String,
      enum: ["manager", "staff", "receptionist", "specialist"],
      default: "staff",
    },
    specialization: {
      type: String,
      default: "",
    },
    
    // Work Details
    services: [{
      serviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service',
      },
      name: String,
      isActive: {
        type: Boolean,
        default: true,
      }
    }],
    
    employmentStatus: {
      type: String,
      enum: ["full-time", "part-time", "contract", "intern"],
      default: "full-time",
    },
    joinDate: {
      type: Date,
      default: Date.now,
    },
    
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    
    permissions: {
      canManageAppointments: { type: Boolean, default: true },
      canManageClients: { type: Boolean, default: false },
      canManageServices: { type: Boolean, default: false },
      canManageTeam: { type: Boolean, default: false },
      canManageSettings: { type: Boolean, default: false },
      canAccessReports: { type: Boolean, default: false },
    },
  },
  {
    timestamps: true,
  }
);

export interface Shift {
  start: string;
  end: string;
}

export interface DayShift {
  isWorking: boolean;
  shifts: Shift[];
}

export interface WorkingHours {
  [key: string]: DayShift;
  monday: DayShift;
  tuesday: DayShift;
  wednesday: DayShift;
  thursday: DayShift;
  friday: DayShift;
  saturday: DayShift;
  sunday: DayShift;
}



const TeamMember = mongoose.model("TeamMember", teamMemberSchema);
export default TeamMember;
