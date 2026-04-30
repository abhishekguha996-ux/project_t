// V2 lifecycle types — single source of truth for the receptionist workspace.
// These map onto the existing TokenStatus / CheckoutStage enums in
// src/lib/utils/types.ts but expand them with reception-only sub-states
// (handoff, missed, lab-review) that the spec needs for clarity.

export type VitalsField =
  | "heartRate"
  | "temperature"
  | "bloodPressure"
  | "height"
  | "weight";

export type PatientVitals = Record<VitalsField, string>;

export type Gender = "Male" | "Female" | "Other";

export type CheckinChannel = "qr" | "reception";

export type PatientPriority = "vip";

export type SignalId =
  | "returning_about_prior_visit"
  | "prior_visit_today"
  | "requeued_from_completed"
  | "miss_strikes"
  | "vitals_required"
  | "completed_outcome";

export type SignalOrigin = "patient" | "staff" | "system";

export type SignalCategory =
  | "visit_intent"
  | "queue_history"
  | "operational_requirement"
  | "visit_summary";

export type SignalWeight = 1 | 2;

export type Signal = {
  id: SignalId;
  category: SignalCategory;
  origin: SignalOrigin;
  weight: SignalWeight;
  title: string;
  detail: string;
  dedupeKey: string;
  emittedAt: number;
};

export type SignalPolicy = Record<
  SignalId,
  {
    enabled: boolean;
    weightOverride?: SignalWeight;
  }
>;

export type VitalsRequirement = "optional" | "required_before_queue";

export type ReturningReason =
  | "reports"
  | "follow_up"
  | "prescription_question"
  | "referral"
  | "symptoms_unresolved"
  | "other";

// The composite life-cycle state. One value per patient at any time.
export type LifecycleState =
  // arriving (Inbox · Arriving)
  | "arriving_pending_vitals"
  | "arriving_returned_from_missed"
  // queue / clinic-flow
  | "buffer_normal"
  | "buffer_lab_review"
  | "buffer_doctor_recall"
  | "handoff_ready"
  | "serving"
  // post-consult (Inbox · Departing)
  | "departing_lab_pending"
  | "departing_payment_pending"
  | "departing_pharmacy_pending"
  | "departing_ready_to_close"
  // missed (Inbox · Missed)
  | "missed_first_strike"
  // archived (Completed)
  | "closed"
  | "skipped_no_show";

export type DepartingFlags = {
  lab: "pending" | "done" | "not_required";
  payment: "pending" | "done" | "not_required";
  pharmacy: "pending" | "done" | "not_required";
  rxPrinted: boolean;
  labFormPrinted: boolean;
  nextVisitSlipGiven: boolean;
  medicinesHandedOver: boolean;
};

export type ClinicCapabilities = {
  vitalsAtReception: boolean;
  vitalsRequirement: VitalsRequirement;
  collectPaymentAtReception: boolean;
  labRouting: "external" | "in_house" | "both";
  prescriptionDelivery: "automated" | "front_desk" | "mixed";
  pharmacyAtReception: boolean;
  signalPolicy: SignalPolicy;
};

export type DoctorOrders = {
  prescriptionLines: string[];
  labOrders: string[];
  pharmacyItems: string[];
  followUpDate: string | null;
  totalDueInr: number;
  notes: string | null;
};

export type DoctorOutcomeKind =
  | "prescription_shared"
  | "external_lab_referral"
  | "return_with_reports"
  | "doctor_recall"
  | "follow_up_later"
  | "payment_due"
  | "closed_no_action";

export type DeskTaskKind =
  | "share_prescription"
  | "give_lab_referral"
  | "requeue_review"
  | "schedule_follow_up"
  | "collect_payment"
  | "close_visit";

export type DeskTask = {
  kind: DeskTaskKind;
  title: string;
  detail: string;
  primaryLabel: string;
  closesVisit: boolean;
  requeueReason?: RequeueReason;
};

export type Patient = {
  id: string;
  doctorId: string;
  firstName: string;
  lastName: string;
  age: number;
  gender: Gender;
  phone: string;
  patientProfileId: string;
  tokenNumber: number;
  visitType: "New Visit" | "Follow-up";
  checkinChannel: CheckinChannel;
  // Explicit priority set by check-in, reception, or doctor.
  priority: PatientPriority | null;
  initials: string;
  arrivedAt: number; // epoch ms
  // sms.checkin_confirm delivery; "failed" surfaces a compact alert in Check-in.
  smsCheckinDeliveryStatus: "sent" | "failed" | null;

  lifecycle: LifecycleState;
  vitals: PatientVitals;
  // Time the lifecycle last transitioned (used for Lab Review timestamp etc).
  lifecycleSince: number;
  // Re-queue reason chip (only set when lifecycle is buffer_lab_review or buffer_doctor_recall).
  requeueReason: RequeueReason | null;
  returningAboutPriorVisit: {
    priorTokenId: string;
    priorVisitDate: string;
    priorDoctorName: string;
    priorOutcome: DoctorOutcomeKind | null;
    priorOutcomeLabel: string;
    reason: ReturningReason;
    selectedAt: number;
  } | null;
  requeuedFromCompletedAt: number | null;
  vitalsRequiredAttemptedAt: number | null;
  // Track strikes so the second miss auto-archives.
  missCount: number;
  // Doctor orders + checkout flags only relevant once they enter departing.
  orders: DoctorOrders | null;
  departingFlags: DepartingFlags | null;
  outcome: DoctorOutcomeKind | null;
  deskTask: DeskTask | null;
  // Closed visits keep the closedAt timestamp for Completed.
  closedAt: number | null;
  // Note shown on the Inbox row.
  noteOverride: string | null;
};

export type RequeueReason =
  | "lab_review"
  | "doctor_recall";

export type DoctorOption = {
  id: string;
  name: string;
  room: string | null;
  specialty: string | null;
  status: "active" | "break" | "paused" | "offline";
  avgConsultMinutes: number;
  // ISO time when the break ends, if status === "break".
  breakReturnTime: string | null;
};

// "handoff" is the escort flow. Clicking a waiting row only previews the
// patient; pressing "Start calling" on The Desk commits the call state.
// "detail" is the read-only summary view used when the receptionist clicks
// a closed visit in Completed — no actions, just a record.
export type DeskMode = "idle" | "vitals" | "checkout" | "handoff" | "detail";

// Missed patients render inline at the bottom of Doctor queue, so there is
// no separate Missed tab in the Inbox.
export type InboxSegment = "arriving" | "departing";

export type DeskBinding = {
  patientId: string | null;
  mode: DeskMode;
};

export type UndoAction = {
  id: string;
  label: string; // shown in toast: "Marked Sara missing"
  expiresAt: number;
  // Restore state that snapshots the relevant lifecycle slice.
  revert: () => void;
};

export type AuditEntry = {
  id: string;
  patientId: string;
  patientName: string;
  action: string;
  fromState: LifecycleState;
  toState: LifecycleState;
  reason: string | null;
  actorLabel: string;
  at: number;
};
