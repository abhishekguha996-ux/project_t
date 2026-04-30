"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { Clinic, Doctor } from "@/lib/utils/types";

import { ClinicFlow } from "./workspace/clinic-flow";
import { CommandPalette } from "./workspace/command-palette";
import { GlobalNav } from "./workspace/global-nav";
import { Inbox } from "./workspace/inbox";
import styles from "./workspace/reception-workspace.module.css";
import { highestWeightSignal, signalsFor, type ClosedTokenRef } from "./workspace/signals";
import { SimulatorFab } from "./workspace/simulator-fab";
import { TheDesk } from "./workspace/the-desk";
import { UndoToast } from "./workspace/undo-toast";
import { useWorkspaceState } from "./workspace/use-workspace-state";
import type {
  DoctorOption,
  Patient,
  RequeueReason,
  VitalsField
} from "./workspace/types";

function buildDoctorOptions(doctors: Doctor[]): DoctorOption[] {
  if (!doctors.length) return [];
  const seen = new Set<string>();
  const unique: DoctorOption[] = [];
  for (const doctor of doctors) {
    const key = doctor.name.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({
      id: doctor.id,
      name: doctor.name,
      room: doctor.room ?? null,
      specialty: doctor.specialty ?? null,
      status: doctor.status,
      avgConsultMinutes: doctor.avg_consult_minutes,
      breakReturnTime: doctor.break_return_time
    });
  }
  return unique;
}

function outcomeLabelFor(patient: Patient) {
  if (patient.noteOverride) return patient.noteOverride;
  switch (patient.outcome) {
    case "prescription_shared":
      return "Prescription shared";
    case "external_lab_referral":
      return "External lab referral";
    case "return_with_reports":
      return "Lab report review";
    case "doctor_recall":
      return "Doctor review";
    case "follow_up_later":
      return "Follow-up reminder sent";
    case "payment_due":
      return "Payment due";
    case "closed_no_action":
      return "No front-desk action";
    default:
      return null;
  }
}

export function ReceptionWorkspace({
  clinic,
  doctors
}: {
  clinic: Clinic | null;
  doctors: Doctor[];
}) {
  const doctorOptions = useMemo(() => buildDoctorOptions(doctors), [doctors]);
  const workspace = useWorkspaceState(doctorOptions);

  const {
    state,
    dispatch,
    selectedDoctor,
    arriving,
    closedToday,
    flowForSelected,
    focusedPatient,
    undo,
    queueUndo,
    clearUndo
  } = workspace;

  const [paletteOpen, setPaletteOpen] = useState(false);

  const doctorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const doctor of state.doctors) map.set(doctor.id, doctor.name);
    return map;
  }, [state.doctors]);

  const closedRefsByPatientProfileId = useMemo(() => {
    const map = new Map<string, ClosedTokenRef[]>();
    for (const patient of closedToday) {
      if (!patient.patientProfileId || !patient.closedAt) continue;
      const refs = map.get(patient.patientProfileId) ?? [];
      refs.push({
        tokenId: patient.id,
        patientProfileId: patient.patientProfileId,
        closedAt: patient.closedAt,
        outcome: patient.outcome,
        outcomeLabel: outcomeLabelFor(patient),
        doctorName: doctorNameById.get(patient.doctorId) ?? "Doctor"
      });
      map.set(patient.patientProfileId, refs);
    }
    return map;
  }, [closedToday, doctorNameById]);

  const getSignalsForPatient = useCallback(
    (patient: Patient) =>
      signalsFor({
        patient,
        clinic: state.capabilities,
        signalPolicy: state.capabilities.signalPolicy,
        sameDayClosedTokensForPatient:
          closedRefsByPatientProfileId.get(patient.patientProfileId) ?? [],
        now: state.now
      }),
    [closedRefsByPatientProfileId, state.capabilities, state.now]
  );

  const focusedSignals = useMemo(
    () => (focusedPatient ? getSignalsForPatient(focusedPatient) : []),
    [focusedPatient, getSignalsForPatient]
  );

  // ---------- Cmd+K shortcut + accelerator keys ----------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInsideEditable =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.getAttribute("contenteditable") === "true");

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (event.key === "Escape") {
        if (paletteOpen) {
          setPaletteOpen(false);
        } else if (state.desk.patientId && !isInsideEditable) {
          dispatch({ type: "bind_desk", patientId: null, mode: "idle" });
        }
        return;
      }
      if (!isInsideEditable && (event.metaKey || event.ctrlKey)) {
        if (event.key === "1") {
          event.preventDefault();
          setPaletteOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch, paletteOpen, state.desk.patientId]);

  // ---------- handlers ----------

  const handleDeskBind = useCallback(
    (patient: Patient, mode: "vitals" | "checkout") => {
      dispatch({ type: "bind_desk", patientId: patient.id, mode });
      // If the patient belongs to a different doctor, sync the Flow column.
      if (patient.doctorId !== state.selectedDoctorId) {
        dispatch({ type: "select_doctor", doctorId: patient.doctorId });
      }
    },
    [dispatch, state.selectedDoctorId]
  );

  const handlePickArriving = useCallback(
    (patient: Patient) => handleDeskBind(patient, "vitals"),
    [handleDeskBind]
  );

  const handleVitalChange = useCallback(
    (field: VitalsField, value: string) => {
      if (!focusedPatient) return;
      dispatch({ type: "set_vital", patientId: focusedPatient.id, field, value });
    },
    [dispatch, focusedPatient]
  );

  const handleVitalBlur = useCallback(
    (field: VitalsField) => {
      if (!focusedPatient) return;
      dispatch({ type: "format_vital", patientId: focusedPatient.id, field });
    },
    [dispatch, focusedPatient]
  );

  const handleCompleteCheckIn = useCallback(
    (patient: Patient) => {
      dispatch({ type: "complete_checkin", patientId: patient.id });
      // Auto-bind to the next arriving patient (if any) for that doctor — keeps flow tight.
      const nextArriving = arriving.find(
        (p) => p.id !== patient.id && p.doctorId === patient.doctorId
      );
      if (nextArriving) {
        dispatch({ type: "bind_desk", patientId: nextArriving.id, mode: "vitals" });
      } else {
        dispatch({ type: "bind_desk", patientId: null, mode: "idle" });
      }
    },
    [arriving, dispatch]
  );

  const handleVitalsRequiredAttempt = useCallback(
    (patient: Patient) => {
      dispatch({ type: "mark_vitals_required_attempt", patientId: patient.id });
    },
    [dispatch]
  );

  const handleCompleteCheckout = useCallback(
    (patient: Patient) => {
      const snapshot: Patient = { ...patient };
      dispatch({ type: "complete_checkout", patientId: patient.id });
      // queue undo
      queueUndo({
        id: `undo-checkout-${patient.id}-${Date.now()}`,
        label: `Closed visit · ${patient.firstName} ${patient.lastName}`,
        expiresAt: Date.now() + 5000,
        revert: () => {
          dispatch({
            type: "transition",
            patientId: snapshot.id,
            to: snapshot.lifecycle,
            reason: "Undo close"
          });
        }
      });
      dispatch({ type: "bind_desk", patientId: null, mode: "idle" });
    },
    [dispatch, queueUndo]
  );

  // Receptionist clicks a waiting row → Desk previews that patient.
  // The queue is not mutated until the receptionist explicitly presses
  // "Start calling" on the center card.
  const handlePickForHandoff = useCallback(
    (patient: Patient) => {
      dispatch({ type: "bind_desk", patientId: patient.id, mode: "handoff" });
      if (patient.doctorId !== state.selectedDoctorId) {
        dispatch({ type: "select_doctor", doctorId: patient.doctorId });
      }
    },
    [dispatch, state.selectedDoctorId]
  );

  // Explicit call start from the center card.
  const handleInitiateHandoff = useCallback(
    (patient: Patient) => {
      dispatch({
        type: "doctor_signal_ready",
        doctorId: patient.doctorId,
        patientId: patient.id
      });
    },
    [dispatch]
  );

  // "Patient in room" — confirm escort completed. Auto-advance Desk to the
  // next arriving patient for vitals capture, or go idle.
  const handleConfirmHandoff = useCallback(
    (patient: Patient) => {
      dispatch({ type: "confirm_handoff", patientId: patient.id });
      const nextArriving = arriving.find((p) => p.doctorId === patient.doctorId);
      if (nextArriving) {
        dispatch({ type: "bind_desk", patientId: nextArriving.id, mode: "vitals" });
      } else {
        dispatch({ type: "bind_desk", patientId: null, mode: "idle" });
      }
    },
    [arriving, dispatch]
  );

  // "No response" — flag the patient missed and preview the next waiting
  // patient. It does not auto-start another call.
  const handleMarkMissing = useCallback(
    (patient: Patient) => {
      const snapshot: Patient = { ...patient };
      dispatch({ type: "mark_missing", patientId: patient.id });
      queueUndo({
        id: `undo-missing-${patient.id}-${Date.now()}`,
        label: `Marked ${patient.firstName} missing`,
        expiresAt: Date.now() + 5000,
        revert: () => {
          dispatch({
            type: "transition",
            patientId: snapshot.id,
            to: snapshot.lifecycle,
            missCountDelta: -1,
            reason: "Undo missing"
          });
        }
      });
      // Auto-advance: pick the next non-missed patient in the same doctor's
      // lobby. Skip the patient we just missed (they're now demoted).
      const nextInLobby = flowForSelected.buffer.find(
        (p) =>
          p.id !== patient.id &&
          (p.lifecycle === "buffer_normal" ||
            p.lifecycle === "buffer_lab_review" ||
            p.lifecycle === "buffer_doctor_recall")
      );
      if (nextInLobby) {
        dispatch({ type: "bind_desk", patientId: nextInLobby.id, mode: "handoff" });
      } else {
        dispatch({ type: "bind_desk", patientId: null, mode: "idle" });
      }
    },
    [dispatch, flowForSelected.buffer, queueUndo]
  );

  const handleCloseNoShow = useCallback(
    (patient: Patient) => {
      dispatch({ type: "close_no_show", patientId: patient.id });
      dispatch({ type: "bind_desk", patientId: null, mode: "idle" });
    },
    [dispatch]
  );

  const handleSimulateDoctorReady = useCallback(
    (patient: Patient) => {
      dispatch({
        type: "doctor_signal_ready",
        doctorId: patient.doctorId,
        patientId: patient.id
      });
    },
    [dispatch]
  );

  const handleSimulateDoctorEnd = useCallback(
    (patient: Patient) => {
      dispatch({
        type: "doctor_end_consultation",
        doctorId: patient.doctorId,
        patientId: patient.id
      });
      dispatch({ type: "bind_desk", patientId: null, mode: "idle" });
    },
    [dispatch]
  );

  const handleSimulateLabReturn = useCallback(
    (patient: Patient) => {
      dispatch({ type: "patient_returns_with_reports", patientId: patient.id });
      dispatch({ type: "bind_desk", patientId: patient.id, mode: "handoff" });
    },
    [dispatch]
  );

  const handleSetDepartingFlag = useCallback(
    (
      patient: Patient,
      key: "rxPrinted" | "labFormPrinted" | "nextVisitSlipGiven" | "medicinesHandedOver",
      value: boolean
    ) => {
      dispatch({ type: "set_departing_flag", patientId: patient.id, key, value });
    },
    [dispatch]
  );

  const handleMarkPaymentDone = useCallback(
    (patient: Patient) => {
      dispatch({
        type: "set_departing_status",
        patientId: patient.id,
        key: "payment",
        value: "done"
      });
    },
    [dispatch]
  );

  const handleRequeueForDoctor = useCallback(
    (patient: Patient, reason: RequeueReason) => {
      dispatch({ type: "requeue_for_doctor", patientId: patient.id, reason });
      dispatch({ type: "bind_desk", patientId: null, mode: "idle" });
    },
    [dispatch]
  );

  const handleRejoinFromMissed = useCallback(
    (patient: Patient) => {
      dispatch({ type: "rejoin_from_missed", patientId: patient.id });
    },
    [dispatch]
  );

  const handleSendCheckSms = useCallback(
    (patient: Patient) => {
      dispatch({ type: "send_check_sms", patientId: patient.id });
    },
    [dispatch]
  );

  const handleOpenCommandPalette = useCallback(() => setPaletteOpen(true), []);

  const handlePickFromPalette = useCallback(
    (patient: Patient) => {
      setPaletteOpen(false);
      // Route based on lifecycle.
      if (
        patient.lifecycle === "arriving_pending_vitals" ||
        patient.lifecycle === "arriving_returned_from_missed"
      ) {
        handleDeskBind(patient, "vitals");
      } else if (
        patient.lifecycle === "departing_lab_pending" ||
        patient.lifecycle === "departing_payment_pending" ||
        patient.lifecycle === "departing_pharmacy_pending" ||
        patient.lifecycle === "departing_ready_to_close"
      ) {
        handleDeskBind(patient, "checkout");
      } else if (
        patient.lifecycle === "missed_first_strike" ||
        patient.lifecycle === "buffer_normal" ||
        patient.lifecycle === "buffer_lab_review" ||
        patient.lifecycle === "buffer_doctor_recall" ||
        patient.lifecycle === "handoff_ready"
      ) {
        // Lobby patients (waiting / missed / currently being called) all open
        // The Desk in handoff mode.
        handlePickForHandoff(patient);
      } else if (patient.lifecycle === "closed" || patient.lifecycle === "skipped_no_show") {
        // Closed/no-show visits open as a read-only summary on The Desk.
        dispatch({ type: "bind_desk", patientId: patient.id, mode: "detail" });
        if (patient.doctorId !== state.selectedDoctorId) {
          dispatch({ type: "select_doctor", doctorId: patient.doctorId });
        }
      } else {
        // Serving: just focus the doctor column.
        dispatch({ type: "select_doctor", doctorId: patient.doctorId });
      }
    },
    [dispatch, handleDeskBind, handlePickForHandoff, state.selectedDoctorId]
  );

  const clinicName = clinic?.name ?? "QCare Clinic";

  return (
    <section
      aria-label={`${clinicName} receptionist workspace`}
      className={styles.workspace}
    >
      <div className={styles.bgGlow} />

      <GlobalNav
        doctorOptions={state.doctors}
        isQueuePaused={state.isQueuePaused}
        onSelectDoctor={(doctorId) => dispatch({ type: "select_doctor", doctorId })}
        onToggleQueuePause={() => dispatch({ type: "toggle_pause" })}
        selectedDoctorId={state.selectedDoctorId}
      />

      <div className={styles.grid}>
        <Inbox
          arriving={arriving}
          doctorNameById={doctorNameById}
          selectedPatientId={focusedPatient?.id ?? null}
          getSignalPreview={(patient) =>
            highestWeightSignal(getSignalsForPatient(patient))?.title ?? null
          }
          onPickArriving={handlePickArriving}
        />

        <TheDesk
          mode={state.desk.mode}
          patient={focusedPatient}
          doctor={selectedDoctor ?? null}
          signals={focusedSignals}
          isQueuePaused={state.isQueuePaused}
          requiresVitalsBeforeQueue={
            state.capabilities.vitalsAtReception &&
            state.capabilities.vitalsRequirement === "required_before_queue"
          }
          onVitalChange={handleVitalChange}
          onVitalBlur={handleVitalBlur}
          onCompleteCheckIn={handleCompleteCheckIn}
          onVitalsRequiredAttempt={handleVitalsRequiredAttempt}
          onTextPatient={handleSendCheckSms}
          onCompleteCheckout={handleCompleteCheckout}
          onSetDepartingFlag={handleSetDepartingFlag}
          onMarkPaymentDone={handleMarkPaymentDone}
          onRequeueForDoctor={handleRequeueForDoctor}
          onOpenCommandPalette={handleOpenCommandPalette}
          onInitiateHandoff={handleInitiateHandoff}
          onConfirmHandoff={handleConfirmHandoff}
          onMarkMissing={handleMarkMissing}
          onCloseNoShow={handleCloseNoShow}
        />

        <ClinicFlow
          doctor={selectedDoctor ?? null}
          serving={flowForSelected.serving}
          handoff={flowForSelected.handoff}
          buffer={flowForSelected.buffer}
          isQueuePaused={state.isQueuePaused}
          banner={state.banner}
          selectedPatientId={focusedPatient?.id ?? null}
          closedToday={closedToday}
          doctorNameById={doctorNameById}
          onPickForHandoff={handlePickForHandoff}
          onOpenClosedDetail={handlePickFromPalette}
        />
      </div>

      <UndoToast action={undo} onUndo={clearUndo} onDismiss={clearUndo} />

      <SimulatorFab
        selectedDoctor={selectedDoctor ?? null}
        serving={flowForSelected.serving}
        handoff={flowForSelected.handoff}
        buffer={flowForSelected.buffer}
        closedToday={closedToday}
        onSimulateDoctorReady={handleSimulateDoctorReady}
        onSimulateDoctorEnd={handleSimulateDoctorEnd}
        onSimulateLabReturn={handleSimulateLabReturn}
      />

      {paletteOpen ? (
        <CommandPalette
          patients={state.patients}
          doctorNameById={doctorNameById}
          onClose={() => setPaletteOpen(false)}
          onPick={handlePickFromPalette}
        />
      ) : null}
    </section>
  );
}
