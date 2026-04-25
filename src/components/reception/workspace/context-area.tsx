import { Search } from "lucide-react";
import type { CSSProperties } from "react";

import styles from "./reception-workspace.module.css";
import type { ReadyPatient, ReceptionPatient, ServingPatient } from "./types";

type ContextAreaProps = {
  currentlyServing: ServingPatient;
  readyQueue: ReadyPatient[];
  upcomingPatients: ReceptionPatient[];
  totalUpcoming: number;
  searchValue: string;
  onSearchChange: (value: string) => void;
  isTransferRunning: boolean;
  onCallNext: () => void;
  onCheckIn: (patientId: string) => void;
};

function staggerStyle(delay: number): CSSProperties {
  return { "--stagger-delay": `${delay}s` } as CSSProperties;
}

export function ContextArea({
  currentlyServing,
  readyQueue,
  upcomingPatients,
  totalUpcoming,
  searchValue,
  onSearchChange,
  isTransferRunning,
  onCallNext,
  onCheckIn
}: ContextAreaProps) {
  const readyLead = readyQueue[0];

  return (
    <aside className={styles.contextArea}>
      <section className={`${styles.cardSmall} ${styles.staggerIn}`} style={staggerStyle(0.1)}>
        <span className={styles.overline}>Currently Serving</span>
        <div className={styles.currentlyServingRow}>
          <div>
            <div className={styles.currentlyServingName}>{currentlyServing.name}</div>
            <div className={styles.subtitle} style={{ fontSize: "0.85rem" }}>
              {currentlyServing.doctorLine}
            </div>
          </div>
          <div className={styles.currentlyServingTime}>{currentlyServing.clockLabel}</div>
        </div>
      </section>

      <section className={`${styles.cardSmall} ${styles.staggerIn}`} style={staggerStyle(0.15)}>
        <div className={styles.readyHeader}>
          <span className={`${styles.overline} ${styles.overlineGreen}`} style={{ margin: 0 }}>
            Ready For Doctor ({readyQueue.length})
          </span>
          <button
            className={`${styles.btnTranslucent} ${styles.tactileButton}`}
            disabled={!upcomingPatients.length || isTransferRunning}
            onClick={onCallNext}
            type="button"
          >
            Call Next
          </button>
        </div>

        {readyLead ? (
          <div className={styles.readyRow}>
            <div className={styles.readyAvatar}>{readyLead.initials}</div>
            <div>
              <div className={styles.readyName}>{readyLead.name}</div>
              <div className={styles.subtitle} style={{ fontSize: "0.8rem" }}>
                {readyLead.statusLabel}
              </div>
            </div>
          </div>
        ) : (
          <p className={styles.emptyState}>No patients ready yet.</p>
        )}
      </section>

      <section className={styles.staggerIn} style={staggerStyle(0.2)}>
        <label className={`${styles.searchContainer} ${styles.contextSearch}`}>
          <span className={styles.searchIcon}>
            <Search size={18} strokeWidth={2.5} />
          </span>
          <input
            aria-label="Search this doctor's queue"
            className={styles.searchInput}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search this doctor's queue"
            type="text"
            value={searchValue}
          />
        </label>

        <span className={`${styles.overline} ${styles.upcomingHeader}`} style={{ color: "var(--text-muted)" }}>
          Upcoming ({totalUpcoming})
        </span>

        {upcomingPatients.length === 0 ? (
          <p className={styles.emptyState}>No matching patients in the upcoming queue.</p>
        ) : null}

        {upcomingPatients.map((patient, index) => (
          <div
            className={`${styles.listItem} ${styles.staggerIn}`}
            key={patient.id}
            style={staggerStyle(0.24 + index * 0.05)}
          >
            <div className={styles.timelineIdentity}>
              <div className={styles.timelineTime}>{patient.timelineTime}</div>
              <div>
                <div className={styles.timelineName}>
                  {patient.firstName} {patient.lastName}
                </div>
                <div className={styles.timelineToken}>Token #{patient.tokenNumber}</div>
              </div>
            </div>

            <div className={styles.hoverAction}>
              <button
                className={`${styles.btnTextAction} ${styles.tactileButton}`}
                disabled={isTransferRunning}
                onClick={() => onCheckIn(patient.id)}
                type="button"
              >
                Check In
              </button>
            </div>
          </div>
        ))}
      </section>
    </aside>
  );
}
