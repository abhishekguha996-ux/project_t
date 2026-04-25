import { MessageSquare, Phone } from "lucide-react";
import type { CSSProperties, MutableRefObject } from "react";

import styles from "./reception-workspace.module.css";
import type { PatientVitals, ReceptionPatient, VitalsField } from "./types";

type FocusAreaProps = {
  patient: ReceptionPatient;
  vitals: PatientVitals;
  onVitalChange: (field: VitalsField, value: string) => void;
  onVitalBlur: (field: VitalsField) => void;
  onCompleteCheckIn: () => void;
  onCallPatient: () => void;
  onTextPatient: () => void;
  isSwapping: boolean;
  focusIdentityRef: MutableRefObject<HTMLDivElement | null>;
};

const VITAL_ROWS: Array<{
  field: VitalsField;
  label: string;
  placeholder: string;
  unit?: string;
  inputMode: "numeric" | "decimal";
  maxLength: number;
}> = [
  { field: "heartRate", label: "HEART RATE", placeholder: "72", unit: "bpm", inputMode: "numeric", maxLength: 3 },
  { field: "temperature", label: "TEMP", placeholder: "36.8", unit: "°C", inputMode: "decimal", maxLength: 4 },
  { field: "bloodPressure", label: "BP", placeholder: "120/80", unit: "mmHg", inputMode: "numeric", maxLength: 7 },
  { field: "height", label: "HEIGHT", placeholder: "170", unit: "cm", inputMode: "numeric", maxLength: 3 },
  { field: "weight", label: "WEIGHT", placeholder: "68.5", unit: "kg", inputMode: "decimal", maxLength: 5 }
];

export function FocusArea({
  patient,
  vitals,
  onVitalChange,
  onVitalBlur,
  onCompleteCheckIn,
  onCallPatient,
  onTextPatient,
  isSwapping,
  focusIdentityRef
}: FocusAreaProps) {
  const visitTypeClass = patient.visitType === "Follow-up" ? styles.badgeVisitFollowUp : styles.badgeVisitNew;

  return (
    <section className={styles.focusArea}>
      <article
        className={`${styles.card} ${styles.staggerIn}`}
        style={{ "--stagger-delay": "0.05s" } as CSSProperties}
      >
        <div className={styles.focusHeader}>
          <div
            className={styles.focusIdentity}
            data-swapping={isSwapping}
            key={patient.id}
            ref={(element) => {
              focusIdentityRef.current = element;
            }}
          >
            <h1 className={styles.titleMassive}>
              {patient.firstName}
              <br />
              {patient.lastName}
            </h1>
            <p className={styles.subtitle}>
              {patient.age} y/o • {patient.gender} • Token #{patient.tokenNumber}
            </p>

            <div className={styles.tagGroup}>
              <span className={`${styles.badge} ${visitTypeClass}`}>{patient.visitType}</span>
            </div>
          </div>

          <div aria-hidden className={styles.avatar}>
            {patient.initials}
          </div>
        </div>

        <div className={styles.vitalsGrid}>
          {VITAL_ROWS.map((vital) => (
            <label className={styles.vitalInputGroup} key={vital.field}>
              <span className={`${styles.overline} ${styles.vitalLabel}`}>{vital.label}</span>
              <span className={styles.vitalValue}>
                <input
                  className={styles.vitalInput}
                  data-field={vital.field}
                  inputMode={vital.inputMode}
                  maxLength={vital.maxLength}
                  onChange={(event) => onVitalChange(vital.field, event.target.value)}
                  onBlur={() => onVitalBlur(vital.field)}
                  placeholder={vital.placeholder}
                  value={vitals[vital.field]}
                />
                {vital.unit ? <span className={styles.vitalUnit}>{vital.unit}</span> : null}
              </span>
            </label>
          ))}
        </div>

        <button
          className={`${styles.btnPrimary} ${styles.tactileButton}`}
          onClick={onCompleteCheckIn}
          type="button"
        >
          Complete Check-in
        </button>

        <div className={styles.premiumLinks}>
          <button className={`${styles.premiumLink} ${styles.tactileButton}`} onClick={onCallPatient} type="button">
            <Phone size={16} />
            Call Patient
          </button>
          <button className={`${styles.premiumLink} ${styles.tactileButton}`} onClick={onTextPatient} type="button">
            <MessageSquare size={16} />
            Text
          </button>
        </div>
      </article>
    </section>
  );
}
