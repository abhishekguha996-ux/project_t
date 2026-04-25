import { ReceptionWorkspace } from "@/components/reception/reception-workspace";
import type { Clinic, Doctor } from "@/lib/utils/types";

const previewClinic: Clinic = {
  id: "preview-clinic",
  name: "QCare Preview Clinic",
  address: "Banjara Hills, Hyderabad",
  phone: "+91-40-4000-1234",
  subscription_tier: "pro",
  opening_time: "09:00",
  closing_time: "20:00",
  created_at: new Date().toISOString()
};

const previewDoctors: Doctor[] = [
  {
    id: "doctor-ravi",
    clinic_id: "preview-clinic",
    clerk_user_id: null,
    name: "Dr. Ravi Kumar",
    specialty: "General Medicine",
    room: "Room 5",
    max_patients_per_day: 80,
    avg_consult_minutes: 8,
    status: "active",
    break_return_time: null,
    created_at: new Date().toISOString()
  },
  {
    id: "doctor-neha",
    clinic_id: "preview-clinic",
    clerk_user_id: null,
    name: "Dr. Neha Sinha",
    specialty: "Family Medicine",
    room: "Room 3",
    max_patients_per_day: 70,
    avg_consult_minutes: 10,
    status: "active",
    break_return_time: null,
    created_at: new Date().toISOString()
  },
  {
    id: "doctor-anshul",
    clinic_id: "preview-clinic",
    clerk_user_id: null,
    name: "Dr. Anshul Mehta",
    specialty: "Internal Medicine",
    room: "Room 8",
    max_patients_per_day: 65,
    avg_consult_minutes: 9,
    status: "active",
    break_return_time: null,
    created_at: new Date().toISOString()
  }
];

export default function ReceptionWorkspacePreviewPage() {
  return <ReceptionWorkspace clinic={previewClinic} doctors={previewDoctors} />;
}
