"use client";

import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "./reception-workspace.module.css";
import type { Patient } from "./types";

type OverflowModalProps = {
  buffer: Patient[];
  visibleCount: number;
  onClose: () => void;
  onPickPatient: (patient: Patient) => void;
};

function timeSince(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function OverflowModal({
  buffer,
  visibleCount,
  onClose,
  onPickPatient
}: OverflowModalProps) {
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const now = Date.now();

  useEffect(() => {
    inputRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const overflow = buffer.slice(visibleCount);
    if (!filter.trim()) return overflow;
    const needle = filter.trim().toLowerCase();
    return overflow.filter((patient) =>
      `${patient.firstName} ${patient.lastName} ${patient.tokenNumber}`
        .toLowerCase()
        .includes(needle)
    );
  }, [buffer, visibleCount, filter]);

  return (
    <div
      className={styles.overflowBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Doctor queue"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.overflowPanel} ref={containerRef}>
        <header className={styles.overflowHeader}>
          <div>
            <span className={styles.overline}>Doctor queue</span>
            <h2 className={styles.overflowTitle}>
              {buffer.length} in doctor queue
            </h2>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <label className={styles.worklistSearch}>
          <Search size={15} aria-hidden />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search doctor queue"
            aria-label="Search doctor queue"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          {filter ? (
            <button
              type="button"
              className={styles.worklistClear}
              onClick={() => setFilter("")}
              aria-label="Clear search"
            >
              <X size={13} />
            </button>
          ) : null}
        </label>

        <div className={styles.overflowList}>
          {filtered.length === 0 ? (
            <p className={styles.flowEmpty}>No matching patients.</p>
          ) : (
            filtered.map((patient) => (
              <button
                key={patient.id}
                type="button"
                className={styles.overflowRow}
                onClick={() => onPickPatient(patient)}
              >
                <span className={styles.bufferWhen}>
                  {timeSince(patient.lifecycleSince, now)}
                </span>
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
