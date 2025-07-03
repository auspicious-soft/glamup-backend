import mongoose from "mongoose";
import { customAlphabet } from "nanoid";

const appointmentId = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', 10);

// Define TypeScript interfaces
export interface AppointmentService {
  serviceId: mongoose.Types.ObjectId;
  name: string;
  duration: number;
  price: number;
}

export interface AppointmentPackage {
  packageId: mongoose.Types.ObjectId;
  name: string;
  duration: number;
  price: number;
  services: AppointmentService[];
}

export interface IAppointment {
  appointmentId: string;
  clientId: mongoose.Types.ObjectId;
   clientModel?: string;
  clientName: string;
  clientEmail: string;
  clientPhone: string;
  teamMemberId: mongoose.Types.ObjectId;
  teamMemberName: string;
  businessId: mongoose.Types.ObjectId;
  date: Date;
  endDate: Date;
  startTime: string;
  endTime: string; 
  duration: number; 
  // categoryId: mongoose.Types.ObjectId;
  // categoryName: string;
  services: AppointmentService[];
  package: AppointmentPackage | null;
  totalPrice: number;
  discount: number;
  finalPrice: number;
  currency: string;
  paymentStatus: "PENDING" | "PARTIAL" | "PAID" | "REFUNDED";
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
  cancellationReason: string;
  cancellationDate: Date | null;
  cancellationBy: "client" | "business" | null;
  parentAppointmentId: mongoose.Types.ObjectId | null;
  isRescheduled: boolean;
  createdVia:"client_booking" | "business";
  createdBy: mongoose.Types.ObjectId;
  updatedBy: mongoose.Types.ObjectId;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IAppointmentDocument extends mongoose.Document, IAppointment {}

const appointmentSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: String,
      unique: true,
      default: () => appointmentId(),
    },
   clientId: {
  type: mongoose.Schema.Types.ObjectId,
  required: true,
  refPath: 'clientModel'
},

clientModel: {
  type: String,
  required: true,
  enum: ['Client', 'RegisteredClient']
},
    clientName: {
      type: String,
      required: true,
    },
    clientEmail: {
      type: String,
      // required: true,
      default:"",
    },
    clientPhone: {
      type: String,
      default: "",
    },
    teamMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamMember',
      required: true,
    },
    teamMemberName: {
      type: String,
      required: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserBusinessProfile',
      required: true,
    },
    date: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    startTime: {
      type: String,
      required: true,
    },
    endTime: {
      type: String,
      required: true,
    },
    duration: {
      type: Number,
      required: true,
      min: 5,
    },
    // categoryId: {
    //   type: mongoose.Schema.Types.ObjectId,
    //   ref: 'Category',
    //   required: true,
    // },
    // categoryName: {
    //   type: String,
    //   required: true,
    // },
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
    package: {
      packageId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Package',
      },
      name: String,
      duration: Number,
      price: Number,
      services: [{
        serviceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Service',
        },
        name: String,
        duration: Number,
        price: Number,
      }],
      _id: false,
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0,
    },
    discount: {
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
    paymentStatus: {
      type: String,
      enum: ["PENDING", "PARTIAL", "PAID", "REFUNDED"],
      default: "PENDING",
    },
    status: {
      type: String,
      enum: ["PENDING", "CONFIRMED", "CANCELLED", "COMPLETED", "NO_SHOW"],
      default: "CONFIRMED",
    },
    cancellationReason: {
      type: String,
      default: "",
    },
     cancellationDate: {
      type: Date,
      default: null,
    },
    cancellationBy: {
      type: String,
      enum: ["client", "business", null],
      default: null,
    },
    parentAppointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Appointment',
      default: null,
    },
     isRescheduled: {
      type: Boolean,
      default: false,
    },
    // Tracking
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    createdVia: {
      type: String,
      enum: ["business", "client_booking"],
      default: "business"
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


appointmentSchema.virtual('timeRange').get(function() {
  return `${this.startTime} - ${this.endTime}`;
});

appointmentSchema.pre('save', function(next) {
  if (this.startTime && this.endTime) {
    const [startHours, startMinutes] = this.startTime.split(':').map(Number);
    const [endHours, endMinutes] = this.endTime.split(':').map(Number);
    
    let durationMinutes = (endHours * 60 + endMinutes) - (startHours * 60 + startMinutes);
    
    if (durationMinutes < 0) {
      durationMinutes += 24 * 60;
    }
    
    this.duration = durationMinutes;
  }
  next();
});

const Appointment = mongoose.model<IAppointmentDocument>("Appointment", appointmentSchema);

export default Appointment;


