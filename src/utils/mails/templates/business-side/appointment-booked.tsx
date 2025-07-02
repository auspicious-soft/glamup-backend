import React from "react";

interface Props {
  clientName: string;
  businessName: string;
  date: string;
  startTime: string;
  services: string[];
}

export default function AppointmentBookedEmailBusiness({ clientName, businessName, date, startTime, services }: Props) {
  return (
    <div>
      <h2>Appointment Booked</h2>
      <p>Hi {businessName},</p>
      <p>{clientName} has booked a appointment at <strong>{businessName}</strong></p>
      <p>Kindly Confirm the booking or cancel it according to the availability.</p>
      <p>
        <strong>Date:</strong> {date}<br />
        <strong>Time:</strong> {startTime}<br />
        <strong>Services:</strong> {services.join(", ")}
      </p>
      <p>Thank you for choosing us!</p>
    </div>
  );
}