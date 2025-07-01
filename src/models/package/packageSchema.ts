import mongoose from "mongoose";

export interface PackageService {
  serviceId: mongoose.Types.ObjectId;
  name: string;
  duration: number;
  price: number;
  categoryId: mongoose.Types.ObjectId;
  categoryName: string;
}

export interface IPackage {
  name: string;
  categoryId: mongoose.Types.ObjectId;
  categoryName: string;
  categoryIds: mongoose.Types.ObjectId[]; // Array of all category IDs
  description: string;
  services: PackageService[];
  duration: number; // total duration in minutes (manually entered by user)
  priceType: "Fixed price" | "Hourly rate" | "range" | "";
  price: number; // manually entered by user
  maxPrice?: number; // for range price type
  discountPercentage: number;
  discountAmount: number;
  finalPrice: number;
  currency: string;
  businessId: mongoose.Types.ObjectId;
  sortingOrderNo:number;
  isGlobalCategory: boolean; // Whether the primary category is a global category
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
      required: true, // Primary category
    },
    categoryName: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    categoryIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
    }],
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
      categoryId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: true,
      },
      categoryName: {
        type: String,
        required: true,
      }
    }],
    duration: {
      type: Number,
      required: true,
      min: 5, // minimum 5 minutes
    },
    priceType: {
      type: String,
      enum: ["Fixed price", "Hourly rate", "range",""],
      default: "Fixed price",
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
     sortingOrderNo: {
      type: Number,
      // required: true,
      unique: true,
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

// Pre-save middleware to assign incrementing sortingOrderNo
packageSchema.pre("save", async function (next) {
  if (this.isNew && !this.sortingOrderNo) {
    try {
      const session = this.$session();
      const query = mongoose.model("Package").findOne().sort({ sortingOrderNo: -1 });
      if (session) {
        query.session(session);
      }
      const lastPackage = await query;
      const nextOrderNo = lastPackage && lastPackage.sortingOrderNo ? lastPackage.sortingOrderNo + 1 : 1;
      this.sortingOrderNo = nextOrderNo;
      next();
    } catch (error) {
      next(error as Error);
    }
  } else {
    next();
  }
});


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



