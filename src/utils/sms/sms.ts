// import twilio
import { customAlphabet } from "nanoid";
import { passwordResetTokenModel } from "../../models/password-token-schema";
import twilio from "twilio";
import { configDotenv } from "dotenv";
configDotenv();
// const client = twilio(process.env.ACCOUNTSID as string, process.env.AUTHTOKEN as string);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!);

export const generatePasswordResetTokenByPhoneWithTwilio = async (phoneNumber: string, token: string) => {
  try {
    // Use the token passed as parameter instead of generating a new one
    const message = `Your verification code is: ${token}. It is valid for 1 hour.`;

    // In production, use the actual phone number
    // For development, we'll log the token to console
    console.log(`SMS to ${phoneNumber}: ${message}`);

    // Uncomment this in production with proper Twilio credentials
    /*
    const res = await twilioClient.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER as string,
      to: phoneNumber,
    });
    console.log('Twilio response: ', res);
    */

    return {
      success: true,
      message: "Verification code sent via SMS",
    };
  } catch (error) {
    console.error("Error sending verification code via Twilio:", error);
    return {
      success: false,
      message: "Failed to send verification code via SMS",
      error,
    };
  }
};

export const generateOtpWithTwilio = async (phoneNumber: string, otp: string) => {
  try {
    // For development, we'll log the OTP to console
    console.log(`WhatsApp to ${phoneNumber}: Your OTP is: ${otp}`);

    // Uncomment this in production with proper Twilio credentials
    /*
    await twilioClient.messages.create({
      body: `Your OTP is: ${otp}`,
      from: `whatsapp:${process.env.FROMPHONENUMBER}`,
      to: `whatsapp:${phoneNumber}`,
    });
    */

    return {
      success: true,
      message: "OTP is sent via Whatsapp",
    };
  } catch (error) {
    console.error("Error sending OTP via Twilio:", error);
    return {
      success: false,
      message: "Failed to send OTP via Whatsapp",
      error,
    };
  }
};
