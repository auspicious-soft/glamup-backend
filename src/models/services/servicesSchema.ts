import mongoose from "mongoose";

export interface TeamMemberService {
  memberId: mongoose.Types.ObjectId;
  name: string;
}

export interface IService {
  name: string;
  categoryId: mongoose.Types.ObjectId;
  categoryName: string;
  description: string;
  duration: number; // in minutes
  priceType: "Fixed Price" | "Hourly Rate" | "range" | "";
  price: number;
  maxPrice?: number; // for range price type
  currency: string;
  businessId: mongoose.Types.ObjectId;
  teamMembers: TeamMemberService[];
  icon: string;
  tags: string[]; 
  isGlobalCategory: boolean; // Flag for services linked to global categories
  isActive: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IServiceDocument extends mongoose.Document, IService {}

const serviceSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    categoryName: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    duration: {
      type: Number,
      required: true,
      min: 5, // minimum 5 minutes
      default: 30,
    },
    priceType: {
      type: String,
      enum: ["Fixed Price", "Hourly Rate", "range",""],
      default: "Fixed Price",
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    maxPrice: {
      type: Number,
      min: 0,
      default: null,
    },
    currency: {
      type: String,
      default: "INR",
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserBusinessProfile',
      required: true,
    },
    teamMembers: [{
      memberId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'TeamMember',
      },
      name: String,
    }],
    icon: {
      type: String,
      default: "",
    },
     tags: {
      type: [String],
      default: [],
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    isGlobalCategory: {
      type: Boolean,
      default: false
    },
  },
  {
    timestamps: true,
  }
);

const Service = mongoose.model<IServiceDocument>("Service", serviceSchema);
export default Service;
