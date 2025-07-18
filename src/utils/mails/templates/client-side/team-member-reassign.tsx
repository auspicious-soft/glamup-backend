import React from "react";

interface Props {
  clientName: string;
  businessName: string;
  date: string;
  startTime: string;
  services: string[];
  teamMemberName: string;
}

export default function TeamMemberReassignEmailClient({ clientName, businessName, date, startTime, services, teamMemberName }: Props) {
  return (
    <div>
      <h2>Appointment Team Member Change</h2>
      <p>Hi {clientName},</p>
      <p>We want to inform you that your appointment at <strong>{businessName}</strong> has been affected due to a team member change.</p>
      <p>
        <strong>Date:</strong> {date}<br />
        <strong>Time:</strong> {startTime}<br />
        <strong>Services:</strong> {services.join(", ")}<br />
        <strong>Previous Team Member:</strong> {teamMemberName}
      </p>
      <p>We will assign you a new Team Member on the site. Your appointment date and time will remain the same.</p>
      <p>We apologize for any inconvenience and appreciate your understanding.</p>
    </div>
  );
}