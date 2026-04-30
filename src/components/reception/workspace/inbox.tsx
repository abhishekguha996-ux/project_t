"use client";

import { ChevronRight, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import styles from "./reception-workspace.module.css";
import type { Patient } from "./types";

const UPCOMING_VISIBLE_COUNT = 4;

type InboxProps = {
  arriving: Patient[];
  doctorNameById: Map<string, string>;
  selectedPatientId: string | null;
  getSignalPreview?: (patient: Patient) => string | null;
  onPickArriving: (patient: Patient) => void;
};

function timeSince(timestamp: number, now: number) {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export function Inbox({
  arriving,
  doctorNameById,
  selectedPatientId,
  getSignalPreview,
  onPickArriving
}: InboxProps) {
  const [query, setQuery] = useState("");
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseQuery, setBrowseQuery] = useState("");
  const now = Date.now();

  useEffect(() => {
    if (!browseOpen) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setBrowseOpen(false);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [browseOpen]);

  const filteredArriving = useMemo(
    () => filterPatients(arriving, query, doctorNameById),
    [arriving, doctorNameById, query]
  );
  const browseArriving = useMemo(
    () => filterPatients(arriving, browseQuery, doctorNameById),
    [arriving, browseQuery, doctorNameById]
  );
  const visibleArriving = filteredArriving.slice(0, UPCOMING_VISIBLE_COUNT);
  const hiddenArrivingCount = Math.max(0, filteredArriving.length - visibleArriving.length);

  const pickArriving = (patient: Patient) => {
    setBrowseOpen(false);
    onPickArriving(patient);
  };

  return (
    <aside className={styles.inboxColumn} aria-label="Check-in">
      <header className={styles.worklistHeader}>
        <span className={styles.overline}>Check-in</span>
        <span className={styles.worklistCountPill}>{arriving.length}</span>
      </header>

      <SearchField
        value={query}
        onChange={setQuery}
        placeholder="Search check-ins"
        label="Search check-ins"
      />

      <div className={styles.inboxList} role="list">
        {arriving.length === 0 ? (
          <div className={styles.inboxEmpty}>All caught up. New check-ins land here.</div>
        ) : filteredArriving.length === 0 ? (
          <div className={styles.inboxEmpty}>No matching arrivals.</div>
        ) : (
          <>
            {visibleArriving.map((patient) => (
              <ArrivingRow
                key={patient.id}
                patient={patient}
                doctorName={doctorNameById.get(patient.doctorId) ?? "-"}
                isSelected={patient.id === selectedPatientId}
                signalPreview={getSignalPreview?.(patient) ?? null}
                now={now}
                onPick={() => pickArriving(patient)}
              />
            ))}
            {hiddenArrivingCount > 0 ? (
              <button
                type="button"
                className={styles.worklistMoreButton}
                onClick={() => {
                  setBrowseQuery(query);
                  setBrowseOpen(true);
                }}
              >
                <span>+{hiddenArrivingCount} more check-ins</span>
                <ChevronRight size={14} />
              </button>
            ) : null}
          </>
        )}
      </div>

      {browseOpen ? (
        <ArrivingBrowsePanel
          total={arriving.length}
          query={browseQuery}
          onQueryChange={setBrowseQuery}
          patients={browseArriving}
          doctorNameById={doctorNameById}
          selectedPatientId={selectedPatientId}
          now={now}
          onClose={() => setBrowseOpen(false)}
          onPickArriving={pickArriving}
          getSignalPreview={getSignalPreview}
        />
      ) : null}

    </aside>
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

function ArrivingBrowsePanel({
  total,
  query,
  onQueryChange,
  patients,
  doctorNameById,
  selectedPatientId,
  now,
  onClose,
  onPickArriving,
  getSignalPreview
}: {
  total: number;
  query: string;
  onQueryChange: (query: string) => void;
  patients: Patient[];
  doctorNameById: Map<string, string>;
  selectedPatientId: string | null;
  now: number;
  onClose: () => void;
  onPickArriving: (patient: Patient) => void;
  getSignalPreview?: (patient: Patient) => string | null;
}) {
  return (
    <div
      className={styles.worklistSheetBackdrop}
      role="dialog"
      aria-modal="true"
      aria-label="Check-ins"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className={styles.worklistSheet}>
        <header className={styles.worklistSheetHeader}>
          <div>
            <span className={styles.overline}>Check-in</span>
            <h2 className={styles.worklistSheetTitle}>{total} check-ins</h2>
          </div>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={onClose}
            aria-label="Close check-ins"
          >
            <X size={18} />
          </button>
        </header>

        <SearchField
          value={query}
          onChange={onQueryChange}
          placeholder="Search check-ins"
          label="Search check-ins"
          autoFocus
        />

        <div className={styles.worklistMeta}>
          <span>{query.trim() ? `${patients.length} matches` : "Oldest first"}</span>
          <span>{total} total</span>
        </div>

        <div className={styles.worklistSheetList} role="list">
          {patients.length === 0 ? (
            <div className={styles.inboxEmpty}>No matching patients.</div>
          ) : (
            patients.map((patient) => (
              <ArrivingRow
                key={patient.id}
                patient={patient}
                doctorName={doctorNameById.get(patient.doctorId) ?? "-"}
                isSelected={patient.id === selectedPatientId}
                signalPreview={getSignalPreview?.(patient) ?? null}
                now={now}
                onPick={() => onPickArriving(patient)}
              />
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function ArrivingRow({
  patient,
  doctorName,
  isSelected,
  signalPreview,
  now,
  onPick
}: {
  patient: Patient;
  doctorName: string;
  isSelected: boolean;
  signalPreview: string | null;
  now: number;
  onPick: () => void;
}) {
  const isReturned = patient.lifecycle === "arriving_returned_from_missed";
  const previewLabel = signalPreview ?? (isReturned ? "RE-ENTRY" : null);
  return (
    <div role="listitem" data-selected={isSelected} className={styles.inboxRow}>
      <button type="button" className={styles.inboxRowSurface} onClick={onPick}>
        <span className={styles.inboxWhen}>{timeSince(patient.arrivedAt, now)}</span>
        <div className={styles.inboxBody}>
          <div className={styles.inboxNameRow}>
            <span className={styles.inboxName}>
              {patient.firstName} {patient.lastName}
            </span>
            {patient.smsCheckinDeliveryStatus === "failed" ? (
              <span className={styles.smsFailedDot} aria-label="SMS failed" />
            ) : null}
            {previewLabel ? (
              <span className={`${styles.chip} ${styles.chipAmber}`}>{previewLabel}</span>
            ) : null}
          </div>
          <div className={styles.inboxMeta}>Token #{patient.tokenNumber} · {doctorName}</div>
        </div>
        <ChevronRight size={14} className={styles.rowChevron} aria-hidden />
      </button>
    </div>
  );
}
