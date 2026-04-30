"use client";

import { ChevronRight, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "./reception-workspace.module.css";
import type { Patient } from "./types";

type CommandPaletteProps = {
  patients: Patient[];
  doctorNameById: Map<string, string>;
  onClose: () => void;
  onPick: (patient: Patient) => void;
};

function lifecycleSummary(p: Patient) {
  switch (p.lifecycle) {
    case "arriving_pending_vitals":
    case "arriving_returned_from_missed":
      return "Check-in";
    case "buffer_normal":
      return "Doctor queue";
    case "buffer_lab_review":
      return "Doctor review";
    case "buffer_doctor_recall":
      return "Doctor review";
    case "handoff_ready":
      return "Handoff";
    case "serving":
      return "In consult";
    case "departing_lab_pending":
    case "departing_payment_pending":
    case "departing_pharmacy_pending":
    case "departing_ready_to_close":
      return p.deskTask?.title ?? "Post-consult";
    case "missed_first_strike":
      return "Missed";
    case "closed":
      return "Closed";
    case "skipped_no_show":
      return "No-show";
  }
}

function lifecycleSince(patient: Patient) {
  return patient.closedAt ?? patient.arrivedAt ?? patient.lifecycleSince;
}

function timeSince(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function CommandPalette({
  patients,
  doctorNameById,
  onClose,
  onPick
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const now = Date.now();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return patients.slice(0, 20);
    return patients
      .filter((patient) =>
        `${patient.firstName} ${patient.lastName} ${patient.tokenNumber} ${patient.phone}`
          .toLowerCase()
          .includes(needle)
      )
      .slice(0, 20);
  }, [patients, query]);

  useEffect(() => {
    if (activeIndex >= results.length) setActiveIndex(0);
  }, [activeIndex, results.length]);

  return (
    <div
      className={styles.cmdkBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Search patients"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.cmdkPanel}>
        <label className={styles.cmdkInput}>
          <Search size={16} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search patients"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                onClose();
                return;
              }
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((idx) => Math.min(idx + 1, results.length - 1));
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((idx) => Math.max(idx - 1, 0));
                return;
              }
              if (event.key === "Enter") {
                event.preventDefault();
                const selected = results[activeIndex];
                if (selected) onPick(selected);
              }
            }}
          />
          <kbd className={styles.cmdkHint}>ESC</kbd>
        </label>

        <div className={styles.cmdkList}>
          {results.length === 0 ? (
            <div className={styles.cmdkEmpty}>No patients found.</div>
          ) : (
            results.map((patient, index) => (
              <button
                key={patient.id}
                type="button"
                className={styles.cmdkRow}
                data-active={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onPick(patient)}
              >
                <span className={styles.cmdkWhen}>
                  {timeSince(lifecycleSince(patient), now)}
                </span>
                <div className={styles.cmdkBody}>
                  <div className={styles.cmdkNameRow}>
                    <span className={styles.cmdkName}>
                      {patient.firstName} {patient.lastName}
                    </span>
                  </div>
                  <div className={styles.cmdkMeta}>
                    Token #{patient.tokenNumber} · {doctorNameById.get(patient.doctorId) ?? "—"} ·{" "}
                    {lifecycleSummary(patient)}
                  </div>
                </div>
                <ChevronRight size={14} className={styles.cmdkEnter} aria-hidden />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
