export type AppRole = "clinic_admin" | "receptionist" | "doctor";

export type SubscriptionTier = "free" | "starter" | "pro" | "enterprise";
export type DoctorStatus = "active" | "break" | "paused" | "offline";
export type PatientGender = "male" | "female" | "other";
export type TokenStatus =
  | "waiting"
  | "serving"
  | "complete"
  | "skipped"
  | "stepped_out";
export type TokenType = "walkin" | "booked";
export type TokenUrgency = "normal" | "emergency";
export type CheckInChannel = "qr" | "reception";
export type MessageType =
  | "checkin_confirm"
  | "three_ahead"
  | "your_turn"
  | "doctor_break"
  | "emergency_delay"
  | "skipped_noshow"
  | "stepped_out_check";
export type MessageDeliveryStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "failed"
  | "undelivered";
export type InviteStatus = "pending" | "accepted" | "expired" | "revoked";
export type InviteDeliveryStatus = "pending" | "sent" | "failed";

export interface Clinic {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  subscription_tier: SubscriptionTier;
  opening_time: string | null;
  closing_time: string | null;
  created_at: string;
}

export interface Doctor {
  id: string;
  clinic_id: string;
  clerk_user_id: string | null;
  name: string;
  specialty: string | null;
  room: string | null;
  max_patients_per_day: number;
  avg_consult_minutes: number;
  status: DoctorStatus;
  break_return_time: string | null;
  created_at: string;
}

export interface Patient {
  id: string;
  clinic_id: string;
  phone: string;
  name: string;
  age: number | null;
  gender: PatientGender | null;
  allergies: string[] | null;
  language_preference: string;
  created_at: string;
}

export interface AISummary {
  language_detected: string;
  primary_symptoms: string[];
  duration: string;
  red_flags: string[];
  clinical_summary: string;
  category: string;
}

export interface Token {
  id: string;
  clinic_id: string;
  doctor_id: string;
  patient_id: string;
  token_number: number;
  date: string;
  status: TokenStatus;
  type: TokenType;
  urgency: TokenUrgency;
  checkin_channel: CheckInChannel;
  checked_in_at: string;
  serving_started_at: string | null;
  completed_at: string | null;
  raw_complaint: string | null;
  ai_summary: AISummary | null;
  consult_duration_seconds: number | null;
  created_at: string;
}

export interface MessageLog {
  id: string;
  token_id: string | null;
  patient_phone: string;
  message_type: MessageType;
  message_body: string;
  twilio_sid: string | null;
  delivery_status: MessageDeliveryStatus;
  cost_inr: number | null;
  sent_at: string;
  delivered_at: string | null;
  created_at: string;
}

export interface ConsultTimeLog {
  id: string;
  clinic_id: string;
  doctor_id: string;
  token_id: string;
  date: string;
  duration_seconds: number;
  created_at: string;
}

export interface ClinicDailyStats {
  id: string;
  clinic_id: string;
  doctor_id: string | null;
  date: string;
  total_patients: number;
  walkin_patients: number;
  booked_patients: number;
  qr_checkins: number;
  reception_checkins: number;
  new_patients: number;
  returning_patients: number;
  avg_wait_time_seconds: number | null;
  avg_consult_duration_seconds: number | null;
  max_wait_time_seconds: number | null;
  patients_skipped: number;
  patients_stepped_out: number;
  emergency_overrides: number;
  capacity_utilization: number | null;
  consultation_fee: number | null;
  estimated_revenue: number | null;
  patients_by_hour: Record<string, number> | null;
  categories: Record<string, number> | null;
  messages_sent: number;
  messages_delivered: number;
  messages_failed: number;
  created_at: string;
}

export interface CurrentClinicUser {
  clerkUserId: string;
  clinicId: string;
  role: AppRole;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface StaffInvite {
  id: string;
  clinic_id: string;
  invite_code: string;
  role: Exclude<AppRole, "clinic_admin">;
  invitee_name: string | null;
  invitee_email: string | null;
  invited_by_clerk_id: string;
  doctor_id: string | null;
  status: InviteStatus;
  delivery_status: InviteDeliveryStatus;
  delivery_error: string | null;
  accepted_by_clerk_id: string | null;
  expires_at: string;
  accepted_at: string | null;
  sent_at: string | null;
  created_at: string;
}
