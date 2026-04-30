"use client";

import { ChevronRight, Hexagon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import styles from "./reception-workspace.module.css";
import type { DoctorOption, Patient } from "./types";

// Each row in the simulator panel: a single dev-only action that mutates the
// rest of the workspace as if a real-world event happened (doctor pressed
// Ready, doctor finished consult, patient walked back in late, etc.).
type SimulatorAction = {
  id: string;
  label: string;
  description: string;
  // When undefined, the row renders as disabled with a faint reason caption.
  run?: () => void;
  disabledReason?: string;
};

type SimulatorFabProps = {
  selectedDoctor: DoctorOption | null;
  serving: Patient | null;
  handoff: Patient | null;
  buffer: Patient[];
  closedToday: Patient[];
  onSimulateDoctorReady: (patient: Patient) => void;
  onSimulateDoctorEnd: (patient: Patient) => void;
  onSimulateLabReturn: (patient: Patient) => void;
};

// A floating, dev-only "Simulator" surface that lives at the bottom-right.
// Replaces the dev buttons that used to live inside the consult / lobby
// columns. Visual style nods to the Node.js logo (deep green hex) so it's
// obviously not a production control.
export function SimulatorFab({
  selectedDoctor,
  serving,
  handoff,
  buffer,
  closedToday,
  onSimulateDoctorReady,
  onSimulateDoctorEnd,
  onSimulateLabReturn
}: SimulatorFabProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click + Esc, just like the doctor menu / palette.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Pick the next eligible buffer row for "Doctor ready". Skip the patient
  // currently in handoff_ready (already being called) and any missed rows
  // (those go through the explicit handoff card in The Desk).
  const nextForReady = buffer.find(
    (p) =>
      p.id !== handoff?.id &&
      (p.lifecycle === "buffer_normal" ||
        p.lifecycle === "buffer_lab_review" ||
        p.lifecycle === "buffer_doctor_recall")
  );
  const nextLabReturn = closedToday.find(
    (patient) =>
      patient.doctorId === selectedDoctor?.id &&
      (patient.outcome === "external_lab_referral" || patient.outcome === "return_with_reports")
  );

  const actions: SimulatorAction[] = [
    {
      id: "doctor-ready",
      label: "Doctor ready",
      description: nextForReady
        ? `Calls ${nextForReady.firstName} (#${nextForReady.tokenNumber})`
        : "No one in the doctor queue",
      run: nextForReady ? () => onSimulateDoctorReady(nextForReady) : undefined,
      disabledReason: !nextForReady ? "Doctor queue is empty" : undefined
    },
    {
      id: "end-consult",
      label: "End consult",
      description: serving
        ? `Consult result decides whether ${serving.firstName} closes or needs desk`
        : "Nobody is currently with the doctor",
      run: serving ? () => onSimulateDoctorEnd(serving) : undefined,
      disabledReason: !serving ? "No active consult" : undefined
    },
    {
      id: "lab-return",
      label: "Lab report review",
      description: nextLabReturn
        ? `${nextLabReturn.firstName} re-enters doctor review`
        : "No closed lab-referral patient for this doctor",
      run: nextLabReturn ? () => onSimulateLabReturn(nextLabReturn) : undefined,
      disabledReason: !nextLabReturn ? "No lab return available" : undefined
    }
  ];

  return (
    <div className={styles.simulatorRoot} ref={containerRef}>
      {open ? (
        <div className={styles.simulatorPanel} role="dialog" aria-label="Simulator">
          <header className={styles.simulatorHeader}>
            <span className={styles.simulatorOverline}>Simulator</span>
            <span className={styles.simulatorContext}>
              {selectedDoctor?.name ?? "—"}
              {selectedDoctor?.room ? ` · ${selectedDoctor.room}` : ""}
            </span>
          </header>
          <ul className={styles.simulatorList}>
            {actions.map((action) => (
              <li key={action.id}>
                <button
                  type="button"
                  className={styles.simulatorRow}
                  disabled={!action.run}
                  onClick={() => {
                    action.run?.();
                    setOpen(false);
                  }}
                >
                  <div className={styles.simulatorRowBody}>
                    <span className={styles.simulatorRowLabel}>{action.label}</span>
                    <span className={styles.simulatorRowDescription}>
                      {action.disabledReason ?? action.description}
                    </span>
                  </div>
                  {action.run ? (
                    <ChevronRight size={14} className={styles.simulatorRowChevron} />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          <footer className={styles.simulatorFooter}>
            Dev-only · simulates real-world events the doctor app would emit.
          </footer>
        </div>
      ) : null}

      <button
        type="button"
        className={styles.simulatorFab}
        aria-expanded={open}
        aria-label={open ? "Close simulator" : "Open simulator"}
        onClick={() => setOpen((prev) => !prev)}
      >
        <Hexagon size={16} strokeWidth={2.4} />
        <span className={styles.simulatorFabLabel}>Simulator</span>
      </button>
    </div>
  );
}
