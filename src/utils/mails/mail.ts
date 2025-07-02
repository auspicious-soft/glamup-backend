import { Resend } from "resend";
import { configDotenv } from "dotenv";
import ForgotPasswordEmail from "./templates/forget-password";
import LoginCredentials from "./templates/login-credentials";
import VerifyEmail from "./templates/email-verification";
import AppointmentBookedEmailClient from "./templates/client-side/appointment-booked";
import AppointmentConfirmedEmailClient from "./templates/client-side/appointment-confirmed";
import AppointmentCompletedEmailClient from "./templates/client-side/appointment-completed";
import AppointmentCanceledEmailClient from "./templates/client-side/appointment-cancelled";
import AppointmentBookedEmailBusiness from "./templates/business-side/appointment-booked";
import AppointmentCanceledEmailBusiness from "./templates/business-side/appointment-cacelled";
configDotenv()

const resend = new Resend(process.env.RESEND_API_KEY)


export const sendPasswordResetEmail = async (email: string, token: string, language: string ) => {
   return await resend.emails.send({
        from: process.env.COMPANY_RESEND_GMAIL_ACCOUNT as string,
        to: email,
        subject: "Reset your password",
        react: ForgotPasswordEmail({ otp: token , language }),
    })
}
export const sendLoginCredentialsEmail = async (email: string, password: string) => {
   return await resend.emails.send({
        from: process.env.COMPANY_RESEND_GMAIL_ACCOUNT as string,
        to: email,
        subject: "Login Credentials",
        react: LoginCredentials({ email: email || "", password: password || "" }),
    })
}  
export const sendEmailVerificationMail = async (email:string,otp: string, language: string) => {
   return await resend.emails.send({
        from: process.env.COMPANY_RESEND_GMAIL_ACCOUNT as string,
        to: email,
        subject: "Verify Email",
        react: VerifyEmail({ otp: otp, language: language })
    })
}   

export const sendContactMailToAdmin = async (payload: { name: string, email: string, message: string, phoneNumber: string }) => {
    await resend.emails.send({
        from: process.env.COMPANY_RESEND_GMAIL_ACCOUNT as string,
        to: payload.email,
        subject: "Contact Us | New Message",
        html: `
            <h3>From: ${payload.name}</h3>
            <h3>Email: ${payload.email}</h3>
            <h3>Phone Number: ${payload.phoneNumber}</h3>
            <p>${payload.message}</p>
        `
    })
}

export const sendLatestUpdatesEmail = async (email: string, title: string, message: string) => {
    return await resend.emails.send({
        from: process.env.COMPANY_RESEND_GMAIL_ACCOUNT as string,
        to: email,
        subject: title,
        html: `
            <h3>${title}</h3>
            <p>${message}</p>
        `
    });
};
export const addedUserCreds = async (payload: any) => {
    await resend.emails.send({
        from: process.env.COMPANY_RESEND_GMAIL_ACCOUNT as string,
        to: payload.email,
        subject: "User Credentials",
        text: `Hello ${payload.name ? payload.name.eng :payload.fullName.eng},\n\nYour account has been created with the following credentials:\n\nEmail: ${payload.email}\nPassword: ${payload.password}\nRole: ${payload.role}\n\nPlease keep this information secure.`,
    })
}



// Client-side: Appointment Booked
export const sendAppointmentBookedEmailClient = async (
  email: string,
  clientName: string,
  businessName: string,
  date: string,
  startTime: string,
  services: string[]
) => {
  return await resend.emails.send({
    from: process.env.COMPANY_RESEND_GMAIL_ACCOUNT as string,
    to: email,
    subject: "Your Appointment is Booked",
    react: AppointmentBookedEmailClient({ clientName, businessName, date, startTime, services }),
  });
};

// Client-side: Appointment Confirmed
export const sendAppointmentConfirmedEmailClient = async (
  email: string,
  clientName: string,
  businessName: string,
  date: string,
  startTime: string,
  services: string[]
) => {
  return await resend.emails.send({
    from: process.env.COMPANY_RESEND_GMAIL_ACCOUNT as string,
    to: email,
    subject: "Your Appointment is Confirmed",
    react: AppointmentConfirmedEmailClient({ clientName, businessName, date, startTime, services }),
  });
};

// Client-side: Appointment Completed
export const sendAppointmentCompletedEmailClient = async (
  email: string,
  clientName: string,
  businessName: string,
  date: string,
  services: string[]
) => {
  return await resend.emails.send({
    from: process.env.COMPANY_RESEND_GMAIL_ACCOUNT as string,
    to: email,
    subject: "Appointment Completed",
    react: AppointmentCompletedEmailClient({ clientName, businessName, date, services }),
  });
};

// Client-side: Appointment Cancelled
export const sendAppointmentCanceledEmailClient = async (
  email: string,
  clientName: string,
  businessName: string,
  date: string,
  startTime: string,
  cancellationReason?: string
) => {
  return await resend.emails.send({
    from: process.env.COMPANY_RESEND_GMAIL_ACCOUNT as string,
    to: email,
    subject: "Appointment Cancelled",
    react: AppointmentCanceledEmailClient({ clientName, businessName, date, startTime, cancellationReason }),
  }); 
};

// Business-side: Appointment Booked
export const sendAppointmentBookedEmailBusiness = async (
  email: string,
  clientName: string,
  businessName: string,
  date: string,
  startTime: string,
  services: string[]
) => {
  return await resend.emails.send({
    from: process.env.COMPANY_RESEND_GMAIL_ACCOUNT as string,
    to: email,
    subject: "New Appointment Booked",
    react: AppointmentBookedEmailBusiness({ clientName, businessName, date, startTime, services }),
  });
};

// Business-side: Appointment Cancelled
export const sendAppointmentCanceledEmailBusiness = async (
  email: string,
  clientName: string,
  businessName: string,
  date: string,
  startTime: string,
  cancellationReason?: string,
  clientPhoneNumber?: string
) => {
  return await resend.emails.send({
    from: process.env.COMPANY_RESEND_GMAIL_ACCOUNT as string,
    to: email,
    subject: "Appointment Cancelled",
    react: AppointmentCanceledEmailBusiness({ clientName, businessName, date, startTime, cancellationReason, clientPhoneNumber }),
  });
};