import mongoose from "mongoose";
import { customAlphabet } from "nanoid";
const teamMemberId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);

// Define TypeScript interfaces
export interface IRegisteredTeamMember {
  _id?: mongoose.Types.ObjectId;
  teamMemberId: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  countryCode: string;
  countryCallingCode: string;
  password: string;
  isVerified: boolean;
  verificationMethod: "email" | "sms";
  isActive: boolean;
  isDeleted: boolean;
  profilePic: string;
  businessId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IRegisteredTeamMemberDocument extends mongoose.Document, IRegisteredTeamMember {
  _id: mongoose.Types.ObjectId;
}

const registeredTeamMemberSchema = new mongoose.Schema(
  {
    teamMemberId: {
      type: String,
      unique: true,
      default: () => teamMemberId(),
    },
    fullName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    phoneNumber: { type: String, required: true },
    countryCode: {
      type: String,
      required: true,
      default: "+91",
    },
    countryCallingCode: {
      type: String,
      required: true,
      default: "IN",
    },
    password: { type: String, required: true },

    // Verification
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationMethod: {
      type: String,
      enum: ["email", "phone"],
      default: "email",
    },

    // Flags
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },

    // Profile
    profilePic: {
      type: String,
      default: "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/DummyTeamMemberPic.png",
    },
    
    // Business association
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserBusinessProfile',
      required: true,
    },
    
    // User association
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

const RegisteredTeamMember = mongoose.model<IRegisteredTeamMemberDocument>(
  "RegisteredTeamMember",
  registeredTeamMemberSchema
);

export default RegisteredTeamMember;