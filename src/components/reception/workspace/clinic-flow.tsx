"use client";

import { ChevronRight, Clock, Coffee } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { CompletedVisits } from "./completed-visits";
import { OverflowModal } from "./overflow-modal";
import styles from "./reception-workspace.module.css";
import type { DoctorOption, Patient } from "./types";

type ClinicFlowProps = {
  doctor: DoctorOption | null;
  serving: Patient | null;
  // The patient currently being called/escorted (in handoff_ready state).
  // They remain in queue order and only get a small calling marker.
  handoff: Patient | null;
  buffer: Patient[];
  isQueuePaused: boolean;
  banner: { text: string; clearAt: number } | null;
  selectedPatientId: string | null;
  closedToday: Patient[];
  doctorNameById: Map<string, string>;
  // Receptionist clicks a lobby row → Desk previews that patient. It does not
  // change queue order or start a call.
  onPickForHandoff: (patient: Patient) => void;
  onOpenClosedDetail: (patient: Patient) => void;
};

function formatElapsed(sinceMs: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function timeSince(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function ClinicFlow({
  doctor,
  serving,
  handoff,
  buffer,
  isQueuePaused,
  banner,
  selectedPatientId,
  closedToday,
  doctorNameById,
  onPickForHandoff,
  onOpenClosedDetail
}: ClinicFlowProps) {
  const [tick, setTick] = useState(0);
  const [overflowOpen, setOverflowOpen] = useState(false);

  // 1s tick to refresh the live timer + the "x ago" labels.
  useEffect(() => {
    const interval = window.setInterval(() => setTick((t) => t + 1), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const visibleBuffer = useMemo(() => buffer.slice(0, 4), [buffer]);
  const overflowCount = Math.max(0, buffer.length - visibleBuffer.length);
  const now = useMemo(() => Date.now(), [tick]);

  const isOnBreak =
    doctor?.status === "break" ||
    doctor?.status === "paused" ||
    doctor?.status === "offline";

  const longRunning =
    serving && doctor
      ? Date.now() - serving.lifecycleSince > doctor.avgConsultMinutes * 60 * 1000 * 1.5
      : false;

  return (
    <aside className={styles.flowColumn} aria-label="Clinic flow">
      {/* ----- Currently Serving ----- */}
      <section className={styles.flowCard}>
        <div className={styles.flowHeader}>
          <span className={styles.overline}>Currently serving</span>
          {doctor ? (
            <span className={styles.flowDoctor}>
              {doctor.name}
              {doctor.room ? ` · ${doctor.room}` : ""}
            </span>
          ) : null}
        </div>

        {isOnBreak ? (
          <div className={styles.breakBanner}>
            <Coffee size={16} />
            <div>
              <div className={styles.breakBannerTitle}>
                On break
                {doctor?.breakReturnTime ? ` · returns ${doctor.breakReturnTime}` : ""}
              </div>
              <div className={styles.breakBannerSub}>
                Calls are queued. Buffer remains visible below.
              </div>
            </div>
          </div>
        ) : serving ? (
          <div className={styles.servingRow}>
            <div>
              <div className={styles.servingName}>
                {serving.firstName} {serving.lastName}
              </div>
              <div className={styles.servingMeta}>
                #{serving.tokenNumber} · {serving.age} y/o · {serving.gender}
              </div>
            </div>
            <div className={styles.servingTimerStack}>
              <span
                className={styles.servingTimer}
                data-long-running={longRunning ? true : undefined}
                aria-live="off"
              >
                <Clock size={14} />
                <span suppressHydrationWarning>{formatElapsed(serving.lifecycleSince)}</span>
              </span>
            </div>
          </div>
        ) : (
          <p className={styles.flowEmpty}>Doctor is between patients.</p>
        )}
      </section>

      {/* ----- Doctor queue (waiting + missed + currently-being-called) ----- */}
      <section className={styles.flowCard}>
        <div className={styles.flowHeader}>
          <span className={styles.overline}>Doctor queue · {buffer.length}</span>
        </div>

        {buffer.length === 0 ? (
          <p className={styles.flowEmpty}>No patients in doctor queue.</p>
        ) : (
          <div className={styles.bufferList}>
            {visibleBuffer.map((patient) => (
              <BufferRow
                key={patient.id}
                patient={patient}
                now={now}
                isCalling={handoff?.id === patient.id}
                isSelected={patient.id === selectedPatientId}
                onPick={() => onPickForHandoff(patient)}
              />
            ))}
            {overflowCount > 0 ? (
              <button
                type="button"
                className={styles.overflowChip}
                onClick={() => setOverflowOpen(true)}
              >
                +{overflowCount} more in queue
                <ChevronRight size={14} />
              </button>
            ) : null}
          </div>
        )}
      </section>

      {banner ? (
        <div className={styles.silverBanner} role="status">
          {banner.text}
        </div>
      ) : null}

      <CompletedVisits
        closedToday={closedToday}
        doctorNameById={doctorNameById}
        onOpenClosedDetail={onOpenClosedDetail}
      />

      {overflowOpen ? (
        <OverflowModal
          buffer={buffer}
          visibleCount={visibleBuffer.length}
          onClose={() => setOverflowOpen(false)}
          onPickPatient={(patient) => {
            onPickForHandoff(patient);
            setOverflowOpen(false);
          }}
        />
      ) : null}
    </aside>
  );
}

function BufferRow({
  patient,
  now,
  isCalling,
  isSelected,
  onPick
}: {
  patient: Patient;
  now: number;
  isCalling?: boolean;
  isSelected?: boolean;
  onPick: () => void;
}) {
  const isMissed = patient.lifecycle === "missed_first_strike";

  return (
    <button
      type="button"
      className={styles.bufferRow}
      data-calling={isCalling ? true : undefined}
      data-missed={isMissed ? true : undefined}
      data-selected={isSelected ? true : undefined}
      onClick={onPick}
    >
      <span className={styles.bufferWhen}>{timeSince(patient.lifecycleSince, now)}</span>
      <div className={styles.bufferBody}>
        <div className={styles.bufferNameRow}>
          <span className={styles.bufferName}>
            {patient.firstName} {patient.lastName}
          </span>
        </div>
        <div className={styles.bufferMeta}>Token #{patient.tokenNumber}</div>
      </div>
      <ChevronRight size={14} className={styles.rowChevron} aria-hidden />
    </button>
  );
}
