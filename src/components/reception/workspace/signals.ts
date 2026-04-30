import type {
  ClinicCapabilities,
  DoctorOutcomeKind,
  Patient,
  Signal,
  SignalPolicy
} from "./types";

export type ClosedTokenRef = {
  tokenId: string;
  patientProfileId: string;
  closedAt: number;
  outcome: DoctorOutcomeKind | null;
  outcomeLabel: string | null;
  doctorName: string;
};

export function hasAnyVitals(patient: Patient) {
  return Object.values(patient.vitals).some((value) => value.trim().length > 0);
}

function formatDateShort(timestampOrIso: number | string) {
  const date = new Date(timestampOrIso);
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric"
  }).format(date);
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function timeSince(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function returningTitle(patient: Patient) {
  switch (patient.returningAboutPriorVisit?.reason) {
    case "reports":
      return "Returning with reports";
    case "follow_up":
      return "Returning for follow-up";
    case "prescription_question":
      return "Prescription question";
    case "referral":
      return "Referral request";
    case "symptoms_unresolved":
      return "Symptoms unresolved";
    case "other":
    default:
      return "Returning about prior visit";
  }
}

function completedOutcomeCopy(patient: Patient) {
  if (patient.lifecycle === "skipped_no_show") {
    return {
      title: "Closed as no-show",
      detail:
        patient.missCount > 0
          ? `${patient.missCount} no response${patient.missCount === 1 ? "" : "s"} recorded`
          : "No response recorded"
    };
  }

  switch (patient.outcome) {
    case "prescription_shared":
      return {
        title: "Prescription shared",
        detail: "Digital prescription delivered"
      };
    case "external_lab_referral":
      return {
        title: "Lab referral shared",
        detail:
          patient.orders?.labOrders.length
            ? patient.orders.labOrders.join(", ")
            : "External lab referral delivered"
      };
    case "return_with_reports":
      return {
        title: "Lab review planned",
        detail: "Patient may return with reports as a new visit"
      };
    case "doctor_recall":
      return {
        title: "Doctor review requested",
        detail: "Visit closed after doctor review request"
      };
    case "follow_up_later":
      return {
        title: "Follow-up reminder sent",
        detail: patient.orders?.followUpDate
          ? `Reminder for ${formatDateShort(patient.orders.followUpDate)}`
          : "Follow-up reminder delivered"
      };
    case "payment_due":
      return {
        title: "Payment noted",
        detail: "Payment workflow recorded for this visit"
      };
    case "closed_no_action":
    default:
      return {
        title: "Visit closed",
        detail: patient.orders?.notes ?? "No front-desk action pending"
      };
  }
}

function canShowPriorVisitContext(patient: Patient) {
  return (
    patient.lifecycle === "arriving_pending_vitals" ||
    patient.lifecycle === "arriving_returned_from_missed" ||
    patient.lifecycle === "buffer_normal" ||
    patient.lifecycle === "handoff_ready"
  );
}

function applyPolicy(signals: Signal[], signalPolicy: SignalPolicy) {
  return signals.flatMap((signal) => {
    const policy = signalPolicy[signal.id];
    if (!policy?.enabled) return [];
    return [
      {
        ...signal,
        weight: policy.weightOverride ?? signal.weight
      }
    ];
  });
}

function dedupe(signals: Signal[]) {
  const byKey = new Map<string, Signal>();
  for (const signal of signals) {
    const existing = byKey.get(signal.dedupeKey);
    if (
      !existing ||
      (existing.id === "prior_visit_today" && signal.id === "returning_about_prior_visit") ||
      (existing.id !== "returning_about_prior_visit" &&
        signal.id === "returning_about_prior_visit") ||
      signal.weight > existing.weight ||
      (signal.weight === existing.weight && signal.emittedAt > existing.emittedAt)
    ) {
      byKey.set(signal.dedupeKey, signal);
    }
  }
  return Array.from(byKey.values());
}

function sortSignals(signals: Signal[]) {
  return [...signals].sort((a, b) => {
    if (a.weight !== b.weight) return b.weight - a.weight;
    if (a.emittedAt !== b.emittedAt) return b.emittedAt - a.emittedAt;
    return a.id.localeCompare(b.id);
  });
}

export function signalsFor({
  patient,
  clinic,
  signalPolicy,
  sameDayClosedTokensForPatient,
  now
}: {
  patient: Patient;
  clinic: ClinicCapabilities;
  signalPolicy: SignalPolicy;
  sameDayClosedTokensForPatient: ClosedTokenRef[];
  now: number;
}): Signal[] {
  const candidates: Signal[] = [];

  if (patient.returningAboutPriorVisit && canShowPriorVisitContext(patient)) {
    const returning = patient.returningAboutPriorVisit;
    candidates.push({
      id: "returning_about_prior_visit",
      category: "visit_intent",
      origin: "patient",
      weight: 2,
      title: returningTitle(patient),
      detail: `Re: ${formatDateShort(returning.priorVisitDate)} · ${returning.priorDoctorName} · ${returning.priorOutcomeLabel || "prior visit"}`,
      dedupeKey: `prior_token:${returning.priorTokenId}`,
      emittedAt: returning.selectedAt
    });
  }

  if (canShowPriorVisitContext(patient) && sameDayClosedTokensForPatient.length > 0) {
    const latestPrior = [...sameDayClosedTokensForPatient].sort(
      (a, b) => b.closedAt - a.closedAt
    )[0];
    if (latestPrior) {
      candidates.push({
        id: "prior_visit_today",
        category: "visit_intent",
        origin: "system",
        weight: 2,
        title: "Prior visit today",
        detail: `Closed ${formatTime(latestPrior.closedAt)} · ${latestPrior.outcomeLabel || "no outcome recorded"}`,
        dedupeKey: `prior_token:${latestPrior.tokenId}`,
        emittedAt: latestPrior.closedAt
      });
    }
  }

  if (
    patient.requeuedFromCompletedAt !== null &&
    (patient.lifecycle === "buffer_doctor_recall" ||
      (patient.lifecycle === "handoff_ready" && patient.requeueReason === "doctor_recall"))
  ) {
    candidates.push({
      id: "requeued_from_completed",
      category: "queue_history",
      origin: "staff",
      weight: 1,
      title: "Requeued from completed",
      detail: `${formatTime(patient.requeuedFromCompletedAt)} · by reception`,
      dedupeKey: `requeue:${patient.requeuedFromCompletedAt}`,
      emittedAt: patient.requeuedFromCompletedAt
    });
  }

  if (
    patient.missCount >= 1 &&
    (patient.lifecycle === "handoff_ready" || patient.lifecycle === "missed_first_strike")
  ) {
    candidates.push({
      id: "miss_strikes",
      category: "queue_history",
      origin: "system",
      weight: patient.missCount >= 2 ? 2 : 1,
      title:
        patient.missCount >= 2
          ? `No response (${patient.missCount})`
          : "No response",
      detail: `Last tried ${timeSince(patient.lifecycleSince, now)}`,
      dedupeKey: `miss:${patient.id}`,
      emittedAt: patient.lifecycleSince
    });
  }

  if (
    clinic.vitalsAtReception &&
    clinic.vitalsRequirement === "required_before_queue" &&
    patient.lifecycle === "arriving_pending_vitals" &&
    !hasAnyVitals(patient) &&
    patient.vitalsRequiredAttemptedAt !== null
  ) {
    candidates.push({
      id: "vitals_required",
      category: "operational_requirement",
      origin: "system",
      weight: 1,
      title: "Vitals required",
      detail: "Clinic policy · capture before doctor queue",
      dedupeKey: `vitals:${patient.id}`,
      emittedAt: patient.vitalsRequiredAttemptedAt
    });
  }

  if (patient.lifecycle === "closed" || patient.lifecycle === "skipped_no_show") {
    const completed = completedOutcomeCopy(patient);
    candidates.push({
      id: "completed_outcome",
      category: "visit_summary",
      origin: "system",
      weight: 1,
      title: completed.title,
      detail: completed.detail,
      dedupeKey: `completed:${patient.id}`,
      emittedAt: patient.closedAt ?? patient.lifecycleSince
    });
  }

  const policyApplied = applyPolicy(candidates, signalPolicy);
  const withoutSingleMiss = policyApplied.filter(
    (signal) => !(signal.id === "miss_strikes" && patient.missCount === 1)
  );
  return sortSignals(dedupe(withoutSingleMiss));
}

export function contextChipSignal(signals: Signal[]) {
  return signals.length === 1 && signals[0]?.weight === 1 ? signals[0] : null;
}

export function contextBlockSignals(signals: Signal[]) {
  if (signals.length === 0) return [];
  if (signals.length === 1 && signals[0]?.weight === 1) return [];
  return signals;
}

export function highestWeightSignal(signals: Signal[]) {
  return signals.find((signal) => signal.weight === 2) ?? null;
}
