"use client";

import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import {
  DEFAULT_CLINIC_CAPABILITIES,
  buildSeedDoctors,
  buildSeedPatients,
  emptyVitals
} from "./seed-fixtures";
import type {
  AuditEntry,
  ClinicCapabilities,
  DeskTask,
  DeskBinding,
  DeskMode,
  DoctorOption,
  DoctorOrders,
  LifecycleState,
  Patient,
  PatientVitals,
  RequeueReason,
  UndoAction,
  VitalsField
} from "./types";

// ---------- helpers ----------

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function sanitizeVitalInput(field: VitalsField, value: string) {
  if (field === "bloodPressure") {
    const cleaned = value.replace(/[^\d/]/g, "");
    const [rawSys = "", rawDia = "", ...rest] = cleaned.split("/");
    const sys = rawSys.slice(0, 3);
    const dia = rawDia.slice(0, 3);
    if (cleaned.includes("/") || rest.length > 0) {
      return `${sys}/${dia}`;
    }
    return sys;
  }
  if (field === "temperature" || field === "weight") {
    const cleaned = value.replace(/[^\d.]/g, "");
    const [whole = "", frac = ""] = cleaned.split(".");
    const limitWhole = whole.slice(0, field === "temperature" ? 2 : 3);
    const limitFrac = frac.slice(0, 1);
    return limitFrac.length > 0 ? `${limitWhole}.${limitFrac}` : limitWhole;
  }
  return value.replace(/\D/g, "").slice(0, 3);
}

export function formatVitalOnBlur(field: VitalsField, value: string) {
  if (!value.trim()) return "";
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
  const [sysRaw, diaRaw] = value.split("/");
  const sys = Number.parseInt(sysRaw ?? "", 10);
  const dia = Number.parseInt(diaRaw ?? "", 10);
  if (Number.isNaN(sys) || Number.isNaN(dia)) return "";
  return `${clampNumber(sys, 70, 240)}/${clampNumber(dia, 40, 140)}`;
}

// "Range hint" used in the Vitals form (focus reveal).
export const VITAL_RANGE_HINTS: Record<VitalsField, string> = {
  heartRate: "30 – 220 bpm",
  temperature: "34 – 43 °C",
  bloodPressure: "70/40 – 240/140 mmHg",
  height: "50 – 250 cm",
  weight: "2 – 300 kg"
};

function patientHasAnyVitals(vitals: PatientVitals) {
  return Object.values(vitals).some((value) => value.trim().length > 0);
}

// ---------- state shape ----------

type State = {
  patients: Patient[];
  doctors: DoctorOption[];
  capabilities: ClinicCapabilities;
  selectedDoctorId: string;
  desk: DeskBinding;
  isQueuePaused: boolean;
  audit: AuditEntry[];
  // ms since epoch — re-rendered on tick.
  now: number;
  // last lifecycle change timestamp; used to flash count-up animations.
  lastTransitionAt: number;
  // optional mid-card silver banner: "Updated by Riya · 2s ago".
  banner: { text: string; clearAt: number } | null;
};

type Action =
  | { type: "select_doctor"; doctorId: string }
  | { type: "toggle_pause" }
  | { type: "tick"; now: number }
  | { type: "bind_desk"; patientId: string | null; mode: DeskMode }
  | { type: "set_vital"; patientId: string; field: VitalsField; value: string }
  | { type: "format_vital"; patientId: string; field: VitalsField }
  | { type: "mark_vitals_required_attempt"; patientId: string }
  | { type: "transition"; patientId: string; to: LifecycleState; reason?: string | null; missCountDelta?: number; requeueReason?: RequeueReason | null }
  | { type: "set_departing_flag"; patientId: string; key: keyof NonNullable<Patient["departingFlags"]>; value: boolean }
  | { type: "set_departing_status"; patientId: string; key: "lab" | "payment" | "pharmacy"; value: "pending" | "done" | "not_required" }
  | { type: "complete_checkin"; patientId: string }
  | { type: "doctor_signal_ready"; doctorId: string; patientId: string }
  | { type: "confirm_handoff"; patientId: string }
  | { type: "mark_missing"; patientId: string }
  | { type: "close_no_show"; patientId: string }
  | { type: "doctor_end_consultation"; doctorId: string; patientId: string }
  | { type: "patient_returns_with_reports"; patientId: string }
  | { type: "complete_checkout"; patientId: string }
  | { type: "requeue_for_doctor"; patientId: string; reason: RequeueReason }
  | { type: "rejoin_from_missed"; patientId: string }
  | { type: "send_check_sms"; patientId: string }
  | { type: "show_banner"; text: string }
  | { type: "clear_banner" }
  | { type: "snapshot_undo"; entry: AuditEntry; patient: Patient };

function logAudit(state: State, entry: AuditEntry): State {
  // Cap audit log at 500 entries to keep memory bounded.
  const next = [entry, ...state.audit].slice(0, 500);
  return { ...state, audit: next };
}

function updatePatient(
  state: State,
  patientId: string,
  updater: (patient: Patient) => Patient
): State {
  return {
    ...state,
    patients: state.patients.map((patient) =>
      patient.id === patientId ? updater(patient) : patient
    )
  };
}

function transitionPatient(
  state: State,
  patientId: string,
  to: LifecycleState,
  options: {
    requeueReason?: RequeueReason | null;
    missCountDelta?: number;
    reason?: string | null;
    actorLabel?: string;
  } = {}
): State {
  const target = state.patients.find((patient) => patient.id === patientId);
  if (!target) return state;
  const fromState = target.lifecycle;
  const queueStates: LifecycleState[] = [
    "buffer_normal",
    "buffer_lab_review",
    "buffer_doctor_recall",
    "handoff_ready"
  ];
  const isQueueState = queueStates.includes(fromState) && queueStates.includes(to);
  const keepsDoctorRecallContext =
    to === "buffer_doctor_recall" ||
    (to === "handoff_ready" && target.requeueReason === "doctor_recall");
  const leavesDoctorRecall = !keepsDoctorRecallContext;
  const leavesCheckin =
    to !== "arriving_pending_vitals" && to !== "arriving_returned_from_missed";
  const next: Patient = {
    ...target,
    lifecycle: to,
    lifecycleSince: isQueueState ? target.lifecycleSince : Date.now(),
    requeueReason:
      options.requeueReason !== undefined
        ? options.requeueReason
        : queueStates.includes(to)
          ? target.requeueReason
          : null,
    requeuedFromCompletedAt: leavesDoctorRecall ? null : target.requeuedFromCompletedAt,
    vitalsRequiredAttemptedAt: leavesCheckin ? null : target.vitalsRequiredAttemptedAt,
    missCount: target.missCount + (options.missCountDelta ?? 0),
    closedAt: to === "closed" || to === "skipped_no_show" ? Date.now() : null
  };
  const audit: AuditEntry = {
    id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    patientId,
    patientName: `${target.firstName} ${target.lastName}`,
    action: "transition",
    fromState,
    toState: to,
    reason: options.reason ?? null,
    actorLabel: options.actorLabel ?? "Reception",
    at: Date.now()
  };
  const swapped = updatePatient(state, patientId, () => next);
  return logAudit(
    {
      ...swapped,
      lastTransitionAt: Date.now()
    },
    audit
  );
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "select_doctor":
      return { ...state, selectedDoctorId: action.doctorId };

    case "toggle_pause":
      return { ...state, isQueuePaused: !state.isQueuePaused };

    case "tick":
      return { ...state, now: action.now };

    case "bind_desk":
      return {
        ...state,
        desk: { patientId: action.patientId, mode: action.mode }
      };

    case "set_vital":
      return updatePatient(state, action.patientId, (patient) => {
        const vitals = {
          ...patient.vitals,
          [action.field]: sanitizeVitalInput(action.field, action.value)
        };
        return {
          ...patient,
          vitals,
          vitalsRequiredAttemptedAt: patientHasAnyVitals(vitals)
            ? null
            : patient.vitalsRequiredAttemptedAt
        };
      });

    case "format_vital":
      return updatePatient(state, action.patientId, (patient) => {
        const formatted = formatVitalOnBlur(action.field, patient.vitals[action.field]);
        if (formatted === patient.vitals[action.field]) return patient;
        const vitals = { ...patient.vitals, [action.field]: formatted };
        return {
          ...patient,
          vitals,
          vitalsRequiredAttemptedAt: patientHasAnyVitals(vitals)
            ? null
            : patient.vitalsRequiredAttemptedAt
        };
      });

    case "mark_vitals_required_attempt":
      return updatePatient(state, action.patientId, (patient) => ({
        ...patient,
        vitalsRequiredAttemptedAt: Date.now()
      }));

    case "transition":
      return transitionPatient(state, action.patientId, action.to, {
        reason: action.reason ?? null,
        missCountDelta: action.missCountDelta,
        requeueReason: action.requeueReason
      });

    case "set_departing_flag":
      return updatePatient(state, action.patientId, (patient) => {
        if (!patient.departingFlags) return patient;
        return {
          ...patient,
          departingFlags: {
            ...patient.departingFlags,
            [action.key]: action.value
          }
        };
      });

    case "set_departing_status":
      return updatePatient(state, action.patientId, (patient) => {
        if (!patient.departingFlags) return patient;
        return {
          ...patient,
          departingFlags: {
            ...patient.departingFlags,
            [action.key]: action.value
          }
        };
      });

    case "complete_checkin": {
      const before = state.patients.find((p) => p.id === action.patientId);
      if (!before) return state;
      const hasVitals = patientHasAnyVitals(before.vitals);
      const annotated = updatePatient(state, action.patientId, (patient) => ({
        ...patient,
        noteOverride: hasVitals ? null : "Vitals pending",
        vitalsRequiredAttemptedAt: null
      }));
      // Move to the buffer for that doctor.
      const moved = transitionPatient(annotated, action.patientId, "buffer_normal", {
        reason: hasVitals ? "Added to doctor queue" : "Added to doctor queue without vitals",
        actorLabel: "Reception"
      });
      return moved;
    }

    case "doctor_signal_ready": {
      // Single-slot handoff: starting a new call returns any previous active
      // call to its original queue position.
      const existingHandoff = state.patients.find(
        (p) => p.doctorId === action.doctorId && p.lifecycle === "handoff_ready"
      );
      let next = state;
      if (existingHandoff && existingHandoff.id !== action.patientId) {
        const returnState =
          existingHandoff.requeueReason === "lab_review"
            ? "buffer_lab_review"
            : existingHandoff.requeueReason === "doctor_recall"
              ? "buffer_doctor_recall"
              : "buffer_normal";
        next = transitionPatient(next, existingHandoff.id, returnState, {
          reason: "Returned to doctor queue",
          actorLabel: "Reception"
        });
        next = {
          ...next,
          banner: {
            text: `${existingHandoff.firstName} returned to doctor queue`,
            clearAt: Date.now() + 4000
          }
        };
      }
      next = transitionPatient(next, action.patientId, "handoff_ready", {
        reason: "Call started",
        actorLabel: "Reception"
      });
      return next;
    }

    case "confirm_handoff": {
      // Promote handoff -> serving. Demote any existing serving for that doctor
      // first (shouldn't happen, but safe).
      const target = state.patients.find((p) => p.id === action.patientId);
      if (!target) return state;
      let next = state;
      const existingServing = state.patients.find(
        (p) => p.doctorId === target.doctorId && p.lifecycle === "serving"
      );
      if (existingServing && existingServing.id !== action.patientId) {
        next = transitionPatient(
          updatePatient(next, existingServing.id, (patient) => ({
            ...patient,
            outcome: "closed_no_action",
            deskTask: null
          })),
          existingServing.id,
          "closed",
          {
            reason: "Auto-closed (replaced)",
            actorLabel: "System"
          }
        );
      }
      return transitionPatient(next, action.patientId, "serving", {
        reason: "Reception confirmed handoff",
        actorLabel: "Reception"
      });
    }

    case "mark_missing": {
      const target = state.patients.find((p) => p.id === action.patientId);
      if (!target) return state;
      const annotated = updatePatient(state, action.patientId, (patient) => ({
        ...patient,
        noteOverride: "No response · moved to bottom"
      }));
      return transitionPatient(annotated, action.patientId, "missed_first_strike", {
        reason: `No response · ${target.missCount + 1}`,
        missCountDelta: 1,
        actorLabel: "Reception"
      });
    }

    case "close_no_show":
      return transitionPatient(state, action.patientId, "skipped_no_show", {
        reason: "Closed as no-show",
        actorLabel: "Reception"
      });

    case "doctor_end_consultation": {
      // Doctor closes consultation. MVP outcomes close automatically; lab
      // returns re-enter the doctor's review flow separately.
      const target = state.patients.find((p) => p.id === action.patientId);
      if (!target) return state;
      const outcome = buildDoctorOutcome(target, state.capabilities);
      const updated = updatePatient(state, action.patientId, (patient) => ({
        ...patient,
        orders: outcome.orders,
        departingFlags: null,
        outcome: outcome.outcome,
        deskTask: outcome.deskTask,
        noteOverride: outcome.note
      }));
      return transitionPatient(updated, action.patientId, outcome.lifecycle, {
        reason: "Consultation complete",
        actorLabel: "Doctor"
      });
    }

    case "patient_returns_with_reports": {
      const updated = updatePatient(state, action.patientId, (patient) => ({
        ...patient,
        lifecycle: "buffer_lab_review",
        lifecycleSince: Date.now(),
        closedAt: null,
        outcome: "return_with_reports",
        orders:
          patient.orders ?? {
            prescriptionLines: ["Prescription pending doctor review"],
            labOrders: ["CBC", "TSH"],
            pharmacyItems: [],
            followUpDate: null,
            totalDueInr: 0,
            notes: "Reason: lab report review"
          },
        deskTask: null,
        requeueReason: "lab_review",
        requeuedFromCompletedAt: null,
        noteOverride: "Reason: lab report review"
      }));
      return logAudit(
        {
          ...updated,
          lastTransitionAt: Date.now()
        },
        {
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          patientId: action.patientId,
          patientName:
            state.patients.find((patient) => patient.id === action.patientId)?.firstName ??
            "Patient",
          action: "return",
          fromState: "closed",
          toState: "buffer_lab_review",
          reason: "Lab report review",
          actorLabel: "Reception",
          at: Date.now()
        }
      );
    }

    case "complete_checkout":
      return transitionPatient(state, action.patientId, "closed", {
        reason: "Visit closed",
        actorLabel: "Reception"
      });

    case "requeue_for_doctor": {
      const requeuedAt = Date.now();
      const annotated = updatePatient(state, action.patientId, (patient) => ({
        ...patient,
        requeuedFromCompletedAt:
          action.reason === "doctor_recall" &&
          (patient.lifecycle === "closed" || patient.lifecycle === "skipped_no_show")
            ? requeuedAt
            : patient.requeuedFromCompletedAt,
        noteOverride:
          action.reason === "doctor_recall" &&
          (patient.lifecycle === "closed" || patient.lifecycle === "skipped_no_show")
            ? "Requeued from completed visit"
            : patient.noteOverride
      }));
      return transitionPatient(
        annotated,
        action.patientId,
        action.reason === "lab_review" ? "buffer_lab_review" : "buffer_doctor_recall",
        {
          requeueReason: action.reason,
          reason: `Re-queue · ${action.reason.replace(/_/g, " ")}`,
          actorLabel: "Reception"
        }
      );
    }

    case "rejoin_from_missed":
      return transitionPatient(state, action.patientId, "buffer_normal", {
        reason: "Re-queued from missed",
        actorLabel: "Reception"
      });

    case "send_check_sms":
      // Mock: no real SMS; we just bump SMS marker.
      return updatePatient(state, action.patientId, (patient) => ({
        ...patient,
        smsCheckinDeliveryStatus: "sent",
        noteOverride: "SMS · On your way?"
      }));

    case "show_banner":
      return {
        ...state,
        banner: { text: action.text, clearAt: Date.now() + 4000 }
      };

    case "clear_banner":
      return { ...state, banner: null };

    case "snapshot_undo":
      return logAudit(state, action.entry);

    default:
      return state;
  }
}

// ---------- public hook ----------

export type WorkspaceApi = ReturnType<typeof useWorkspaceState>;

export function useWorkspaceState(initialDoctors: DoctorOption[]) {
  const doctors = useMemo(() => buildSeedDoctors(initialDoctors), [initialDoctors]);
  const initialPatients = useMemo(() => buildSeedPatients(doctors), [doctors]);

  const [state, dispatch] = useReducer(reducer, undefined as unknown, () => ({
    patients: initialPatients,
    doctors,
    selectedDoctorId: doctors[0]?.id ?? "",
    desk: { patientId: null, mode: "idle" } as DeskBinding,
    isQueuePaused: false,
    capabilities: DEFAULT_CLINIC_CAPABILITIES,
    audit: [],
    now: Date.now(),
    lastTransitionAt: 0,
    banner: null
  }));

  // ---- live clock tick (1s) for serving timer / count-up animations.
  useEffect(() => {
    const interval = window.setInterval(() => {
      dispatch({ type: "tick", now: Date.now() });
    }, 1000);
    return () => window.clearInterval(interval);
  }, []);

  // ---- auto-clear silver banner.
  useEffect(() => {
    if (!state.banner) return;
    const remaining = state.banner.clearAt - Date.now();
    const timer = window.setTimeout(() => {
      dispatch({ type: "clear_banner" });
    }, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [state.banner]);

  // ---- Undo toast registry (separate state because it owns side-effects).
  const [undo, setUndo] = useState<UndoAction | null>(null);
  const undoTimerRef = useRef<number | null>(null);
  const queueUndo = useCallback((action: UndoAction) => {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
    }
    setUndo(action);
    undoTimerRef.current = window.setTimeout(() => {
      setUndo((current) => (current?.id === action.id ? null : current));
    }, action.expiresAt - Date.now());
  }, []);
  const clearUndo = useCallback(() => {
    if (undoTimerRef.current) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    setUndo(null);
  }, []);
  useEffect(
    () => () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    },
    []
  );

  // ---- selectors

  const selectedDoctor = useMemo(
    () => doctors.find((d) => d.id === state.selectedDoctorId) ?? doctors[0],
    [doctors, state.selectedDoctorId]
  );

  const arriving = useMemo(
    () =>
      state.patients
        .filter(
          (p) =>
            p.lifecycle === "arriving_pending_vitals" ||
            p.lifecycle === "arriving_returned_from_missed"
        )
        .sort((a, b) => a.arrivedAt - b.arrivedAt),
    [state.patients]
  );

  const departing = useMemo(
    () =>
      state.patients
        .filter(
          (p) =>
            p.lifecycle === "departing_lab_pending" ||
            p.lifecycle === "departing_payment_pending" ||
            p.lifecycle === "departing_pharmacy_pending" ||
            p.lifecycle === "departing_ready_to_close"
        )
        .sort((a, b) => b.lifecycleSince - a.lifecycleSince),
    [state.patients]
  );

  const missed = useMemo(
    () =>
      state.patients
        .filter((p) => p.lifecycle === "missed_first_strike")
        .sort((a, b) => b.lifecycleSince - a.lifecycleSince),
    [state.patients]
  );

  const closedToday = useMemo(
    () =>
      state.patients
        .filter((p) => p.lifecycle === "closed" || p.lifecycle === "skipped_no_show")
        .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)),
    [state.patients]
  );

  // Per-doctor selectors (used by Clinic Flow column).
  const flowForSelected = useMemo(() => {
    if (!selectedDoctor) {
      return { serving: null, handoff: null, buffer: [] as Patient[] };
    }
    const docPatients = state.patients.filter((p) => p.doctorId === selectedDoctor.id);
    const serving = docPatients.find((p) => p.lifecycle === "serving") ?? null;
    const handoff = docPatients.find((p) => p.lifecycle === "handoff_ready") ?? null;

    const buffer = docPatients
      .filter(
        (p) =>
          p.lifecycle === "buffer_normal" ||
          p.lifecycle === "buffer_lab_review" ||
          p.lifecycle === "buffer_doctor_recall" ||
          p.lifecycle === "handoff_ready" ||
          // Missed patients live inline in the doctor queue at the bottom.
          p.lifecycle === "missed_first_strike"
      )
      .sort((a, b) => bufferRank(a) - bufferRank(b));

    return { serving, handoff, buffer };
  }, [selectedDoctor, state.patients]);

  const focusedPatient = useMemo(
    () =>
      state.desk.patientId
        ? state.patients.find((p) => p.id === state.desk.patientId) ?? null
        : null,
    [state.desk.patientId, state.patients]
  );

  // Counts for badges
  const counts = useMemo(
    () => ({
      arriving: arriving.length,
      departing: departing.length,
      missed: missed.length,
      buffer: flowForSelected.buffer.length,
      closedToday: closedToday.length
    }),
    [arriving, departing, missed, flowForSelected.buffer, closedToday]
  );

  return {
    state,
    dispatch,
    doctors,
    selectedDoctor,
    arriving,
    departing,
    missed,
    closedToday,
    flowForSelected,
    focusedPatient,
    counts,
    undo,
    queueUndo,
    clearUndo
  };
}

export function emptyVitalsExport() {
  return emptyVitals();
}

function bufferRank(patient: Patient) {
  // Lower rank = closer to "next." The queue is ordered by time spent waiting;
  // missed patients are deliberately demoted to the absolute bottom.
  if (patient.lifecycle === "missed_first_strike") return 10_000_000_000_000 + patient.lifecycleSince;
  return patient.lifecycleSince;
}

// Useful for tests / consumers that need to label flag chips
export function describeDeparting(patient: Patient): {
  label: string;
  tone: "amber" | "cyan" | "neutral" | "emerald";
}[] {
  const chips: { label: string; tone: "amber" | "cyan" | "neutral" | "emerald" }[] = [];
  if (!patient.deskTask) return [{ label: "Ready", tone: "emerald" }];
  if (patient.deskTask.kind === "requeue_review") chips.push({ label: "Doctor review", tone: "cyan" });
  if (patient.deskTask.kind === "share_prescription") chips.push({ label: "Manual share", tone: "amber" });
  if (patient.deskTask.kind === "give_lab_referral") chips.push({ label: "Referral help", tone: "cyan" });
  if (patient.deskTask.kind === "schedule_follow_up") chips.push({ label: "Follow-up", tone: "neutral" });
  if (patient.deskTask.kind === "collect_payment") chips.push({ label: "Payment", tone: "amber" });
  if (patient.deskTask.kind === "close_visit") chips.push({ label: "Auto-ready", tone: "emerald" });
  return chips;
}

function makeDeskTask(kind: DeskTask["kind"]): DeskTask {
  if (kind === "requeue_review") {
    return {
      kind,
      title: "Doctor review",
      detail: "Reason: lab report review.",
      primaryLabel: "Send to review queue",
      closesVisit: false,
      requeueReason: "lab_review"
    };
  }
  if (kind === "collect_payment") {
    return {
      kind,
      title: "Payment at reception",
      detail: "This clinic is configured to collect payment at the front desk.",
      primaryLabel: "Mark paid and close",
      closesVisit: true
    };
  }
  if (kind === "schedule_follow_up") {
    return {
      kind,
      title: "Follow-up needed",
      detail: "Pick a follow-up date only if the patient asks at the desk.",
      primaryLabel: "Close visit",
      closesVisit: true
    };
  }
  return {
    kind: "close_visit",
      title: "Ready to close",
      detail: "Automation completed the visit summary.",
    primaryLabel: "Close visit",
    closesVisit: true
  };
}

function buildDoctorOutcome(patient: Patient, capabilities: ClinicCapabilities): {
  lifecycle: LifecycleState;
  outcome: NonNullable<Patient["outcome"]>;
  orders: DoctorOrders;
  deskTask: DeskTask | null;
  note: string;
} {
  const mod = patient.tokenNumber % 12;

  if (mod === 0 && capabilities.collectPaymentAtReception) {
    return {
      lifecycle: "departing_payment_pending",
      outcome: "payment_due",
      orders: {
        prescriptionLines: ["Prescription shared digitally"],
        labOrders: [],
        pharmacyItems: [],
        followUpDate: null,
        totalDueInr: 600,
        notes: "Payment handled at reception for this clinic."
      },
      deskTask: makeDeskTask("collect_payment"),
      note: "Payment at reception"
    };
  }

  if (mod === 1 || mod === 7) {
    return {
      lifecycle: "closed",
      outcome: "external_lab_referral",
      orders: {
        prescriptionLines: ["Prescription shared digitally"],
        labOrders: ["CBC", "HbA1c"],
        pharmacyItems: [],
        followUpDate: null,
        totalDueInr: 0,
        notes:
          capabilities.labRouting === "in_house"
            ? "In-house lab instructions shared."
            : "External lab referral shared digitally."
      },
      deskTask: null,
      note:
        capabilities.labRouting === "in_house"
          ? "Lab instructions shared"
          : "External lab referral shared"
    };
  }

  if (mod === 2) {
    return {
      lifecycle: "closed",
      outcome: "return_with_reports",
      orders: {
        prescriptionLines: ["Prescription pending doctor review"],
        labOrders: ["CBC", "TSH"],
        pharmacyItems: [],
        followUpDate: null,
        totalDueInr: 0,
        notes: "Lab report review can be handled as a separate visit."
      },
      deskTask: null,
      note: "Lab report review later"
    };
  }

  if (mod === 3) {
    return {
      lifecycle: "closed",
      outcome: "prescription_shared",
      orders: {
        prescriptionLines: ["Prescription shared digitally"],
        labOrders: [],
        pharmacyItems: [],
        followUpDate: null,
        totalDueInr: 0,
        notes: "Prescription shared digitally."
      },
      deskTask: null,
      note: "Prescription shared"
    };
  }

  if (mod === 4) {
    return {
      lifecycle: "closed",
      outcome: "follow_up_later",
      orders: {
        prescriptionLines: ["Prescription shared digitally"],
        labOrders: [],
        pharmacyItems: [],
        followUpDate: "2026-05-12",
        totalDueInr: 0,
        notes: "Follow-up reminder sent automatically."
      },
      deskTask: null,
      note: "Follow-up reminder sent"
    };
  }

  return {
    lifecycle: "closed",
    outcome: "prescription_shared",
    orders: {
      prescriptionLines: ["Prescription shared digitally"],
      labOrders: [],
      pharmacyItems: [],
      followUpDate: null,
      totalDueInr: 0,
      notes: "No front-desk action."
    },
    deskTask: null,
    note: "Prescription shared"
  };
}
