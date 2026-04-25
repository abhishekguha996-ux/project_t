"use client";

import { DoctorWorkflowBoard } from "@/components/doctor/doctor-workflow-board";
import type { Doctor } from "@/lib/utils/types";

const DUMMY_DOCTOR: Doctor = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "Dr. Ravi Kumar",
  room: "Room 5",
  clinic_id: "00000000-0000-0000-0000-000000000000",
  status: "active",
  created_at: new Date().toISOString(),
  clerk_user_id: "00000000-0000-0000-0000-000000000000",
  specialty: "General Medicine",
  max_patients_per_day: 30,
  avg_consult_minutes: 15,
  break_return_time: null
};

const DUMMY_CLINIC = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "Qcare Demo Clinic"
};

export default function DoctorWorkspacePreview() {
  return (
    <div className="min-h-screen">
      <DoctorWorkflowBoard 
        doctor={DUMMY_DOCTOR} 
        allDoctors={[DUMMY_DOCTOR]} 
      />
    </div>
  );
}
