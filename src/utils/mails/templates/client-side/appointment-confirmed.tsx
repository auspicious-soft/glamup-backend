import React from "react";

interface Props {
  clientName: string;
  businessName: string;
  date: string;
  startTime: string;
  services: string[];
}

export default function AppointmentConfirmedEmailClient({ clientName, businessName, date, startTime, services }: Props) {
  return (
    <div>
      <h2>Appointment Confirmed</h2>
      <p>Hi {clientName},</p>
      <p>Your appointment at <strong>{businessName}</strong> has been <b>confirmed</b>.</p>
      <p>
        <strong>Date:</strong> {date}<br />
        <strong>Time:</strong> {startTime}<br />
        <strong>Services:</strong> {services.join(", ")}
      </p>
      <p>We look forward to seeing you!</p>
    </div>
  );
}