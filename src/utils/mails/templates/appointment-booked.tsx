import React from "react";

interface Props {
  clientName: string;
  businessName: string;
  date: string;
  startTime: string;
  services: string[];
}

export default function AppointmentBookedEmail({ clientName, businessName, date, startTime, services }: Props) {
  return (
    <div>
      <h2>Appointment Booked</h2>
      <p>Hi {clientName},</p>
      <p>Your appointment at <strong>{businessName}</strong> has been booked.</p>
      <p>
        <strong>Date:</strong> {date}<br />
        <strong>Time:</strong> {startTime}<br />
        <strong>Services:</strong> {services.join(", ")}
      </p>
      <p>Thank you for choosing us!</p>
    </div>
  );
}