import React from "react";

interface Props {
  clientName: string;
  businessName: string;
  date: string;
  startTime: string;
  cancellationReason?: string;
  clientPhoneNumber?:string;
}

export default function AppointmentCanceledEmailBusiness({ clientName, businessName, date, startTime, cancellationReason, clientPhoneNumber }: Props) {
  return (
    <div>
      <h2>Appointment Cancelled</h2>
      <p>Hi {businessName},</p>
      <p>{clientName} has cancelled the appointment at <strong>{businessName}</strong> on {date} at {startTime}. </p>
      {cancellationReason && (
        <p><strong>Reason:</strong> {cancellationReason}</p>
      )}
      <p>If you have any questions for {clientName}, please contact him at {clientPhoneNumber}. </p>
    </div>
  );
}