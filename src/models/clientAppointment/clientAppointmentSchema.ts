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

export interface AppointmentLocation {
  type: "business" | "client" | "online" | "other";
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  meetingLink?: string;
  meetingPlatform?: string;
  notes?: string;
}

export interface IClientAppointment {
  appointmentId: string;
  clientId: mongoose.Types.ObjectId;
  businessId: mongoose.Types.ObjectId;
  businessName: string;
  businessLogo: string;
  businessAddress: string;
  businessPhone: string;
  
  // Service details
  categoryId: mongoose.Types.ObjectId;
  categoryName: string;
  services: AppointmentService[];
  package: AppointmentPackage | null;
  
  // Team member details
  teamMemberId: mongoose.Types.ObjectId;
  teamMemberName: string;
  teamMemberProfilePic: string;
  
  // Time details
  date: Date;
  endDate: Date;
  startTime: string;
  endTime: string;
  duration: number;
  timezone: string;
  
  // Location details
  location: AppointmentLocation;
  
  // Payment details
  totalPrice: number;
  discount: number;
  finalPrice: number;
  currency: string;
  paymentStatus: "PENDING" | "PARTIAL" | "PAID" | "REFUNDED";
  paymentMethod: "cash" | "card" | "online" | "other";
  paymentDate: Date | null;
  paymentId: string | null;
  
  // Appointment status
  status: "PENDING" | "CONFIRMED" | "CANCELLED" | "COMPLETED" | "NO_SHOW";
  cancellationReason: string;
  cancellationDate: Date | null;
  cancellationBy: "client" | "business" | null;
  
  // Reminders and notifications
  reminderSent: boolean;
  reminderSentAt: Date | null;
  
  // Feedback and ratings
  rating: number | null;
  review: string | null;
  reviewDate: Date | null;
  
  // Tracking
  parentAppointmentId: mongoose.Types.ObjectId | null;
  isRescheduled: boolean;
  isRecurring: boolean;
  recurringPattern: string | null;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IClientAppointmentDocument extends mongoose.Document, IClientAppointment {}

const clientAppointmentSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: String,
      unique: true,
      default: () => appointmentId(),
    },
    clientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'RegisteredClient',
      required: true,
    },
    businessId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'UserBusinessProfile',
      required: true,
    },
    businessName: {
      type: String,
      required: true,
    },
    businessLogo: {
      type: String,
      default: "",
    },
    businessAddress: {
      type: String,
      default: "",
    },
    businessPhone: {
      type: String,
      default: "",
    },
    
    // Service details
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
    },
    categoryName: {
      type: String,
      required: true,
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
    
    // Team member details
    teamMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamMember',
      required: true,
    },
    teamMemberName: {
      type: String,
      required: true,
    },
    teamMemberProfilePic: {
      type: String,
      default: "",
    },
    
    // Time details
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
    timezone: {
      type: String,
      default: "UTC",
    },
    
    // Location details
    location: {
      type: {
        type: String,
        enum: ["business", "client", "online", "other"],
        default: "business",
      },
      address: String,
      city: String,
      state: String,
      country: String,
      postalCode: String,
      meetingLink: String,
      meetingPlatform: String,
      notes: String,
      _id: false,
    },
    
    // Payment details
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
    paymentMethod: {
      type: String,
      enum: ["cash", "card", "online", "other"],
      default: "cash",
    },
    paymentDate: {
      type: Date,
      default: null,
    },
    paymentId: {
      type: String,
      default: null,
    },
    
    // Appointment status
    status: {
      type: String,
      enum: ["PENDING", "CONFIRMED", "CANCELLED", "COMEPLETED", "NO_SHOW"],
      default: "PENDING",
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
    
    // Reminders and notifications
    reminderSent: {
      type: Boolean,
      default: false,
    },
    reminderSentAt: {
      type: Date,
      default: null,
    },
    
    // Feedback and ratings
    rating: {
      type: Number,
      min: 1,
      max: 5,
      default: null,
    },
    review: {
      type: String,
      default: null,
    },
    reviewDate: {
      type: Date,
      default: null,
    },
    
    // Tracking
    parentAppointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ClientAppointment',
      default: null,
    },
    isRescheduled: {
      type: Boolean,
      default: false,
    },
    isRecurring: {
      type: Boolean,
      default: false,
    },
    recurringPattern: {
      type: String,
      default: null,
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

// Virtual for time range
clientAppointmentSchema.virtual('timeRange').get(function() {
  return `${this.startTime} - ${this.endTime}`;
});

// Pre-save hook to calculate duration if not provided
clientAppointmentSchema.pre('save', function(next) {
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

const ClientAppointment = mongoose.model<IClientAppointmentDocument>("ClientAppointment", clientAppointmentSchema);

export default ClientAppointment;