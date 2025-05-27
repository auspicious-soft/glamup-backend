import mongoose from "mongoose";

export interface IGlobalCategory {
  name: string;
  description: string;
  icon: string;
  isActive: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IGlobalCategoryDocument extends mongoose.Document, IGlobalCategory {}

const globalCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    description: {
      type: String,
      default: "",
    },
    icon: {
      type: String,
      default: "",
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

const GlobalCategory = mongoose.model<IGlobalCategoryDocument>("GlobalCategory", globalCategorySchema);
export default GlobalCategory;