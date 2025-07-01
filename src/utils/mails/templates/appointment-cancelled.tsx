import React from "react";

interface Props {
  clientName: string;
  businessName: string;
  date: string;
  startTime: string;
  cancellationReason?: string;
}

export default function AppointmentCanceledEmail({ clientName, businessName, date, startTime, cancellationReason }: Props) {
  return (
    <div>
      <h2>Appointment Cancelled</h2>
      <p>Hi {clientName},</p>
      <p>Your appointment at <strong>{businessName}</strong> on {date} at {startTime} has been <b>cancelled</b>.</p>
      {cancellationReason && (
        <p><strong>Reason:</strong> {cancellationReason}</p>
      )}
      <p>If you have any questions, please contact us.</p>
    </div>
  );
}