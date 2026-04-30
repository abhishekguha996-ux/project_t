"use client";

import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import styles from "./reception-workspace.module.css";
import type { Patient } from "./types";

type CompletedVisitsProps = {
  closedToday: Patient[];
  doctorNameById: Map<string, string>;
  onOpenClosedDetail: (patient: Patient) => void;
};

function timeSince(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function filterPatients(
  patients: Patient[],
  query: string,
  doctorNameById: Map<string, string>
) {
  const needle = query.trim().toLowerCase();
  if (!needle) return patients;
  return patients.filter((patient) => {
    const doctorName = doctorNameById.get(patient.doctorId) ?? "";
    return [
      patient.firstName,
      patient.lastName,
      patient.tokenNumber,
      patient.phone,
      doctorName,
      patient.noteOverride,
      patient.outcome
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });
}

export function CompletedVisits({
  closedToday,
  doctorNameById,
  onOpenClosedDetail
}: CompletedVisitsProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const now = Date.now();

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open]);

  const filteredCompleted = useMemo(
    () => filterPatients(closedToday, query, doctorNameById),
    [closedToday, doctorNameById, query]
  );

  return (
    <div className={styles.flowCompletedDock}>
      <button
        type="button"
        className={styles.flowCompletedButton}
        onClick={() => {
          setQuery("");
          setOpen(true);
        }}
      >
        <span>
          <span className={styles.flowCompletedTitle}>Completed</span>
          <span className={styles.flowCompletedMeta}>
            {closedToday.length} closed today
          </span>
        </span>
        <ChevronRight size={15} />
      </button>

      {open ? (
        <CompletedPanel
          closedToday={closedToday}
          filteredClosedToday={filteredCompleted}
          doctorNameById={doctorNameById}
          now={now}
          query={query}
          onQueryChange={setQuery}
          onClose={() => setOpen(false)}
          onOpenClosedDetail={(patient) => {
            setOpen(false);
            onOpenClosedDetail(patient);
          }}
        />
      ) : null}
    </div>
  );
}

function SearchField({
  value,
  onChange,
  placeholder,
  label,
  autoFocus
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
}) {
  return (
    <label className={styles.worklistSearch}>
      <Search size={15} aria-hidden />
      <input
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={label}
        autoFocus={autoFocus}
      />
      {value ? (
        <button
          type="button"
          className={styles.worklistClear}
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X size={13} />
        </button>
      ) : null}
    </label>
  );
}

function CompletedPanel({
  closedToday,
  filteredClosedToday,
  doctorNameById,
  now,
  query,
  onQueryChange,
  onClose,
  onOpenClosedDetail
}: {
  closedToday: Patient[];
  filteredClosedToday: Patient[];
  doctorNameById: Map<string, string>;
  now: number;
  query: string;
  onQueryChange: (query: string) => void;
  onClose: () => void;
  onOpenClosedDetail: (patient: Patient) => void;
}) {
  const noShowCount = closedToday.filter(
    (patient) => patient.lifecycle === "skipped_no_show"
  ).length;

  return (
    <div
      className={`${styles.dayDrawerBackdrop} ${styles.dayDrawerBackdropRight}`}
      role="dialog"
      aria-modal="true"
      aria-label="Completed visits"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={styles.dayDrawerPanel}>
        <header className={styles.dayDrawerPanelHeader}>
          <div>
            <span className={styles.overline}>Completed</span>
            <h2 className={styles.dayDrawerPanelTitle}>
              {closedToday.length} visits closed today
            </h2>
          </div>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close completed visits"
          >
            <X size={18} />
          </button>
        </header>

        <SearchField
          value={query}
          onChange={onQueryChange}
          placeholder="Search completed visits"
          label="Search completed visits"
          autoFocus
        />

        <div className={styles.dayDrawerResultMeta}>
          <span>{query.trim() ? `${filteredClosedToday.length} matches` : "Latest first"}</span>
          <span>{noShowCount} no-shows</span>
        </div>

        <div className={styles.dayDrawerPanelList} role="list">
          {closedToday.length === 0 ? (
            <div className={styles.inboxEmpty}>No completed visits yet today.</div>
          ) : filteredClosedToday.length === 0 ? (
            <div className={styles.inboxEmpty}>No matching completed visits.</div>
          ) : (
            filteredClosedToday.map((patient) => (
              <CompletedRow
                key={patient.id}
                patient={patient}
                doctorName={doctorNameById.get(patient.doctorId) ?? "-"}
                now={now}
                onPick={() => onOpenClosedDetail(patient)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function CompletedRow({
  patient,
  doctorName,
  now,
  onPick
}: {
  patient: Patient;
  doctorName: string;
  now: number;
  onPick: () => void;
}) {
  const isNoShow = patient.lifecycle === "skipped_no_show";

  return (
    <div role="listitem" className={styles.inboxRow}>
      <button type="button" className={styles.inboxRowSurface} onClick={onPick}>
        <span className={styles.inboxWhen}>
          {patient.closedAt ? timeSince(patient.closedAt, now) : "-"}
        </span>
        <div className={styles.inboxBody}>
          <div className={styles.inboxNameRow}>
            <span className={styles.inboxName}>
              {patient.firstName} {patient.lastName}
            </span>
          </div>
          <div className={styles.inboxMeta}>
            Token #{patient.tokenNumber} · {doctorName}
            {isNoShow ? " · No-show" : ""}
          </div>
        </div>
        <ChevronRight size={14} className={styles.rowChevron} aria-hidden />
      </button>
    </div>
  );
}
