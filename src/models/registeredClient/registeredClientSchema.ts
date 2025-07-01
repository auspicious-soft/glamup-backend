import mongoose from "mongoose";
import { customAlphabet } from "nanoid";
const clientId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 10);


export interface FavBusinesses{
  businessId:mongoose.Types.ObjectId;
  name:string;
}
// Define TypeScript interfaces
export interface IRegisteredClient {
_id?: mongoose.Types.ObjectId; // Add explicit _id type
  clientId: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  countryCode: string;
  countryCallingCode: string;
  password: string;
  isVerified: boolean;
  verificationMethod: "email" | "sms";
  favouriteBusinesses:FavBusinesses[],
  isActive: boolean;
  isDeleted: boolean;
  profilePic: string;
  languages: string[];
  authType: "email" | "google" | "apple";
  createdAt: Date;
  registrationExpiresAt?: Date
  updatedAt: Date;
}
export interface IRegisteredClientDocument extends mongoose.Document, IRegisteredClient {
  _id: mongoose.Types.ObjectId; 
}
const registeredClientSchema = new mongoose.Schema(
  {
    clientId: {
      type: String,
      unique: true,
      default: () => clientId(),
    },
    fullName: { type: String, required: true, trim: true },
    email: {
      type: String,
      required: true,
      // unique: true,
      lowercase: true,  
      trim: true,
      default:"",
    },
    phoneNumber: {
       type: String,
        required: true,
        //  unique: true 
        default:""
        },
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
favouriteBusinesses: [{
  businessId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "UserBusinessProfile", 
  },
  name: {
    type: String,
    required: true,
  },
}],
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
registrationExpiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 seconds for testing
    },
    // Flags
    isActive: { type: Boolean, default: true },

    isDeleted: { type: Boolean, default: false },

    // Profile & Preferences
    profilePic: {
      type: String,
      default: "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/dummyClientPicture.png",
    },
    languages: {
      type: [String],
      default: ["en"],
    },
    authType: {
      type: String,
      enum: ["email", "google", "apple"],
      default: "email",
    },
  },
  { timestamps: true }
);

registeredClientSchema.index(
  { registrationExpiresAt: 1 },
  {
    expireAfterSeconds: 0,
    partialFilterExpression: { isVerified: false },
  }
);


const RegisteredClient = mongoose.model<IRegisteredClientDocument>(
  "RegisteredClient",
  registeredClientSchema
);
export default RegisteredClient;
