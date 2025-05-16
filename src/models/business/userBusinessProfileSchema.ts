import mongoose from "mongoose";
import { customAlphabet } from "nanoid";

const businessId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8);

const userBusinessProfileSchema = new mongoose.Schema(
  {
    businessId: {
      type: String,
      unique: true,
      default: () => businessId(),
    },
    // Basic Information
    businessName: {
      type: String,
      required: true,
      trim: true,
    },
    businessDescription: {
      type: String,
      default: "",
      trim: true,
    },
    businessProfilePic: {
      type: String,
      default: "https://example.com/default-business.png",
    },
    PhoneNumber: {
      type: String,
      default: "",
    },
    countryCode: {
      type: String,
      default: "+91",
    },
    websiteLink: {
      type: String,
      default: "",
    },
    address: {
      street: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      country: { type: String, default: "" },
      postalCode: { type: String, default: "" },
    },

    selectedServices: [{
      serviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service',
        required: true
      },
      name: {
        type: String,
        required: true
      },
      isActive: {
        type: Boolean,
        default: true
      }
    }],
    businessHours: {
      monday: { open: { type: String, default: "09:00" }, close: { type: String, default: "17:00" }, isOpen: { type: Boolean, default: true } },
      tuesday: { open: { type: String, default: "09:00" }, close: { type: String, default: "17:00" }, isOpen: { type: Boolean, default: true } },
      wednesday: { open: { type: String, default: "09:00" }, close: { type: String, default: "17:00" }, isOpen: { type: Boolean, default: true } },
      thursday: { open: { type: String, default: "09:00" }, close: { type: String, default: "17:00" }, isOpen: { type: Boolean, default: true } },
      friday: { open: { type: String, default: "09:00" }, close: { type: String, default: "17:00" }, isOpen: { type: Boolean, default: true } },
      saturday: { open: { type: String, default: "09:00" }, close: { type: String, default: "17:00" }, isOpen: { type: Boolean, default: true } },
      sunday: { open: { type: String, default: "09:00" }, close: { type: String, default: "17:00" }, isOpen: { type: Boolean, default: false } },
    },   
    status: {
      type: String,
      enum: ["active", "inactive", "pending", "suspended"],
      default: "active",
    },
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
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

const UserBusinessProfile = mongoose.model("UserBusinessProfile", userBusinessProfileSchema);
export default UserBusinessProfile;
