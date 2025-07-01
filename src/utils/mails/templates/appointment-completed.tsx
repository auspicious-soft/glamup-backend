import React from "react";

interface Props {
  clientName: string;
  businessName: string;
  date: string;
  services: string[];
}

export default function AppointmentCompletedEmail({ clientName, businessName, date, services }: Props) {
  return (
    <div>
      <h2>Appointment Completed</h2>
      <p>Hi {clientName},</p>
      <p>Your appointment at <strong>{businessName}</strong> on {date} has been completed.</p>
      <p>
        <strong>Services:</strong> {services.join(", ")}
      </p>
      <p>Thank you for visiting us! We hope to see you again.</p>
    </div>
  );
}