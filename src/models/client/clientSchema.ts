import mongoose from "mongoose";
import { customAlphabet } from "nanoid";

const clientId = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 10);

// Define TypeScript interfaces
export interface Address {
  street: string;
  city: string;
  region: string;
  country: string;
}

export interface PreferredService {
  serviceId: mongoose.Types.ObjectId;
  name: string;
}

export interface PreferredTeamMember {
  memberId: mongoose.Types.ObjectId;
  name: string;
}

export interface IClient {
  clientId: string;
  name: string;
  email: string;
  phoneNumber: string;
  countryCode: string;
  countryCallingCode: string;
  profilePicture: string;
  birthday: Date | null;
  gender: "male" | "female" | "other" | "prefer_not_to_say";
  address: Address;
  notes: string;
  tags: string[];
  businessId: mongoose.Types.ObjectId;
  preferredServices: PreferredService[];
  preferredTeamMembers: PreferredTeamMember[];
  lastVisit: Date | null;
  isActive: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IClientDocument extends mongoose.Document, IClient {}

const clientSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      unique: true,
      default: () => clientId(),
    },
    // Basic Information (required)
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
    // Optional fields
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
      default: "https://example.com/default-client.png",
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
    
    // Additional useful fields
    address: {
      street: { type: String, default: "" },
      city: { type: String, default: "" },
      region: { type: String, default: "" },
      country: { type: String, default: "" },
    },
    tags: {
      type: [String],
      default: [],
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserBusinessProfile',
      required: true,
    },
    preferredServices: [{
      serviceId: {
        type: mongoose.Types.ObjectId,
        ref: 'Service',
      },
      name: String,
    }],
    preferredTeamMembers: [{
      memberId: {
        type: mongoose.Types.ObjectId,
        ref: 'TeamMember',
      },
      name: String,
    }],
    lastVisit: {
      type: Date,
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
  },
  {
    timestamps: true,
  }
);

const Client = mongoose.model<IClientDocument>("Client", clientSchema);
export default Client;
