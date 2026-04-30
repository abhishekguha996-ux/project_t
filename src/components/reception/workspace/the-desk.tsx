"use client";

import {
  Activity,
  CheckCircle2,
  Command as CommandIcon,
  FileText,
  History,
  PhoneOff,
  RotateCcw
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import styles from "./reception-workspace.module.css";
import { VITAL_RANGE_HINTS, formatVitalOnBlur } from "./use-workspace-state";
import type {
  DeskMode,
  DoctorOption,
  Patient,
  RequeueReason,
  Signal,
  VitalsField
} from "./types";

type DeskProps = {
  mode: DeskMode;
  patient: Patient | null;
  doctor: DoctorOption | null;
  signals: Signal[];
  isQueuePaused: boolean;
  requiresVitalsBeforeQueue: boolean;
  onVitalChange: (field: VitalsField, value: string) => void;
  onVitalBlur: (field: VitalsField) => void;
  onCompleteCheckIn: (patient: Patient) => void;
  onVitalsRequiredAttempt: (patient: Patient) => void;
  onTextPatient: (patient: Patient) => void;
  onCompleteCheckout: (patient: Patient) => void;
  onSetDepartingFlag: (
    patient: Patient,
    key: "rxPrinted" | "labFormPrinted" | "nextVisitSlipGiven" | "medicinesHandedOver",
    value: boolean
  ) => void;
  onMarkPaymentDone: (patient: Patient) => void;
  onRequeueForDoctor: (patient: Patient, reason: RequeueReason) => void;
  onOpenCommandPalette: () => void;
  // --- handoff flow ---
  // Manual retry: move the patient to handoff_ready.
  onInitiateHandoff: (patient: Patient) => void;
  // Confirm patient is physically with the doctor ("Patient in room").
  onConfirmHandoff: (patient: Patient) => void;
  // Subdued secondary ("No response — call next"): marks missed + advances.
  onMarkMissing: (patient: Patient) => void;
  onCloseNoShow: (patient: Patient) => void;
};

const VITAL_ROWS: Array<{
  field: VitalsField;
  label: string;
  placeholder: string;
  unit: string;
  inputMode: "numeric" | "decimal";
  maxLength: number;
}> = [
  { field: "heartRate", label: "HEART RATE", placeholder: "--", unit: "bpm", inputMode: "numeric", maxLength: 3 },
  { field: "temperature", label: "TEMP", placeholder: "--", unit: "°C", inputMode: "decimal", maxLength: 4 },
  { field: "bloodPressure", label: "BP", placeholder: "--/--", unit: "mmHg", inputMode: "numeric", maxLength: 7 },
  { field: "height", label: "HEIGHT", placeholder: "--", unit: "cm", inputMode: "numeric", maxLength: 3 },
  { field: "weight", label: "WEIGHT", placeholder: "--", unit: "kg", inputMode: "decimal", maxLength: 5 }
];

type BadgeTone = "amber" | "blue" | "cyan" | "neutral";

function hasAnyVitals(patient: Patient) {
  return Object.values(patient.vitals).some((value) => value.trim().length > 0);
}

function patientBadges(patient: Patient, options: { includeClosed?: boolean } = {}) {
  const badges: { label: string; tone: BadgeTone }[] = [
    { label: patient.visitType, tone: "neutral" }
  ];
  if (patient.priority === "vip") badges.push({ label: "VIP", tone: "blue" });
  if (patient.lifecycle === "buffer_lab_review" || patient.requeueReason === "lab_review") {
    badges.push({ label: "Lab review", tone: "cyan" });
  }
  if (patient.lifecycle === "buffer_doctor_recall" || patient.requeueReason === "doctor_recall") {
    badges.push({ label: "Doctor review", tone: "blue" });
  }
  if (patient.lifecycle === "missed_first_strike") {
    badges.push({ label: "No response", tone: "amber" });
  }
  if (options.includeClosed && patient.lifecycle === "closed") {
    badges.push({ label: "Closed", tone: "neutral" });
  }
  if (options.includeClosed && patient.lifecycle === "skipped_no_show") {
    badges.push({ label: "No-show", tone: "amber" });
  }

  const seen = new Set<string>();
  return badges.filter((badge) => {
    if (seen.has(badge.label)) return false;
    seen.add(badge.label);
    return true;
  });
}

function PatientBadges({
  patient,
  includeClosed
}: {
  patient: Patient;
  includeClosed?: boolean;
}) {
  const toneClass: Record<BadgeTone, string> = {
    amber: styles.badgeAmber,
    blue: styles.badgeBlue,
    cyan: styles.badgeCyan,
    neutral: styles.badgeNeutral
  };
  const badges = patientBadges(patient, { includeClosed });
  if (badges.length === 0) return null;

  return (
    <div className={styles.tagGroup}>
      {badges.map((badge) => (
        <span key={badge.label} className={`${styles.badge} ${toneClass[badge.tone]}`}>
          {badge.label}
        </span>
      ))}
    </div>
  );
}

function SignalIcon({ signal }: { signal: Signal }) {
  if (signal.id === "completed_outcome") return <CheckCircle2 size={15} />;
  if (signal.id === "vitals_required") return <Activity size={15} />;
  if (signal.id === "miss_strikes") return <PhoneOff size={15} />;
  if (signal.id === "requeued_from_completed") return <RotateCcw size={15} />;
  if (signal.id === "prior_visit_today") return <History size={15} />;
  return <FileText size={15} />;
}

function ContextStrip({ signals }: { signals: Signal[] }) {
  const primarySignal = signals[0];
  const overflow = Math.max(0, signals.length - 1);
  if (!primarySignal) return null;

  return (
    <section
      className={styles.contextStrip}
      data-weight={primarySignal.weight}
      aria-label={`Context: ${primarySignal.title}`}
    >
      <span className={styles.contextIcon} aria-hidden>
        <SignalIcon signal={primarySignal} />
      </span>
      <div className={styles.contextMain}>
        <div className={styles.contextTitleRow}>
          <span className={styles.contextTitle}>{primarySignal.title}</span>
        </div>
        <div className={styles.contextDetail}>{primarySignal.detail}</div>
      </div>
      {overflow > 0 ? (
        <span className={styles.contextMore}>+{overflow} more</span>
      ) : null}
    </section>
  );
}

export function TheDesk(props: DeskProps) {
  const { mode, patient, doctor } = props;

  if (!patient || mode === "idle") {
    return <IdleDesk onOpenCommandPalette={props.onOpenCommandPalette} />;
  }

  if (mode === "vitals") {
    return <VitalsCard {...props} patient={patient} doctor={doctor} />;
  }

  if (mode === "handoff") {
    return <HandoffCard {...props} patient={patient} doctor={doctor} />;
  }

  if (mode === "detail") {
    return (
      <DetailCard
        patient={patient}
        doctor={doctor}
        signals={props.signals}
        onRequeueForDoctor={props.onRequeueForDoctor}
      />
    );
  }

  return <CheckoutCard {...props} patient={patient} doctor={doctor} />;
}

function IdleDesk({ onOpenCommandPalette }: { onOpenCommandPalette: () => void }) {
  return (
    <section className={styles.deskColumn}>
      <article className={`${styles.card} ${styles.deskIdle}`}>
        <span className={styles.overline}>The Desk</span>
        <h2 className={styles.deskIdleHeadline}>No active patient.</h2>
        <p className={styles.deskIdleSub}>
          Pick someone from the Inbox or press{" "}
          <button
            type="button"
            className={styles.deskIdleCmdK}
            onClick={onOpenCommandPalette}
          >
            <CommandIcon size={12} /> K
          </button>{" "}
          to search.
        </p>
      </article>
    </section>
  );
}

function VitalsCard({
  patient,
  signals,
  isQueuePaused,
  requiresVitalsBeforeQueue,
  onVitalChange,
  onVitalBlur,
  onCompleteCheckIn,
  onVitalsRequiredAttempt
}: DeskProps & { patient: Patient; doctor: DoctorOption | null }) {
  const [focusedField, setFocusedField] = useState<VitalsField | null>(null);
  const [confirmNoVitalsOpen, setConfirmNoVitalsOpen] = useState(false);
  const firstVitalRef = useRef<HTMLInputElement | null>(null);

  const focusedHint = focusedField ? VITAL_RANGE_HINTS[focusedField] : "";

  const hasAnyVital = hasAnyVitals(patient);

  useEffect(() => {
    setConfirmNoVitalsOpen(false);
  }, [patient.id]);

  const handleAddToWaiting = () => {
    if (hasAnyVital) {
      onCompleteCheckIn(patient);
      return;
    }
    if (requiresVitalsBeforeQueue) {
      onVitalsRequiredAttempt(patient);
      setConfirmNoVitalsOpen(false);
      firstVitalRef.current?.focus();
      return;
    }
    setConfirmNoVitalsOpen(true);
  };

  return (
    <section className={styles.deskColumn}>
      <article className={`${styles.card} ${styles.deskCard}`}>
        <header className={styles.deskHeader}>
          <div>
            <span className={styles.overline}>Active check-in</span>
            <h1 className={styles.titleMassive}>
              {patient.firstName}
              <br />
              {patient.lastName}
            </h1>
            <p className={styles.subtitle}>
              {patient.age} y/o · {patient.gender}
            </p>
            <PatientBadges patient={patient} />
          </div>
          <div className={styles.avatar} aria-hidden>
            #{patient.tokenNumber}
          </div>
        </header>

        <ContextStrip signals={signals} />

        <div className={styles.vitalsGrid}>
          {VITAL_ROWS.map((vital) => (
            <label key={vital.field} className={styles.vitalInputGroup}>
              <span className={`${styles.overline} ${styles.vitalLabel}`}>
                {vital.label}
              </span>
              <span className={styles.vitalValue}>
                <input
                  ref={vital.field === "heartRate" ? firstVitalRef : undefined}
                  className={styles.vitalInput}
                  data-field={vital.field}
                  inputMode={vital.inputMode}
                  maxLength={vital.maxLength}
                  placeholder={vital.placeholder}
                  value={patient.vitals[vital.field]}
                  onFocus={() => setFocusedField(vital.field)}
                  onBlur={() => {
                    onVitalBlur(vital.field);
                    setFocusedField((current) => (current === vital.field ? null : current));
                  }}
                  onChange={(event) => onVitalChange(vital.field, event.target.value)}
                />
                <span className={styles.vitalUnit}>{vital.unit}</span>
              </span>
            </label>
          ))}
        </div>

        <div className={styles.deskHint} aria-live="polite">
          {focusedHint}
        </div>

        <button
          type="button"
          className={`${styles.btnPrimary} ${styles.tactileButton}`}
          onClick={handleAddToWaiting}
        >
          Add to doctor queue
        </button>

        {confirmNoVitalsOpen ? (
          <div
            className={styles.vitalsConfirmPanel}
            role="dialog"
            aria-label="No vitals recorded"
          >
            <div>
              <h2 className={styles.vitalsConfirmTitle}>No vitals recorded</h2>
              <p className={styles.vitalsConfirmCopy}>
                Add this patient to the doctor queue with a vitals pending note, or capture vitals now.
              </p>
            </div>
            <div className={styles.vitalsConfirmActions}>
              <button
                type="button"
                className={styles.vitalsConfirmSecondary}
                onClick={() => {
                  setConfirmNoVitalsOpen(false);
                  firstVitalRef.current?.focus();
                }}
              >
                Capture vitals
              </button>
              <button
                type="button"
                className={styles.vitalsConfirmPrimary}
                onClick={() => onCompleteCheckIn(patient)}
              >
                Add without vitals
              </button>
            </div>
          </div>
        ) : null}

        <div className={styles.savedCaption}>
          {hasAnyVital ? "Draft saved · we keep your keystrokes when you switch patients." : "No vitals recorded yet."}
        </div>

        {isQueuePaused ? (
          <div className={styles.deskNote}>
            Queue is paused. Check-in is allowed; the doctor won&apos;t be called automatically.
          </div>
        ) : null}
      </article>
    </section>
  );
}

function HandoffCard({
  patient,
  signals,
  isQueuePaused,
  onInitiateHandoff,
  onConfirmHandoff,
  onMarkMissing,
  onCloseNoShow
}: DeskProps & { patient: Patient; doctor: DoctorOption | null }) {
  const hasBeenCalled = patient.lifecycle === "handoff_ready";
  const isMissed = patient.lifecycle === "missed_first_strike";

  return (
    <section className={styles.deskColumn}>
      <article className={`${styles.card} ${styles.deskCard} ${styles.handoffDesk}`}>
        <header className={styles.deskHeader}>
          <div>
            <span className={`${styles.overline} ${styles.overlineBlue}`}>
              {isMissed
                ? `Doctor queue · ${patient.missCount} no response${patient.missCount === 1 ? "" : "s"}`
                : hasBeenCalled
                  ? "Calling now"
                  : "Doctor queue"}
            </span>
            <h1 className={styles.titleMassive}>
              {patient.firstName}
              <br />
              {patient.lastName}
            </h1>
            <p className={styles.subtitle}>
              {patient.age} y/o · {patient.gender}
            </p>
            <PatientBadges patient={patient} />
          </div>
          <div className={styles.avatar} aria-hidden>
            #{patient.tokenNumber}
          </div>
        </header>

        <ContextStrip signals={signals} />

        <button
          type="button"
          className={`${styles.btnPrimary} ${styles.tactileButton}`}
          disabled={isQueuePaused}
          title={isQueuePaused ? "Queue paused — resume to continue" : ""}
          onClick={() =>
            hasBeenCalled ? onConfirmHandoff(patient) : onInitiateHandoff(patient)
          }
        >
          {hasBeenCalled ? "Patient in room" : isMissed ? "Call again" : "Start calling"}
        </button>

        {hasBeenCalled ? (
          <button
            type="button"
            className={`${styles.btnSubdued} ${styles.tactileButton}`}
            onClick={() => onMarkMissing(patient)}
          >
            <PhoneOff size={14} />
            No response
          </button>
        ) : null}

        {isMissed && !hasBeenCalled ? (
          <button
            type="button"
            className={`${styles.btnSubdued} ${styles.tactileButton}`}
            onClick={() => onCloseNoShow(patient)}
          >
            Close as no-show
          </button>
        ) : null}

        {isQueuePaused ? (
          <div className={styles.deskNote}>
            Queue is paused. Resume before handing the next patient to the doctor.
          </div>
        ) : null}
      </article>
    </section>
  );
}

function CheckoutCard({
  patient,
  signals,
  onCompleteCheckout,
  onRequeueForDoctor
}: DeskProps & { patient: Patient; doctor: DoctorOption | null }) {
  const [requeueOpen, setRequeueOpen] = useState(false);
  const task =
    patient.deskTask ??
    ({
      kind: "close_visit",
      title: "Ready to close",
      detail: "Automation completed the visit summary.",
      primaryLabel: "Close visit",
      closesVisit: true
    } satisfies NonNullable<Patient["deskTask"]>);

  const handlePrimary = () => {
    if (task.requeueReason) {
      onRequeueForDoctor(patient, task.requeueReason);
      return;
    }
    onCompleteCheckout(patient);
  };

  return (
    <section className={styles.deskColumn}>
      <article className={`${styles.card} ${styles.deskCard}`}>
        <header className={styles.deskHeader}>
          <div>
            <span className={styles.overline}>Post-consult</span>
            <h1 className={styles.titleMassive}>
              {patient.firstName}
              <br />
              {patient.lastName}
            </h1>
            <p className={styles.subtitle}>
              {patient.age} y/o · {patient.gender}
            </p>
            <PatientBadges patient={patient} />
          </div>

          {!task.requeueReason ? (
          <div className={styles.requeueAnchor}>
            <button
              type="button"
              className={styles.btnRequeue}
              onClick={() => setRequeueOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={requeueOpen}
            >
              <RotateCcw size={14} />
              Re-queue
            </button>
            {requeueOpen ? (
              <div role="menu" className={styles.requeueMenu}>
                {(
                  [
                    { key: "lab_review", label: "Lab report review" },
                    { key: "doctor_recall", label: "Doctor review" }
                  ] as { key: RequeueReason; label: string }[]
                ).map((choice) => (
                  <button
                    key={choice.key}
                    type="button"
                    className={styles.requeueMenuItem}
                    onClick={() => {
                      onRequeueForDoctor(patient, choice.key);
                      setRequeueOpen(false);
                    }}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          ) : null}
        </header>

        <ContextStrip signals={signals} />

        <button
          type="button"
          className={`${styles.btnPrimary} ${styles.tactileButton}`}
          onClick={handlePrimary}
        >
          {task.primaryLabel}
        </button>

        <div className={styles.savedCaption}>
          Auto-saved.
        </div>
      </article>
    </section>
  );
}

// ---------------------------------------------------------------------
// DetailCard
// Summary used when the receptionist clicks a closed visit in Completed.
// From here, the only workflow action is sending them to doctor review.
// ---------------------------------------------------------------------
function DetailCard({
  patient,
  signals,
  onRequeueForDoctor
}: {
  patient: Patient;
  doctor: DoctorOption | null;
  signals: Signal[];
  onRequeueForDoctor: (patient: Patient, reason: RequeueReason) => void;
}) {
  const [confirmRequeueOpen, setConfirmRequeueOpen] = useState(false);

  useEffect(() => {
    setConfirmRequeueOpen(false);
  }, [patient.id]);

  return (
    <section className={styles.deskColumn}>
      <article className={`${styles.card} ${styles.deskCard} ${styles.detailDesk}`}>
        <header className={styles.deskHeader}>
          <div>
            <span className={styles.overline}>Visit summary</span>
            <h1 className={styles.titleMassive}>
              {patient.firstName}
              <br />
              {patient.lastName}
            </h1>
            <p className={styles.subtitle}>
              {patient.age} y/o · {patient.gender}
            </p>
            <PatientBadges
              patient={patient}
              includeClosed
            />
          </div>
          <div className={styles.avatar} aria-hidden>
            #{patient.tokenNumber}
          </div>
        </header>

        <ContextStrip signals={signals} />

        <div className={styles.detailActionDock}>
          {confirmRequeueOpen ? (
            <div
              className={styles.detailRequeueConfirm}
              role="dialog"
              aria-label="Confirm requeue"
            >
              <div className={styles.detailRequeueCopy}>
                Send {patient.firstName} for review?
              </div>
              <div className={styles.detailRequeueActions}>
                <button
                  type="button"
                  className={styles.detailRequeueCancel}
                  onClick={() => setConfirmRequeueOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className={styles.detailRequeueSubmit}
                  onClick={() => {
                    setConfirmRequeueOpen(false);
                    onRequeueForDoctor(patient, "doctor_recall");
                  }}
                >
                  Send to review
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`${styles.btnRequeue} ${styles.detailRequeueButton}`}
              onClick={() => setConfirmRequeueOpen(true)}
              aria-expanded={confirmRequeueOpen}
            >
              <RotateCcw size={14} />
              Requeue
            </button>
          )}
        </div>
      </article>
    </section>
  );
}

// Re-export so other files can use the formatter for tests / utilities.
export { formatVitalOnBlur };
