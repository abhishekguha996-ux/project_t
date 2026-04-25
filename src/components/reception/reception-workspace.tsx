"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Clinic, Doctor } from "@/lib/utils/types";

import { ContextArea } from "./workspace/context-area";
import { FocusArea } from "./workspace/focus-area";
import { GlobalNav } from "./workspace/global-nav";
import styles from "./workspace/reception-workspace.module.css";
import type {
  DoctorOption,
  PatientVitals,
  ReadyPatient,
  ReceptionPatient,
  ServingPatient,
  VitalsField
} from "./workspace/types";

const DEFAULT_VITALS: PatientVitals = {
  heartRate: "",
  temperature: "",
  bloodPressure: "",
  height: "",
  weight: ""
};

function createEmptyVitals(): PatientVitals {
  return { ...DEFAULT_VITALS };
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function sanitizeVitalInput(field: VitalsField, value: string) {
  if (field === "bloodPressure") {
    const cleaned = value.replace(/[^\d/]/g, "");
    const [rawSystolic = "", rawDiastolic = "", ...rest] = cleaned.split("/");
    const systolic = rawSystolic.slice(0, 3);
    const diastolic = rawDiastolic.slice(0, 3);

    if (cleaned.includes("/") || rest.length > 0) {
      return `${systolic}/${diastolic}`;
    }

    return systolic;
  }

  if (field === "temperature" || field === "weight") {
    const cleaned = value.replace(/[^\d.]/g, "");
    const [whole = "", fractional = ""] = cleaned.split(".");
    const limitedWhole = whole.slice(0, field === "temperature" ? 2 : 3);
    const limitedFractional = fractional.slice(0, 1);
    return limitedFractional.length > 0 ? `${limitedWhole}.${limitedFractional}` : limitedWhole;
  }

  return value.replace(/\D/g, "").slice(0, 3);
}

function formatVitalOnBlur(field: VitalsField, value: string) {
  if (!value.trim()) {
    return "";
  }

  if (field === "heartRate") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? "" : String(clampNumber(parsed, 30, 220));
  }

  if (field === "temperature") {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? "" : clampNumber(parsed, 34, 43).toFixed(1);
  }

  if (field === "height") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? "" : String(clampNumber(parsed, 50, 250));
  }

  if (field === "weight") {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? "" : clampNumber(parsed, 2, 300).toFixed(parsed % 1 === 0 ? 0 : 1);
  }

  const [systolicValue, diastolicValue] = value.split("/");
  const systolic = Number.parseInt(systolicValue ?? "", 10);
  const diastolic = Number.parseInt(diastolicValue ?? "", 10);

  if (Number.isNaN(systolic) || Number.isNaN(diastolic)) {
    return "";
  }

  const nextSystolic = clampNumber(systolic, 70, 240);
  const nextDiastolic = clampNumber(diastolic, 40, 140);
  return `${nextSystolic}/${nextDiastolic}`;
}

type PatientSeed = Pick<
  ReceptionPatient,
  | "firstName"
  | "lastName"
  | "age"
  | "gender"
  | "visitType"
  | "note"
>;

type DoctorWorkspaceState = {
  activeByDoctor: Record<string, ReceptionPatient>;
  upcoming: ReceptionPatient[];
  readyByDoctor: Record<string, ReadyPatient[]>;
  currentlyServingByDoctor: Record<string, ServingPatient>;
  vitalsByPatient: Record<string, PatientVitals>;
};


const ACTIVE_PATIENT_SEEDS: PatientSeed[] = [
  {
    firstName: "Poonam",
    lastName: "Sharma",
    age: 36,
    gender: "Female",
    visitType: "Follow-up",
    note: "Vitals pending"
  },
  {
    firstName: "Vikram",
    lastName: "Sethi",
    age: 44,
    gender: "Male",
    visitType: "Follow-up",
    note: "BP recheck"
  },
  {
    firstName: "Leena",
    lastName: "Thomas",
    age: 29,
    gender: "Female",
    visitType: "New Visit",
    note: "Registration complete"
  },
  {
    firstName: "Yusuf",
    lastName: "Mirza",
    age: 51,
    gender: "Male",
    visitType: "Follow-up",
    note: "Cardiac review"
  },
  {
    firstName: "Kavya",
    lastName: "Nair",
    age: 32,
    gender: "Female",
    visitType: "Follow-up",
    note: "Lab report upload"
  }
];

const DUMMY_UPCOMING_PATIENT_SEED: PatientSeed[] = [
  {
    firstName: "Aravind",
    lastName: "Swamy",
    age: 42,
    gender: "Male",
    visitType: "Follow-up",
    note: "Token called"
  },
  {
    firstName: "Maya",
    lastName: "Patel",
    age: 29,
    gender: "Female",
    visitType: "New Visit",
    note: "First consultation"
  },
  {
    firstName: "Nikhil",
    lastName: "Verma",
    age: 33,
    gender: "Male",
    visitType: "Follow-up",
    note: "Vitals pending"
  },
  {
    firstName: "Ishita",
    lastName: "Rao",
    age: 25,
    gender: "Female",
    visitType: "New Visit",
    note: "Walk-in"
  },
  {
    firstName: "Raghav",
    lastName: "Menon",
    age: 47,
    gender: "Male",
    visitType: "Follow-up",
    note: "Vitals captured"
  },
  {
    firstName: "Ananya",
    lastName: "Gupta",
    age: 31,
    gender: "Female",
    visitType: "New Visit",
    note: "Consult pending"
  },
  {
    firstName: "Harish",
    lastName: "Kulkarni",
    age: 55,
    gender: "Male",
    visitType: "Follow-up",
    note: "Needs BP check"
  },
  {
    firstName: "Pallavi",
    lastName: "Nair",
    age: 38,
    gender: "Female",
    visitType: "Follow-up",
    note: "Lab report review"
  },
  {
    firstName: "Adeel",
    lastName: "Khan",
    age: 27,
    gender: "Male",
    visitType: "New Visit",
    note: "Vitals pending"
  },
  {
    firstName: "Sneha",
    lastName: "Bose",
    age: 34,
    gender: "Female",
    visitType: "Follow-up",
    note: "Follow-up consult"
  },
  {
    firstName: "Kiran",
    lastName: "Desai",
    age: 44,
    gender: "Male",
    visitType: "Follow-up",
    note: "Cardiac history"
  },
  {
    firstName: "Meera",
    lastName: "Iyer",
    age: 30,
    gender: "Female",
    visitType: "New Visit",
    note: "First-time visit"
  },
  {
    firstName: "Dev",
    lastName: "Chopra",
    age: 40,
    gender: "Male",
    visitType: "Follow-up",
    note: "Vitals complete"
  },
  {
    firstName: "Lavanya",
    lastName: "Reddy",
    age: 36,
    gender: "Female",
    visitType: "Follow-up",
    note: "Escalated in queue"
  },
  {
    firstName: "Sanjay",
    lastName: "Pillai",
    age: 52,
    gender: "Male",
    visitType: "Follow-up",
    note: "Review medicines"
  },
  {
    firstName: "Ritu",
    lastName: "Agarwal",
    age: 41,
    gender: "Female",
    visitType: "New Visit",
    note: "Walk-in"
  },
  {
    firstName: "Yash",
    lastName: "Shah",
    age: 28,
    gender: "Male",
    visitType: "Follow-up",
    note: "Vitals captured"
  },
  {
    firstName: "Priya",
    lastName: "Malhotra",
    age: 32,
    gender: "Female",
    visitType: "Follow-up",
    note: "Pending consultation"
  },
  {
    firstName: "Neeraj",
    lastName: "Joshi",
    age: 49,
    gender: "Male",
    visitType: "Follow-up",
    note: "Doctor requested early"
  },
  {
    firstName: "Farah",
    lastName: "Ali",
    age: 35,
    gender: "Female",
    visitType: "New Visit",
    note: "New registration"
  }
];

const READY_PATIENT_SEEDS = [
  { name: "Diya Singh", statusLabel: "Vitals Captured" },
  { name: "Kabir Nair", statusLabel: "Waiting at room" },
  { name: "Sara Khan", statusLabel: "Vitals Captured" },
  { name: "Rohan Paul", statusLabel: "Token announced" },
  { name: "Nisha Verma", statusLabel: "Waiting at room" },
  { name: "Imran Ali", statusLabel: "Vitals Captured" },
  { name: "Tara Bose", statusLabel: "Doctor notified" },
  { name: "Manav Rao", statusLabel: "Waiting at room" }
] as const;

const CURRENTLY_SERVING_SEEDS = [
  { name: "Amit Iyer", clockLabel: "14:22" },
  { name: "Naina Shah", clockLabel: "14:18" },
  { name: "Vikas Mehra", clockLabel: "14:11" },
  { name: "Ritu Das", clockLabel: "14:05" },
  { name: "Arjun Pillai", clockLabel: "13:59" }
] as const;

function formatTimelineSlot(index: number) {
  const startMinutes = 12 * 60 + 25;
  const slotMinutes = startMinutes + index * 8;
  const hours = Math.floor(slotMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (slotMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(
    date
  );
}

function buildDoctorLine(doctor: DoctorOption) {
  return `${doctor.name}${doctor.room ? ` • ${doctor.room}` : ""}`;
}

function deriveInitial(label: string) {
  return label.trim()[0]?.toUpperCase() ?? "P";
}


function buildDoctorOptions(doctors: Doctor[]): DoctorOption[] {
  if (!doctors.length) {
    return [{ id: "fallback", name: "Dr. Ravi Kumar", room: "Room 5" }];
  }
  const seen = new Set<string>();
  const unique: DoctorOption[] = [];
  for (const doctor of doctors) {
    const key = doctor.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ id: doctor.id, name: doctor.name, room: doctor.room });
  }
  return unique;
}

function buildInitialPatients(doctorOptions: DoctorOption[]): DoctorWorkspaceState {
  const activeByDoctor: Record<string, ReceptionPatient> = {};
  const readyByDoctor: Record<string, ReadyPatient[]> = {};
  const currentlyServingByDoctor: Record<string, ServingPatient> = {};
  const vitalsByPatient: Record<string, PatientVitals> = {};
  let nextTokenNumber = 81;

  doctorOptions.forEach((doctor, index) => {
    const activeSeed = ACTIVE_PATIENT_SEEDS[index % ACTIVE_PATIENT_SEEDS.length];
    const activePatient: ReceptionPatient = {
      id: `active-${doctor.id}`,
      doctorId: doctor.id,
      tokenNumber: nextTokenNumber,
      initials: deriveInitial(activeSeed.firstName),
      timelineTime: formatTimelineSlot(index),
      ...activeSeed
    };

    activeByDoctor[doctor.id] = activePatient;
    vitalsByPatient[activePatient.id] = createEmptyVitals();

    const readySeedOffset = (index * 2) % READY_PATIENT_SEEDS.length;
    readyByDoctor[doctor.id] = [0, 1].map((readyIndex) => {
      const readySeed = READY_PATIENT_SEEDS[(readySeedOffset + readyIndex) % READY_PATIENT_SEEDS.length];
      return {
        id: `${doctor.id}-ready-${readyIndex + 1}`,
        name: readySeed.name,
        initials: deriveInitial(readySeed.name),
        statusLabel: readySeed.statusLabel
      };
    });

    const servingSeed = CURRENTLY_SERVING_SEEDS[index % CURRENTLY_SERVING_SEEDS.length];
    currentlyServingByDoctor[doctor.id] = {
      id: `serving-${doctor.id}`,
      name: servingSeed.name,
      doctorLine: buildDoctorLine(doctor),
      clockLabel: servingSeed.clockLabel
    };

    nextTokenNumber += 1;
  });

  const upcoming: ReceptionPatient[] = DUMMY_UPCOMING_PATIENT_SEED.map((seed, index) => {
    const doctor = doctorOptions[index % doctorOptions.length];
    const tokenNumber = nextTokenNumber + index;
    return {
      id: `patient-${tokenNumber}`,
      doctorId: doctor.id,
      tokenNumber,
      initials: deriveInitial(seed.firstName),
      timelineTime: formatTimelineSlot(index),
      ...seed
    };
  });

  return { activeByDoctor, upcoming, readyByDoctor, currentlyServingByDoctor, vitalsByPatient };
}

export function ReceptionWorkspace({ clinic, doctors }: { clinic: Clinic | null; doctors: Doctor[] }) {
  const doctorOptions = useMemo(() => buildDoctorOptions(doctors), [doctors]);
  const initialWorkspace = useMemo(() => buildInitialPatients(doctorOptions), [doctorOptions]);

  const [isQueuePaused, setIsQueuePaused] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [doctorIndex, setDoctorIndex] = useState(0);
  const [activePatientsByDoctor, setActivePatientsByDoctor] = useState<Record<string, ReceptionPatient>>(
    initialWorkspace.activeByDoctor
  );
  const [upcomingPatients, setUpcomingPatients] = useState<ReceptionPatient[]>(initialWorkspace.upcoming);
  const [readyQueuesByDoctor, setReadyQueuesByDoctor] = useState<Record<string, ReadyPatient[]>>(
    initialWorkspace.readyByDoctor
  );
  const [vitalsByPatient, setVitalsByPatient] = useState<Record<string, PatientVitals>>(
    initialWorkspace.vitalsByPatient
  );
  const [currentlyServingByDoctor, setCurrentlyServingByDoctor] = useState<Record<string, ServingPatient>>(
    initialWorkspace.currentlyServingByDoctor
  );
  const [isTransferRunning, setIsTransferRunning] = useState(false);
  const [swappingPatientId, setSwappingPatientId] = useState<string | null>(null);

  const selectedDoctor = doctorOptions[doctorIndex] ?? doctorOptions[0];
  const activePatient = activePatientsByDoctor[selectedDoctor.id] ?? initialWorkspace.activeByDoctor[selectedDoctor.id];
  const readyQueue = readyQueuesByDoctor[selectedDoctor.id] ?? [];
  const currentlyServing =
    currentlyServingByDoctor[selectedDoctor.id] ?? initialWorkspace.currentlyServingByDoctor[selectedDoctor.id];
  const vitals = vitalsByPatient[activePatient.id] ?? createEmptyVitals();

  const doctorLine = useMemo(
    () => buildDoctorLine(selectedDoctor),
    [selectedDoctor]
  );

  const focusIdentityRef = useRef<HTMLDivElement | null>(null);
  const releaseTimerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (releaseTimerRef.current) {
        window.clearTimeout(releaseTimerRef.current);
      }
    },
    []
  );

  const doctorUpcoming = useMemo(
    () => upcomingPatients.filter((patient) => patient.doctorId === selectedDoctor.id),
    [upcomingPatients, selectedDoctor.id]
  );

  const filteredUpcoming = useMemo(() => {
    const normalizedQuery = searchValue.trim().toLowerCase();
    if (!normalizedQuery) {
      return doctorUpcoming;
    }
    return doctorUpcoming.filter((patient) => {
      const fullName = `${patient.firstName} ${patient.lastName}`.toLowerCase();
      return (
        fullName.includes(normalizedQuery) ||
        String(patient.tokenNumber).includes(normalizedQuery)
      );
    });
  }, [doctorUpcoming, searchValue]);

  const visibleUpcoming = useMemo(() => filteredUpcoming.slice(0, 2), [filteredUpcoming]);

  const hasCapturedVitals = useMemo(
    () => Object.values(vitals).some((value) => value.trim().length > 0),
    [vitals]
  );


  const promoteToFocus = useCallback(
    (patientId: string) => {
      if (isTransferRunning) {
        return;
      }

      const incomingPatient = upcomingPatients.find((patient) => patient.id === patientId);
      if (!incomingPatient || incomingPatient.id === activePatient.id) {
        return;
      }

      const priorActive = activePatient;
      const returningPrior: ReceptionPatient = {
        ...priorActive,
        note: hasCapturedVitals ? "Partial vitals saved" : priorActive.note
      };

      setIsTransferRunning(true);
      setSwappingPatientId(patientId);
      setActivePatientsByDoctor((previous) => ({
        ...previous,
        [selectedDoctor.id]: incomingPatient
      }));
      setVitalsByPatient((previous) => ({
        ...previous,
        [priorActive.id]: previous[priorActive.id] ?? vitals,
        [incomingPatient.id]: previous[incomingPatient.id] ?? createEmptyVitals()
      }));
      setUpcomingPatients((previous) => {
        const withoutIncoming = previous.filter((patient) => patient.id !== patientId);
        const merged = [returningPrior, ...withoutIncoming];
        return merged.sort((a, b) => a.tokenNumber - b.tokenNumber);
      });

      if (releaseTimerRef.current) {
        window.clearTimeout(releaseTimerRef.current);
      }
      releaseTimerRef.current = window.setTimeout(() => {
        setIsTransferRunning(false);
        setSwappingPatientId(null);
      }, 260);
    },
    [activePatient, hasCapturedVitals, isTransferRunning, selectedDoctor.id, upcomingPatients, vitals]
  );

  const finalizeCheckIn = useCallback(() => {
    const activeName = `${activePatient.firstName} ${activePatient.lastName}`;
    const nextDoctorPatient = doctorUpcoming[0];

    setReadyQueuesByDoctor((previous) => ({
      ...previous,
      [selectedDoctor.id]: [
        {
          id: `${activePatient.id}-ready-${Date.now()}`,
          name: activeName,
          initials: activePatient.initials,
          statusLabel: "Vitals Captured"
        },
        ...(previous[selectedDoctor.id] ?? [])
      ]
    }));
    if (nextDoctorPatient) {
      setActivePatientsByDoctor((previous) => ({
        ...previous,
        [selectedDoctor.id]: nextDoctorPatient
      }));
      setUpcomingPatients((previous) => previous.filter((patient) => patient.id !== nextDoctorPatient.id));
    }
    setVitalsByPatient((previous) => ({
      ...previous,
      [activePatient.id]: createEmptyVitals(),
      ...(nextDoctorPatient
        ? {
            [nextDoctorPatient.id]: previous[nextDoctorPatient.id] ?? createEmptyVitals()
          }
        : {})
    }));
  }, [
    activePatient.firstName,
    activePatient.id,
    activePatient.initials,
    activePatient.lastName,
    doctorUpcoming,
    selectedDoctor.id
  ]);

  const handleCompleteCheckIn = useCallback(() => {
    finalizeCheckIn();
  }, [finalizeCheckIn]);

  const handleCallPatient = useCallback(() => {
    setCurrentlyServingByDoctor((previous) => ({
      ...previous,
      [selectedDoctor.id]: {
        id: activePatient.id,
        name: `${activePatient.firstName} ${activePatient.lastName}`,
        doctorLine,
        clockLabel: formatClock(new Date())
      }
    }));
  }, [activePatient.firstName, activePatient.id, activePatient.lastName, doctorLine, selectedDoctor.id]);

  const handleTextPatient = useCallback(() => {
    setReadyQueuesByDoctor((previous) => {
      const queue = previous[selectedDoctor.id] ?? [];
      if (!queue.length) {
        return previous;
      }
      const [head, ...tail] = queue;
      return {
        ...previous,
        [selectedDoctor.id]: [{ ...head, statusLabel: "Message sent" }, ...tail]
      };
    });
  }, [selectedDoctor.id]);

  const handleCallNext = useCallback(() => {
    const nextPatient = filteredUpcoming[0];
    if (!nextPatient) {
      return;
    }
    promoteToFocus(nextPatient.id);
  }, [filteredUpcoming, promoteToFocus]);

  const handleVitalChange = useCallback((field: VitalsField, value: string) => {
    const sanitizedValue = sanitizeVitalInput(field, value);

    setVitalsByPatient((previous) => ({
      ...previous,
      [activePatient.id]: {
        ...(previous[activePatient.id] ?? createEmptyVitals()),
        [field]: sanitizedValue
      }
    }));
  }, [activePatient.id]);

  const handleVitalBlur = useCallback((field: VitalsField) => {
    setVitalsByPatient((previous) => {
      const currentVitals = previous[activePatient.id] ?? createEmptyVitals();
      const formattedValue = formatVitalOnBlur(field, currentVitals[field]);

      if (formattedValue === currentVitals[field]) {
        return previous;
      }

      return {
        ...previous,
        [activePatient.id]: {
          ...currentVitals,
          [field]: formattedValue
        }
      };
    });
  }, [activePatient.id]);

  return (
    <section
      aria-label={`${clinic?.name ?? "Clinic"} receptionist workspace`}
      className={styles.workspace}
    >
      <div className={styles.bgGlow} />

      <GlobalNav
        doctorOptions={doctorOptions}
        isQueuePaused={isQueuePaused}
        onSelectDoctor={(doctorId) => {
          setSearchValue("");
          setDoctorIndex(Math.max(doctorOptions.findIndex((doctor) => doctor.id === doctorId), 0))
        }}
        onToggleQueuePause={() => setIsQueuePaused((previous) => !previous)}
        selectedDoctorId={selectedDoctor.id}
      />

      <FocusArea
        focusIdentityRef={focusIdentityRef}
        isSwapping={Boolean(swappingPatientId && swappingPatientId === activePatient.id)}
        onCallPatient={handleCallPatient}
        onVitalBlur={handleVitalBlur}
        onCompleteCheckIn={handleCompleteCheckIn}
        onTextPatient={handleTextPatient}
        onVitalChange={handleVitalChange}
        patient={activePatient}
        vitals={vitals}
      />

      <ContextArea
        currentlyServing={currentlyServing}
        isTransferRunning={isTransferRunning}
        onCallNext={handleCallNext}
        onCheckIn={promoteToFocus}
        onSearchChange={setSearchValue}
        readyQueue={readyQueue}
        searchValue={searchValue}
        totalUpcoming={doctorUpcoming.length}
        upcomingPatients={visibleUpcoming}
      />

    </section>
  );
}
