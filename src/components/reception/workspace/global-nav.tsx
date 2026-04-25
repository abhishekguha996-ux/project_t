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
    () => doctorOptions.find((doctor) => doctor.id === selectedDoctorId) ?? doctorOptions[0],
    [doctorOptions, selectedDoctorId]
  );

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      if (!doctorMenuRef.current?.contains(event.target as Node)) {
        setIsDoctorMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);

  return (
    <header className={styles.globalNav}>
      <div className={styles.navLeft}>
        <div className={styles.doctorDropdown} ref={doctorMenuRef}>
          <button
            aria-expanded={isDoctorMenuOpen}
            className={styles.doctorTrigger}
            onClick={() => setIsDoctorMenuOpen((previous) => !previous)}
            type="button"
          >
            <span className={styles.doctorTriggerLabel}>{selectedDoctor?.name ?? "Doctor"}</span>
            {selectedDoctor?.room ? <span className={styles.doctorTriggerMeta}>{selectedDoctor.room}</span> : null}
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
                  className={styles.doctorMenuItem}
                  data-selected={doctor.id === selectedDoctor?.id}
                  key={doctor.id}
                  onClick={() => {
                    onSelectDoctor(doctor.id);
                    setIsDoctorMenuOpen(false);
                  }}
                  type="button"
                >
                  <span className={styles.doctorMenuLabel}>{doctor.name}</span>
                  {doctor.room ? <span className={styles.doctorMenuMeta}>{doctor.room}</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className={styles.verticalDivider} />

        <button
          className={`${styles.btnPause} ${styles.tactileButton}`}
          onClick={onToggleQueuePause}
          type="button"
        >
          {isQueuePaused ? <Play size={14} /> : <Pause size={14} />}
          {isQueuePaused ? "Resume Queue" : "Pause Queue"}
        </button>
      </div>
    </header>
  );
}
