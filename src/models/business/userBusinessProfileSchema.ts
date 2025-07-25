import mongoose from "mongoose";
import { customAlphabet } from "nanoid";

const businessId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 8);

// Define TypeScript interfaces for business hours
export interface TimeSlot {
  open: string;
  close: string;
}

export interface DaySchedule {
  isOpen: boolean;
  timeSlots: TimeSlot[];
}

export interface BusinessHours {
  [key: string]: DaySchedule;
  monday: DaySchedule;
  tuesday: DaySchedule;
  wednesday: DaySchedule;
  thursday: DaySchedule;
  friday: DaySchedule;
  saturday: DaySchedule;
  sunday: DaySchedule;
}

const timeSlotSchema = new mongoose.Schema({
  open: { type: String, required: true },
  close: { type: String, required: true }
}, { _id: false });

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
    type: [String],
    default: ["https://glamup-bucket.s3.eu-north-1.amazonaws.com/Dummy-Images/DummyBusinessProfilePic.png"],
  },
    PhoneNumber: {
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
    email: {
      type: String,
      default: "",
    },
    // Social Media Links
    websiteLink: {
      type: String,
      default: "",
    },
    facebookLink: {
      type: String,
      default: "",
    },
    instagramLink: {
      type: String,
      default: "",
    },
    messengerLink: {
      type: String,
      default: "",
    },
    address: {
      street: { type: String, default: "" },
      city: { type: String, default: "" },
      region: { type: String, default: "" },
      country: { type: String, default: "" },
    },
    country: {
      type: String,
      default: "",
    },
     coordinates: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: false
    }
  },
    selectedCategories: [{
      categoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
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
        monday: { 
          isOpen: { type: Boolean, default: true },
          timeSlots: { type: [timeSlotSchema], default: [{ open: "09:00", close: "17:00" }] }
        },
        tuesday: { 
          isOpen: { type: Boolean, default: true },
          timeSlots: { type: [timeSlotSchema], default: [{ open: "09:00", close: "17:00" }] }
        },
        wednesday: { 
          isOpen: { type: Boolean, default: true },
          timeSlots: { type: [timeSlotSchema], default: [{ open: "09:00", close: "17:00" }] }
        },
        thursday: { 
          isOpen: { type: Boolean, default: true },
          timeSlots: { type: [timeSlotSchema], default: [{ open: "09:00", close: "17:00" }] }
        },
        friday: { 
          isOpen: { type: Boolean, default: true },
          timeSlots: { type: [timeSlotSchema], default: [{ open: "09:00", close: "17:00" }] }
        },
        saturday: { 
          isOpen: { type: Boolean, default: true },
          timeSlots: { type: [timeSlotSchema], default: [{ open: "09:00", close: "17:00" }] }
        },
        sunday: { 
          isOpen: { type: Boolean, default: false },
          timeSlots: { type: [timeSlotSchema], default: [{ open: "09:00", close: "17:00" }] }
        },
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

userBusinessProfileSchema.index({ coordinates: "2dsphere" });


const UserBusinessProfile = mongoose.model("UserBusinessProfile", userBusinessProfileSchema);
export default UserBusinessProfile;




