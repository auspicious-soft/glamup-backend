import mongoose from "mongoose";
import {customAlphabet} from "nanoid";

const identifierId = customAlphabet('0123456789aeiouAEIOU', 10);

const userSchema = new mongoose.Schema({
    identifierId:{
        type:String,
        unique:true,
        default: () => identifierId(),
    },
    fullName: {
      type: String,
      required: true,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      default: "",
    },
    phoneNumber: {
      type: String,
      required: true,
      default: "",
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
    password: {
      type: String,
      required: true,
      default: "",
    },

    // Verification
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationMethod: {
      type: String,
      enum: ["email", "sms"],
      default: "email",
    },
    otp: {
      code: { type: String, default: null },
      expiresAt: { type: Date, default: null },
      verificationToken: { type: String, default: null }
    },

     otpResendAttempts: [{
    timestamp: { type: Date, required: true },
  }],
   registrationExpiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes from creation
    },

    // Flags
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },

    token: {
      type: String,
      default: null,
    },
    fcmToken: {
      type: [String],
      default: [],
    },
    deviceId: {
      type: String,
      default: null,
    },
    authType: {
      type: String,
      enum: ["email", "google", "apple"],
      default: "email",
    },

    // Profile & Preferences
    profilePic: {
      type: String,
      default: "https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/dummyUserPic.png",
    },
    languages: {
      type: [String],
      default: ["en"],
    },

    resetPasswordToken: {
      token: { type: String, default: null },
      expiresAt: { type: Date, default: null },
    },
   role: {
      type: String,
      enum: ["user", "admin"],
      default: "user",
    },
       businessRole: {
      type: String,
      enum: ["owner", "manager", "staff", "member", "client", "team-member", ""],
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

userSchema.index(
    { registrationExpiresAt: 1 },
    {
        expireAfterSeconds: 0,
        partialFilterExpression: { isVerified: false },
    }
);


const User = mongoose.model("User", userSchema);
export default User;
