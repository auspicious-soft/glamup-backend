import mongoose from "mongoose";

export interface PackageService {
  serviceId: mongoose.Types.ObjectId;
  name: string;
  duration: number;
  price: number;
}

export interface IPackage {
  name: string;
  categoryId: mongoose.Types.ObjectId;
  categoryName: string;
  description: string;
  services: PackageService[];
  duration: number; // total duration in minutes (manually entered by user)
  priceType: "Fixed Price" | "Hourly Rate" | "range" | "";
  price: number; // manually entered by user
  maxPrice?: number; // for range price type
  discountPercentage: number;
  discountAmount: number;
  finalPrice: number;
  currency: string;
  businessId: mongoose.Types.ObjectId;
  isActive: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPackageDocument extends mongoose.Document, IPackage {}

const packageSchema = new mongoose.Schema(
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
    services: [{
      serviceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service',
        required: true,
      },
      name: {
        type: String,
        required: true,
      },
      duration: {
        type: Number,
        required: true,
      },
      price: {
        type: Number,
        required: true,
      },
    }],
    duration: {
      type: Number,
      required: true,
      min: 5, // minimum 5 minutes
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
    discountPercentage: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },
    discountAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    finalPrice: {
      type: Number,
      required: true,
      min: 0,
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

// Pre-save middleware to calculate final price based on discount only
packageSchema.pre('save', function(next) {
  const pkg = this;
  
  // Calculate final price based on discount
  if (pkg.discountPercentage > 0) {
    pkg.discountAmount = (pkg.price * pkg.discountPercentage) / 100;
    pkg.finalPrice = pkg.price - pkg.discountAmount;
  } else if (pkg.discountAmount > 0) {
    pkg.finalPrice = pkg.price - pkg.discountAmount;
    pkg.discountPercentage = (pkg.discountAmount / pkg.price) * 100;
  } else {
    pkg.finalPrice = pkg.price;
  }
  
  next();
});

const Package = mongoose.model<IPackageDocument>("Package", packageSchema);
export default Package;

