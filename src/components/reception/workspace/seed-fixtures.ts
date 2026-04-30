import type {
  ClinicCapabilities,
  DoctorOption,
  DoctorOrders,
  Patient,
  PatientVitals,
  SignalPolicy
} from "./types";

const EMPTY_VITALS: PatientVitals = {
  heartRate: "",
  temperature: "",
  bloodPressure: "",
  height: "",
  weight: ""
};

export const DEFAULT_SIGNAL_POLICY: SignalPolicy = {
  returning_about_prior_visit: { enabled: true },
  prior_visit_today: { enabled: true },
  requeued_from_completed: { enabled: true },
  miss_strikes: { enabled: true },
  vitals_required: { enabled: true },
  completed_outcome: { enabled: true }
};

export const DEFAULT_CLINIC_CAPABILITIES: ClinicCapabilities = {
  vitalsAtReception: true,
  vitalsRequirement: "optional",
  collectPaymentAtReception: false,
  labRouting: "both",
  prescriptionDelivery: "automated",
  pharmacyAtReception: false,
  signalPolicy: DEFAULT_SIGNAL_POLICY
};

export function emptyVitals(): PatientVitals {
  return { ...EMPTY_VITALS };
}

function vitals(partial: Partial<PatientVitals>): PatientVitals {
  return { ...EMPTY_VITALS, ...partial };
}

function deriveInitials(first: string, last: string) {
  return `${first[0] ?? "P"}${last[0] ?? ""}`.toUpperCase();
}

function patientIdForToken(tokenNumber: number, firstName: string, lastName: string) {
  return `pt-${tokenNumber}-${firstName.toLowerCase()}-${lastName.toLowerCase()}`;
}

let nextTokenSeed = 1;
function nextToken() {
  return nextTokenSeed++;
}

const NOW = Date.now();
const MIN = 60_000;

type SeedInput = Omit<
  Patient,
  | "id"
  | "patientProfileId"
  | "tokenNumber"
  | "initials"
  | "arrivedAt"
  | "lifecycleSince"
  | "priority"
  | "smsCheckinDeliveryStatus"
  | "requeueReason"
  | "missCount"
  | "orders"
  | "departingFlags"
  | "outcome"
  | "deskTask"
  | "closedAt"
  | "noteOverride"
  | "returningAboutPriorVisit"
  | "requeuedFromCompletedAt"
  | "vitalsRequiredAttemptedAt"
> & {
  arrivedMinutesAgo: number;
  patientProfileId?: Patient["patientProfileId"];
  priority?: Patient["priority"];
  smsCheckinDeliveryStatus?: Patient["smsCheckinDeliveryStatus"];
  requeueReason?: Patient["requeueReason"];
  returningAboutPriorVisit?: Patient["returningAboutPriorVisit"];
  requeuedFromCompletedAt?: Patient["requeuedFromCompletedAt"];
  vitalsRequiredAttemptedAt?: Patient["vitalsRequiredAttemptedAt"];
  missCount?: number;
  orders?: DoctorOrders | null;
  departingFlags?: Patient["departingFlags"];
  outcome?: Patient["outcome"];
  deskTask?: Patient["deskTask"];
  closedAt?: number | null;
  noteOverride?: string | null;
};

function buildPatient(seed: SeedInput): Patient {
  const tokenNumber = nextToken();
  const profileKey = seed.phone.replace(/\D/g, "") || `${seed.firstName}-${seed.lastName}`;
  return {
    ...seed,
    id: patientIdForToken(tokenNumber, seed.firstName, seed.lastName),
    patientProfileId: seed.patientProfileId ?? `profile-${profileKey}`,
    tokenNumber,
    initials: deriveInitials(seed.firstName, seed.lastName),
    arrivedAt: NOW - seed.arrivedMinutesAgo * MIN,
    lifecycleSince: NOW - seed.arrivedMinutesAgo * MIN,
    priority: seed.priority ?? null,
    smsCheckinDeliveryStatus: seed.smsCheckinDeliveryStatus ?? "sent",
    requeueReason:
      seed.requeueReason ??
      (seed.lifecycle === "buffer_lab_review"
        ? "lab_review"
        : seed.lifecycle === "buffer_doctor_recall"
          ? "doctor_recall"
          : null),
    returningAboutPriorVisit: seed.returningAboutPriorVisit ?? null,
    requeuedFromCompletedAt: seed.requeuedFromCompletedAt ?? null,
    vitalsRequiredAttemptedAt: seed.vitalsRequiredAttemptedAt ?? null,
    missCount: seed.missCount ?? 0,
    orders: seed.orders ?? null,
    departingFlags: seed.departingFlags ?? null,
    outcome: seed.outcome ?? null,
    deskTask: seed.deskTask ?? null,
    closedAt: seed.closedAt ?? null,
    noteOverride: seed.noteOverride ?? null
  };
}

const prescriptionOrders: DoctorOrders = {
  prescriptionLines: ["Prescription shared digitally"],
  labOrders: [],
  pharmacyItems: [],
  followUpDate: null,
  totalDueInr: 0,
  notes: "No front-desk action."
};

const externalLabOrders: DoctorOrders = {
  prescriptionLines: ["Prescription shared digitally"],
  labOrders: ["CBC", "HbA1c"],
  pharmacyItems: [],
  followUpDate: null,
  totalDueInr: 0,
  notes: "External lab referral shared digitally."
};

const labReturnOrders: DoctorOrders = {
  prescriptionLines: ["Prescription pending doctor review"],
  labOrders: ["CBC", "TSH"],
  pharmacyItems: [],
  followUpDate: null,
  totalDueInr: 0,
  notes: "Reason: lab report review"
};

const followUpOrders: DoctorOrders = {
  prescriptionLines: ["Prescription shared digitally"],
  labOrders: [],
  pharmacyItems: [],
  followUpDate: "2026-05-12",
  totalDueInr: 0,
  notes: "Follow-up reminder sent automatically."
};

const FIRST_NAMES = [
  "Aarav",
  "Aditi",
  "Aisha",
  "Amit",
  "Ananya",
  "Arjun",
  "Avni",
  "Bhavna",
  "Chetan",
  "Dev",
  "Diya",
  "Farah",
  "Gauri",
  "Harsh",
  "Ishaan",
  "Jaya",
  "Kabir",
  "Kavya",
  "Kiran",
  "Leena",
  "Manav",
  "Maya",
  "Meera",
  "Naina",
  "Neel",
  "Nikhil",
  "Nisha",
  "Pooja",
  "Pranav",
  "Rahul",
  "Reema",
  "Riya",
  "Rohan",
  "Roshni",
  "Sahil",
  "Sanjay",
  "Sara",
  "Shreya",
  "Sonia",
  "Tara",
  "Varun",
  "Vikram",
  "Yash",
  "Zara"
];

const LAST_NAMES = [
  "Agarwal",
  "Bajaj",
  "Bansal",
  "Bose",
  "Chandra",
  "Chatterjee",
  "Chopra",
  "Das",
  "Desai",
  "Dubey",
  "Ghosh",
  "Gill",
  "Gupta",
  "Iyer",
  "Jain",
  "Joshi",
  "Kapoor",
  "Khan",
  "Kulkarni",
  "Malhotra",
  "Mehra",
  "Menon",
  "Nair",
  "Pandey",
  "Patel",
  "Paul",
  "Rao",
  "Reddy",
  "Roy",
  "Sen",
  "Sethi",
  "Shah",
  "Sharma",
  "Singh",
  "Sinha",
  "Trivedi",
  "Thomas",
  "Varma",
  "Verma",
  "Yadav"
];

function nameAt(index: number, doctorIndex: number) {
  const globalIndex = doctorIndex * 236 + index;
  const pairSpace = FIRST_NAMES.length * LAST_NAMES.length;
  const pairIndex = (globalIndex * 37) % pairSpace;
  const first = FIRST_NAMES[pairIndex % FIRST_NAMES.length];
  const last = LAST_NAMES[Math.floor(pairIndex / FIRST_NAMES.length) % LAST_NAMES.length];
  return { first, last };
}

function generatedVitals(index: number): PatientVitals {
  return vitals({
    heartRate: String(68 + (index % 24)),
    temperature: `${36 + (index % 8) / 10}`,
    bloodPressure: `${112 + (index % 22)}/${72 + (index % 14)}`,
    height: String(154 + (index % 38)),
    weight: String(48 + (index % 44))
  });
}

function buildGeneratedPatient({
  doctorId,
  doctorIndex,
  index,
  lifecycle,
  arrivedMinutesAgo,
  vitals: patientVitals,
  deskTask,
  orders,
  outcome,
  missCount = 0,
  noteOverride = null,
  closedAt = null,
  priority = null,
  requeueReason,
  patientProfileId,
  returningAboutPriorVisit,
  requeuedFromCompletedAt,
  vitalsRequiredAttemptedAt
}: {
  doctorId: string;
  doctorIndex: number;
  index: number;
  lifecycle: Patient["lifecycle"];
  arrivedMinutesAgo: number;
  vitals: PatientVitals;
  deskTask?: Patient["deskTask"];
  orders?: DoctorOrders | null;
  outcome?: Patient["outcome"];
  missCount?: number;
  noteOverride?: string | null;
  closedAt?: number | null;
  priority?: Patient["priority"];
  requeueReason?: Patient["requeueReason"];
  patientProfileId?: Patient["patientProfileId"];
  returningAboutPriorVisit?: Patient["returningAboutPriorVisit"];
  requeuedFromCompletedAt?: Patient["requeuedFromCompletedAt"];
  vitalsRequiredAttemptedAt?: Patient["vitalsRequiredAttemptedAt"];
}) {
  const { first, last } = nameAt(index, doctorIndex);
  return buildPatient({
    doctorId,
    firstName: first,
    lastName: last,
    age: 21 + ((index + doctorIndex * 3) % 58),
    gender: index % 5 === 0 ? "Other" : index % 2 === 0 ? "Female" : "Male",
    phone: `+91 90000 ${String(doctorIndex + 1).padStart(2, "0")}${String(index).padStart(4, "0")}`,
    patientProfileId,
    visitType: index % 4 === 0 ? "New Visit" : "Follow-up",
    checkinChannel: index % 3 === 0 ? "reception" : "qr",
    priority,
    arrivedMinutesAgo,
    lifecycle,
    vitals: patientVitals,
    smsCheckinDeliveryStatus: index % 37 === 0 ? "failed" : "sent",
    requeueReason,
    missCount,
    orders: orders ?? null,
    deskTask: deskTask ?? null,
    outcome: outcome ?? null,
    closedAt,
    noteOverride,
    returningAboutPriorVisit,
    requeuedFromCompletedAt,
    vitalsRequiredAttemptedAt
  });
}

export function buildSeedDoctors(input: DoctorOption[]): DoctorOption[] {
  if (input.length > 0) return input;
  return [
    {
      id: "doctor-ravi",
      name: "Dr. Ravi Kumar",
      room: "Room 5",
      specialty: "General Medicine",
      status: "active",
      avgConsultMinutes: 8,
      breakReturnTime: null
    },
    {
      id: "doctor-neha",
      name: "Dr. Neha Sinha",
      room: "Room 3",
      specialty: "Family Medicine",
      status: "active",
      avgConsultMinutes: 10,
      breakReturnTime: null
    }
  ];
}

export function buildSeedPatients(doctors: DoctorOption[]): Patient[] {
  nextTokenSeed = 1;

  return doctors.flatMap((doctor, doctorIndex) => {
    const patients: Patient[] = [];

    patients.push(
      buildGeneratedPatient({
        doctorId: doctor.id,
        doctorIndex,
        index: 0,
        lifecycle: "serving",
        arrivedMinutesAgo: 46,
        vitals: generatedVitals(0),
        outcome: null
      })
    );

    for (let i = 1; i <= 42; i += 1) {
      const returningProfileId = `profile-returning-about-prior-${doctor.id}`;
      patients.push(
        buildGeneratedPatient({
          doctorId: doctor.id,
          doctorIndex,
          index: i,
          lifecycle: "arriving_pending_vitals",
          arrivedMinutesAgo: 1 + i,
          vitals: emptyVitals(),
          priority: i === 42 ? "vip" : null,
          patientProfileId: i === 4 ? returningProfileId : undefined,
          returningAboutPriorVisit:
            i === 4
              ? {
                  priorTokenId: `prior-token-${doctor.id}-reports`,
                  priorVisitDate: new Date(NOW - 2 * 24 * 60 * MIN).toISOString(),
                  priorDoctorName: doctor.name,
                  priorOutcome: "return_with_reports",
                  priorOutcomeLabel: "Lab report review",
                  reason: "reports",
                  selectedAt: NOW - 4 * MIN
                }
              : null
        })
      );
    }

    for (let i = 43; i <= 172; i += 1) {
      const isRequeuedFromCompleted = i === 172;
      const isReturningFollowUp = i === 171;
      const priorSameDayName = nameAt(191, doctorIndex);
      const priorSameDayTokenNumber = doctorIndex * 236 + 192;
      patients.push(
        buildGeneratedPatient({
          doctorId: doctor.id,
          doctorIndex,
          index: i,
          lifecycle: isRequeuedFromCompleted ? "buffer_doctor_recall" : "buffer_normal",
          arrivedMinutesAgo: 8 + i,
          vitals: generatedVitals(i),
          patientProfileId: isReturningFollowUp
            ? `profile-same-day-return-${doctor.id}`
            : undefined,
          returningAboutPriorVisit: isReturningFollowUp
            ? {
                priorTokenId: patientIdForToken(
                  priorSameDayTokenNumber,
                  priorSameDayName.first,
                  priorSameDayName.last
                ),
                priorVisitDate: new Date(NOW - 6 * MIN).toISOString(),
                priorDoctorName: doctor.name,
                priorOutcome: "follow_up_later",
                priorOutcomeLabel: "Follow-up reminder sent",
                reason: "follow_up",
                selectedAt: NOW - 5 * MIN
              }
            : null,
          requeueReason: isRequeuedFromCompleted ? "doctor_recall" : undefined,
          requeuedFromCompletedAt: isRequeuedFromCompleted ? NOW - 7 * MIN : null,
          noteOverride: isRequeuedFromCompleted ? "Requeued from completed visit" : null
        })
      );
    }

    for (let i = 173; i <= 178; i += 1) {
      patients.push(
        buildGeneratedPatient({
          doctorId: doctor.id,
          doctorIndex,
          index: i,
          lifecycle: "missed_first_strike",
          arrivedMinutesAgo: 12 + i,
          vitals: generatedVitals(i),
          missCount: 1 + (i % 3),
          noteOverride: "No response"
        })
      );
    }

    for (let i = 179; i <= 190; i += 1) {
      patients.push(
        buildGeneratedPatient({
          doctorId: doctor.id,
          doctorIndex,
          index: i,
          lifecycle: "buffer_lab_review",
          arrivedMinutesAgo: 20 + i,
          vitals: generatedVitals(i),
          orders: labReturnOrders,
          outcome: "return_with_reports",
          deskTask: null,
          noteOverride: "Reason: lab report review",
          priority: i === 190 ? "vip" : null
        })
      );
    }

    for (let i = 191; i <= 235; i += 1) {
      const isExternalLab = i % 5 === 0;
      const isFollowUp = i % 7 === 0;
      const isSameDayPriorVisit = i === 191;
      patients.push(
        buildGeneratedPatient({
          doctorId: doctor.id,
          doctorIndex,
          index: i,
          lifecycle: "closed",
          arrivedMinutesAgo: 40 + i,
          vitals: generatedVitals(i),
          patientProfileId: isSameDayPriorVisit
            ? `profile-same-day-return-${doctor.id}`
            : undefined,
          orders: isExternalLab ? externalLabOrders : isFollowUp ? followUpOrders : prescriptionOrders,
          outcome: isExternalLab
            ? "external_lab_referral"
            : isFollowUp
              ? "follow_up_later"
              : "prescription_shared",
          closedAt: NOW - (i - 150) * MIN,
          noteOverride: isExternalLab
            ? "External lab referral shared"
            : isFollowUp
              ? "Follow-up reminder sent"
              : "Prescription shared"
        })
      );
    }

    return patients;
  });
}
