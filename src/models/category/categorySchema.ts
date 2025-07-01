import mongoose from "mongoose";

export interface ICategory {
  name: string;
  description: string;
  businessId: mongoose.Types.ObjectId;
  sortingOrderNo:number;
  isActive: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICategoryDocument extends mongoose.Document, ICategory {}

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
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
categorySchema.pre("save", async function (next) {
  if (this.isNew && !this.sortingOrderNo) {
    try {
      const session = this.$session();
      const query = mongoose.model("Category").findOne().sort({ sortingOrderNo: -1 });
      if (session) {
        query.session(session);
      }
      const lastCategory = await query;
      const nextOrderNo = lastCategory && lastCategory.sortingOrderNo ? lastCategory.sortingOrderNo + 1 : 1;
      this.sortingOrderNo = nextOrderNo;
      next();
    } catch (error) {
      next(error as Error);
    }
  } else {
    next();
  }
});


const Category = mongoose.model<ICategoryDocument>("Category", categorySchema);
export default Category;
