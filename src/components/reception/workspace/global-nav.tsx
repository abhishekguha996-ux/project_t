"use client";

import { ChevronDown, Pause, Play } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "./reception-workspace.module.css";
import type { DoctorOption } from "./types";

type GlobalNavProps = {
  doctorOptions: DoctorOption[];
  selectedDoctorId: string;
  isQueuePaused: boolean;
  onToggleQueuePause: () => void;
  onSelectDoctor: (doctorId: string) => void;
};

// Apple-style nav: only the two controls that change the room's state.
// Doctor selector (which schedule am I looking at?) sits at the far left as
// the primary anchor; Pause queue immediately follows because it's the only
// global mutation. Search lives behind ⌘K — no chrome dedicated to it.
export function GlobalNav({
  doctorOptions,
  selectedDoctorId,
  isQueuePaused,
  onToggleQueuePause,
  onSelectDoctor
}: GlobalNavProps) {
  const [isDoctorMenuOpen, setIsDoctorMenuOpen] = useState(false);
  const doctorMenuRef = useRef<HTMLDivElement | null>(null);
  const selectedDoctor = useMemo(
    () => doctorOptions.find((d) => d.id === selectedDoctorId) ?? doctorOptions[0],
    [doctorOptions, selectedDoctorId]
  );

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!doctorMenuRef.current?.contains(event.target as Node)) {
        setIsDoctorMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header className={styles.globalNav}>
      <div className={styles.navLeft}>
        <div className={styles.doctorDropdown} ref={doctorMenuRef}>
          <button
            type="button"
            aria-expanded={isDoctorMenuOpen}
            className={styles.doctorTrigger}
            onClick={() => setIsDoctorMenuOpen((v) => !v)}
          >
            <span className={styles.doctorTriggerLabel}>
              {selectedDoctor?.name ?? "Doctor"}
            </span>
            {selectedDoctor?.room ? (
              <span className={styles.doctorTriggerMeta}>{selectedDoctor.room}</span>
            ) : null}
            <ChevronDown
              aria-hidden
              className={styles.doctorTriggerIcon}
              data-open={isDoctorMenuOpen}
              size={14}
              strokeWidth={3}
            />
          </button>

          {isDoctorMenuOpen ? (
            <div className={styles.doctorMenu} role="listbox">
              {doctorOptions.map((doctor) => (
                <button
                  key={doctor.id}
                  type="button"
                  className={styles.doctorMenuItem}
                  data-selected={doctor.id === selectedDoctor?.id}
                  onClick={() => {
                    onSelectDoctor(doctor.id);
                    setIsDoctorMenuOpen(false);
                  }}
                >
                  <span className={styles.doctorMenuLabel}>{doctor.name}</span>
                  {doctor.room ? (
                    <span className={styles.doctorMenuMeta}>{doctor.room}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          type="button"
          className={`${styles.btnPause} ${styles.tactileButton}`}
          onClick={onToggleQueuePause}
          data-paused={isQueuePaused ? true : undefined}
        >
          {isQueuePaused ? <Play size={14} /> : <Pause size={14} />}
          {isQueuePaused ? "Resume queue" : "Pause queue"}
        </button>
      </div>
    </header>
  );
}
