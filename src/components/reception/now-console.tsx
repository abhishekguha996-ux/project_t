"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  PauseCircle,
  Phone,
  PlayCircle,
  RotateCcw,
  Search,
  Sparkles,
  UserPlus,
  X
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import type {
  AppRole,
  CheckoutStage,
  Clinic,
  Doctor,
  TokenStatus
} from "@/lib/utils/types";

/* ---------- Types mirrored from API ---------- */

type SmsStatus = "queued" | "sent" | "delivered" | "failed" | "undelivered";

type ProximityStatus = "in_clinic" | "nearby" | "unknown";

type QueueItem = {
  id: string;
  token_number: number;
  patient_id?: string;
  status: TokenStatus;
  checkin_channel: string;
  checked_in_at: string;
  serving_started_at?: string | null;
  completed_at?: string | null;
  raw_complaint: string | null;
  hold_until: string | null;
  hold_note: string | null;
  vitals_taken_at?: string | null;
  proximity_status?: ProximityStatus | null;
  held_from_state?: string | null;
  seen_by_doctor?: boolean;
  patients: {
    name?: string | null;
    phone?: string | null;
    age?: number | null;
    gender?: "male" | "female" | "other" | null;
    language_preference?: string | null;
    created_at?: string | null;
    insurance_provider?: string | null;
    insurance_policy_number?: string | null;
  } | null;
  doctors: { name?: string | null; status?: string | null } | null;
  sms?: { your_turn: SmsStatus | null; checkin_confirm: SmsStatus | null } | null;
  checkout?: {
    checkout_stage: CheckoutStage;
    payment_status: string;
    pharmacy_status: string;
    lab_status: string;
    closed_at: string | null;
  } | null;
};

type QueueSummary = {
  total: number;
  waiting: number;
  serving: number;
  complete: number;
  skipped: number;
  steppedOut: number;
};

type QueuePause = { id: string; reason: string; ends_at: string; note: string | null };

type NeedsYouItem = {
  id: string;
  severity: "red" | "amber" | "info";
  title: string;
  detail: string;
  primary?: { label: string; run: () => Promise<void> | void };
  secondary?: { label: string; run: () => Promise<void> | void };
};

type PatientHit = {
  id: string;
  name: string;
  phone: string;
  age: number | null;
  gender: "male" | "female" | "other" | null;
  language_preference: string | null;
  allergies: string[];
  created_at: string | null;
  totalVisits: number;
  todayToken: {
    id: string;
    token_number: number;
    status: string;
    doctor_id: string;
    doctor_name: string | null;
    checked_in_at: string;
  } | null;
  lastToken: {
    id: string;
    token_number: number;
    status: string;
    date: string;
    raw_complaint: string | null;
    doctor_name: string | null;
  } | null;
};

const RED_FLAG_RE =
  /chest pain|breathless|breathing|unconscious|bleeding|stroke|seizure|saans|chhati|chaati|dum ghut|paralysis|numb/i;
const AVG_CONSULT_MIN = 8;

/* ---------- Helpers ---------- */

function minutesSince(iso: string | null | undefined) {
  if (!iso) return 0;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
}
function minutesUntil(iso: string | null | undefined) {
  if (!iso) return 0;
  return Math.round((new Date(iso).getTime() - Date.now()) / 60_000);
}
function formatClock(date: Date) {
  return new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(date);
}

/** Minutes to a human-friendly duration.  <60m → "Xm"; ≥60m → "Xh Ym" or "Xh". */
function formatDur(mins: number) {
  const m = Math.max(0, Math.round(mins));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h}h` : `${h}h ${rem}m`;
}
function isSameDate(a: string, b: Date) {
  const d = new Date(a);
  return (
    d.getUTCFullYear() === b.getUTCFullYear() &&
    d.getUTCMonth() === b.getUTCMonth() &&
    d.getUTCDate() === b.getUTCDate()
  );
}
function langLabel(code?: string | null) {
  const c = (code ?? "en").toLowerCase();
  return (
    {
      en: "EN",
      hi: "Hindi",
      ta: "Tamil",
      te: "Telugu",
      kn: "Kannada",
      ml: "Malayalam"
    }[c] ?? c.toUpperCase()
  );
}
function genderGlyph(g?: "male" | "female" | "other" | null) {
  if (g === "male") return "M";
  if (g === "female") return "F";
  if (g === "other") return "•";
  return null;
}
async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
function useDebounced<T>(value: T, ms: number) {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setD(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return d;
}

/**
 * Physics-based smooth scroll: every wheel delta adds to a velocity reservoir,
 * which decays each frame. Feels like an iPhone flick — push it, let it coast,
 * it glides to a stop with a visible deceleration curve (the "wavy" feel).
 */
function useSmoothScroll(ref: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let velocity = 0;
    let rafId: number | null = null;
    // Kinematics: total_distance = v₀² / (2·FRICTION), time = v₀ / FRICTION.
    // For a single 100 px wheel notch at multiplier 0.04, v₀ = 4 px/frame:
    //   - time to rest:  4 / 0.06  = 67 frames ≈ 1.1 s
    //   - total travel:  4² / 0.12 = 133 px  (about 3 rows)
    //   - last 300 ms:   velocity 1.2 → 0 — you actually SEE it slowing
    // Low initial velocity + low friction = long, readable glide.
    const WHEEL_MULTIPLIER = 0.04;
    const FRICTION = 0.06;
    const MAX_VELOCITY = 18;

    function step() {
      if (!el || velocity === 0) {
        rafId = null;
        return;
      }
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      const next = Math.max(0, Math.min(max, el.scrollTop + velocity));
      // Clamp at edges — velocity dies cleanly against the boundary.
      if (next === 0 || next === max) {
        el.scrollTop = next;
        velocity = 0;
        rafId = null;
        return;
      }
      el.scrollTop = next;

      // Linear friction — constant deceleration, not exponential.
      // Viewer sees velocity visibly decrease all the way to 0.
      const dir = Math.sign(velocity);
      const nextVelocity = velocity - dir * FRICTION;
      // If we'd cross zero, snap to zero so we don't oscillate.
      velocity = Math.sign(nextVelocity) === dir ? nextVelocity : 0;

      if (velocity !== 0) {
        rafId = window.requestAnimationFrame(step);
      } else {
        rafId = null;
      }
    }

    function onWheel(e: WheelEvent) {
      if (!el) return;
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      velocity += e.deltaY * WHEEL_MULTIPLIER;
      // clamp so a fast trackpad flick can't run away
      if (velocity > MAX_VELOCITY) velocity = MAX_VELOCITY;
      else if (velocity < -MAX_VELOCITY) velocity = -MAX_VELOCITY;
      if (rafId === null) rafId = window.requestAnimationFrame(step);
    }

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, [ref]);
}

/* ---------- Component ---------- */

export function NowConsole({
  doctors,
  clinic,
  actorRole,
  userLabel
}: {
  doctors: Doctor[];
  clinic: Clinic | null;
  actorRole: AppRole;
  userLabel: string;
}) {
  const [doctorId, setDoctorId] = useState<string>(doctors[0]?.id ?? "");
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [summary, setSummary] = useState<QueueSummary>({
    total: 0,
    waiting: 0,
    serving: 0,
    complete: 0,
    skipped: 0,
    steppedOut: 0
  });
  const [activePause, setActivePause] = useState<QueuePause | null>(null);
  const [clinicPauses, setClinicPauses] = useState<
    Record<string, { reason: string; ends_at: string; note: string | null }>
  >({});
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [lastPulse, setLastPulse] = useState<Date>(new Date());
  const [clock, setClock] = useState<Date>(new Date());
  const [copilot, setCopilot] = useState("");
  const [journeysOpen, setJourneysOpen] = useState(false);
  const [holdTarget, setHoldTarget] = useState<QueueItem | null>(null);
  const [pauseOpen, setPauseOpen] = useState(false);
  const [laneView, setLaneView] = useState<TokenStatus | null>(null);
  const [patientDetail, setPatientDetail] = useState<PatientHit | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const switcherBtnRef = useRef<HTMLButtonElement | null>(null);
  const copilotRef = useRef<HTMLInputElement | null>(null);

  const selectedDoctor = useMemo(
    () => doctors.find((d) => d.id === doctorId) ?? doctors[0] ?? null,
    [doctorId, doctors]
  );
  const doctorName = selectedDoctor?.name ?? "Doctor";
  const doctorSpecialty = selectedDoctor?.specialty ?? null;
  const doctorRoom = selectedDoctor?.room ?? null;

  const refresh = useCallback(async () => {
    if (!doctorId) return;
    const res = await fetch(`/api/queue/status?doctorId=${doctorId}`, { cache: "no-store" });
    const body = await readJson<{
      queue?: QueueItem[];
      summary?: QueueSummary;
      queuePause?: QueuePause | null;
      clinicPauses?: Record<
        string,
        { reason: string; ends_at: string; note: string | null }
      >;
      error?: string;
    }>(res);
    if (!res.ok || !body?.queue || !body.summary) {
      setError(body?.error ?? "Could not load queue.");
      return;
    }
    setError(null);
    setQueue(body.queue);
    setSummary(body.summary);
    setActivePause(body.queuePause ?? null);
    setClinicPauses(body.clinicPauses ?? {});
    setLastPulse(new Date());
  }, [doctorId]);

  useEffect(() => {
    void refresh();
    const i = window.setInterval(() => void refresh(), 3000);
    const onDemand = () => void refresh();
    window.addEventListener("qcare:queue-refresh", onDemand);
    return () => {
      window.clearInterval(i);
      window.removeEventListener("qcare:queue-refresh", onDemand);
    };
  }, [refresh]);

  useEffect(() => {
    const i = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(i);
  }, []);

  const currentServing = useMemo(
    () => queue.find((q) => q.status === "serving") ?? null,
    [queue]
  );
  const waitingList = useMemo(() => queue.filter((q) => q.status === "waiting"), [queue]);
  const heldList = useMemo(() => queue.filter((q) => q.status === "stepped_out"), [queue]);
  const nextWaiting = waitingList[0] ?? null;
  const upcomingAfterNext = waitingList.slice(1, 4);

  async function runAction(
    action:
      | "start_consultation"
      | "mark_consultation_done"
      | "skip"
      | "hold_slot"
      | "return_to_waiting",
    tokenId: string,
    doctorOverride?: string,
    extra?: { holdMinutes?: number; holdNote?: string }
  ) {
    const targetDoctor = doctorOverride ?? doctorId;
    if (!targetDoctor) return;
    setIsWorking(true);
    const res = await fetch("/api/queue/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, tokenId, doctorId: targetDoctor, ...extra })
    });
    const body = await readJson<{ error?: string }>(res);
    setIsWorking(false);
    if (!res.ok) {
      setError(body?.error ?? "Action failed.");
      return;
    }
    setError(null);
    await refresh();
  }

  const needsYou = useMemo<NeedsYouItem[]>(() => {
    const items: NeedsYouItem[] = [];

    // Priority order (top → bottom):
    //   1. Queue paused for this doctor
    //   2. Patients held while mid-consultation (continuity matters)
    //   3. Safety red flags on waiting patients
    //   4. SMS-delivery failures for QR patients
    //   5. Routine holds — expired first, then active

    // 1 · Queue paused
    if (activePause) {
      items.push({
        id: `pause-${activePause.id}`,
        severity: "amber",
        title: `Queue paused for ${doctorName}`,
        detail: `Ends ${formatClock(new Date(activePause.ends_at))}${
          activePause.note ? ` · ${activePause.note}` : ""
        }`,
        primary: {
          label: "Resume now",
          run: () => resumeQueueNow()
        }
      });
    }

    // Split holds by origin: those interrupted mid-consult need the most attention.
    // Source of truth is token_event_log (exposed as held_from_state by the API).
    const heldMidConsult = heldList.filter((t) => t.held_from_state === "serving");
    const heldFromWaiting = heldList.filter((t) => t.held_from_state !== "serving");

    // 2 · Held mid-consult — primary action is to RESUME with the doctor,
    //     secondary is return-to-waiting, since that's the usual call once the
    //     doctor is back from break or the patient returns from stepping out.
    heldMidConsult.forEach((t) => {
      const mins = minutesUntil(t.hold_until);
      const expired = mins <= 0;
      const name = t.patients?.name ?? "Patient";
      items.push({
        id: `held-${t.id}`,
        severity: "amber",
        title: `Held mid-consult — #${t.token_number} ${name}`,
        detail: expired
          ? `Hold expired${t.hold_note ? ` · ${t.hold_note}` : ""}`
          : `${formatDur(mins)} left${t.hold_note ? ` · ${t.hold_note}` : ""}`,
        primary: {
          label: "Resume consultation",
          run: () => resumeConsultation(t.id)
        },
        secondary: {
          label: "Return to waiting",
          run: () => runAction("return_to_waiting", t.id)
        }
      });
    });

    // 3 · Safety red flags — only for waiting patients who haven't been seen yet.
    //     Once a patient has entered 'serving' at least once, the doctor has
    //     acknowledged the complaint, so the warning no longer earns its place.
    queue.forEach((t) => {
      if (t.status !== "waiting") return;
      if (t.seen_by_doctor) return;
      const c = t.raw_complaint ?? "";
      if (c && RED_FLAG_RE.test(c)) {
        items.push({
          id: `red-${t.id}`,
          severity: "red",
          title: `Possible red flag — #${t.token_number} ${t.patients?.name ?? "Patient"}`,
          detail: `"${c.slice(0, 100)}" — move ahead of queue?`,
          primary: {
            label: "Start now",
            run: () => runAction("start_consultation", t.id)
          }
        });
      }
    });

    // 4 · SMS delivery failures
    queue.forEach((t) => {
      if (t.status !== "waiting") return;
      if (t.checkin_channel !== "qr") return;
      if (t.sms?.checkin_confirm === "failed") {
        items.push({
          id: `sms-failed-${t.id}`,
          severity: "amber",
          title: `SMS failed — #${t.token_number} ${t.patients?.name ?? "Patient"}`,
          detail: `QR patient; check-in confirmation didn't deliver. Call ${
            t.patients?.phone ?? "them"
          }?`,
          primary: t.patients?.phone
            ? {
                label: "Call",
                run: () => {
                  window.location.href = `tel:${t.patients?.phone}`;
                }
              }
            : undefined
        });
      }
    });

    // 5 · Routine holds from waiting — expired first, then active
    const heldExpired = heldFromWaiting.filter(
      (t) => minutesUntil(t.hold_until) <= 0
    );
    const heldActive = heldFromWaiting.filter(
      (t) => minutesUntil(t.hold_until) > 0
    );

    heldExpired.forEach((t) => {
      const name = t.patients?.name ?? "Patient";
      items.push({
        id: `held-${t.id}`,
        severity: "amber",
        title: `Hold expired — #${t.token_number} ${name}`,
        detail: t.hold_note ? `Note: ${t.hold_note}` : "Hold window ended.",
        primary: { label: "Skip", run: () => runAction("skip", t.id) },
        secondary: {
          label: "Return to waiting",
          run: () => runAction("return_to_waiting", t.id)
        }
      });
    });

    heldActive.forEach((t) => {
      const mins = minutesUntil(t.hold_until);
      const name = t.patients?.name ?? "Patient";
      items.push({
        id: `held-${t.id}`,
        severity: "info",
        title: `On hold — #${t.token_number} ${name}`,
        detail: `${formatDur(mins)} left${t.hold_note ? ` · ${t.hold_note}` : ""}`,
        primary: {
          label: "Return to waiting",
          run: () => runAction("return_to_waiting", t.id)
        },
        secondary: { label: "Skip", run: () => runAction("skip", t.id) }
      });
    });

    return items.filter((i) => !dismissed.has(i.id));
  }, [queue, heldList, activePause, dismissed, doctorName]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setJourneysOpen((o) => !o);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        if (activePause) void resumeQueueNow();
        else setPauseOpen(true);
        return;
      }
      if (e.key === "Escape") {
        if (journeysOpen) setJourneysOpen(false);
        if (switcherOpen) setSwitcherOpen(false);
        if (patientDetail) setPatientDetail(null);
        if (pauseOpen) setPauseOpen(false);
        return;
      }
      if (inField) return;

      if (e.key === "/") {
        e.preventDefault();
        copilotRef.current?.focus();
        return;
      }
      if (e.key.toLowerCase() === "n" && nextWaiting && !currentServing) {
        e.preventDefault();
        void runAction("start_consultation", nextWaiting.id);
      }
      if (e.key.toLowerCase() === "d" && currentServing) {
        e.preventDefault();
        void runAction("mark_consultation_done", currentServing.id);
      }
      if (e.key.toLowerCase() === "s" && currentServing) {
        e.preventDefault();
        void runAction("skip", currentServing.id);
      }
      if (e.key.toLowerCase() === "h" && currentServing) {
        e.preventDefault();
        setHoldTarget(currentServing);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [journeysOpen, switcherOpen, patientDetail, pauseOpen, activePause, nextWaiting, currentServing]);

  /**
   * Resume a patient who was held mid-consultation: return to waiting, then
   * immediately start their consultation so they go straight back to the doctor.
   * If another patient is already serving, the start step fails and the token
   * stays in the waiting queue.
   */
  async function resumeConsultation(tokenId: string) {
    if (!doctorId) return;
    setIsWorking(true);
    const r1 = await fetch("/api/queue/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "return_to_waiting", tokenId, doctorId })
    });
    if (!r1.ok) {
      const b1 = await readJson<{ error?: string }>(r1);
      setIsWorking(false);
      setError(b1?.error ?? "Could not resume.");
      return;
    }
    const r2 = await fetch("/api/queue/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start_consultation", tokenId, doctorId })
    });
    const b2 = await readJson<{ error?: string }>(r2);
    setIsWorking(false);
    if (!r2.ok) {
      setError(
        b2?.error ??
          "Couldn't resume — another patient is currently with the doctor. Finish them first."
      );
      await refresh();
      return;
    }
    setError(null);
    await refresh();
  }

  async function resumeQueueNow() {
    if (!doctorId) return;
    setIsWorking(true);
    const res = await fetch("/api/queue/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume", doctorId })
    });
    const body = await readJson<{ error?: string }>(res);
    setIsWorking(false);
    if (!res.ok) {
      setError(body?.error ?? "Resume failed.");
      return;
    }
    setError(null);
    await refresh();
  }

  async function pauseQueueWith(opts: {
    minutes: number;
    reason: "personal_emergency" | "medical_emergency" | "other";
    note: string;
  }) {
    if (!doctorId) return;
    setIsWorking(true);
    const res = await fetch("/api/queue/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "pause",
        doctorId,
        pauseMinutes: opts.minutes,
        reason: opts.reason,
        note: opts.note
      })
    });
    const body = await readJson<{ error?: string }>(res);
    setIsWorking(false);
    if (!res.ok) {
      setError(body?.error ?? "Pause failed.");
      return;
    }
    setError(null);
    await refresh();
  }

  async function runCheckout(tokenId: string, stage: CheckoutStage) {
    setIsWorking(true);
    const res = await fetch("/api/checkout/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenId, action: stage })
    });
    const body = await readJson<{ error?: string }>(res);
    setIsWorking(false);
    if (!res.ok) {
      setError(body?.error ?? "Checkout update failed.");
      return;
    }
    setError(null);
    await refresh();
  }

  if (!doctors.length) {
    return (
      <section className="relative flex min-h-[100dvh] items-center justify-center bg-[#FBFBFD] px-6 py-10">
        <div className="max-w-md rounded-[44px] border border-white bg-white/95 p-8 text-center shadow-[0_25px_50px_-12px_rgba(0,0,0,0.08)] backdrop-blur-xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#4F46E5]">
            Reception
          </p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-[-0.04em] text-[#0B1840]">
            No active doctors
          </h1>
          <p className="mt-3 text-sm font-medium text-[#6A7283]">
            Add a doctor in admin onboarding first, then return here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="relative flex h-[100dvh] flex-col overflow-hidden bg-[#FBFBFD] px-5 pb-8 pt-5 sm:px-8">
      <div className="pointer-events-none absolute right-[-20%] top-[-24%] -z-0 h-[860px] w-[860px] rounded-full bg-[radial-gradient(circle,rgba(99,102,241,0.14)_0%,rgba(255,255,255,0.98)_70%)]" />
      <div className="pointer-events-none absolute left-[-14%] bottom-[-10%] -z-0 h-[720px] w-[720px] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.08)_0%,rgba(255,255,255,0)_70%)]" />

      <div className="relative z-10 mx-auto flex min-h-0 w-full max-w-[1440px] flex-1 flex-col">
        {/* Hero */}
        <header
          className={cn(
            "mb-5 rounded-[40px] border bg-white/90 px-6 py-4 backdrop-blur-xl transition-all",
            activePause
              ? "border-[#FDE68A] ring-1 ring-[#FDE68A]/50 shadow-[0_25px_50px_-14px_rgba(245,158,11,0.28)]"
              : "border-white shadow-[0_25px_50px_-12px_rgba(0,0,0,0.08)]"
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-6">
            <div className="min-w-[280px]">
              {activePause ? (
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#B45309]">
                  <PauseCircle className="mr-1 -mt-0.5 inline-block h-3 w-3" />
                  Reception · Paused ·{" "}
                  {formatDur(Math.max(0, minutesUntil(activePause.ends_at)))} left
                </p>
              ) : (
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#4F46E5]">
                  Reception · Cockpit
                </p>
              )}
              <button
                aria-expanded={switcherOpen}
                aria-haspopup="listbox"
                className="group inline-flex items-center gap-1.5 rounded-xl text-left transition hover:text-[#4F46E5]"
                onClick={() => setSwitcherOpen((o) => !o)}
                ref={switcherBtnRef}
                type="button"
              >
                <span className="text-[1.9rem] font-extrabold leading-[1] tracking-[-0.04em] text-[#0B1840]">
                  {doctorName}
                </span>
                <ChevronDown
                  className={cn(
                    "h-5 w-5 text-[#8B97AD] transition-transform",
                    switcherOpen && "rotate-180 text-[#4F46E5]"
                  )}
                />
              </button>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs font-semibold text-[#6A7283]">
                <span>{doctorSpecialty ?? "General"}</span>
                {doctorRoom ? <span className="text-[#8B97AD]">· {doctorRoom}</span> : null}
                <span className="text-[#8B97AD]">· {formatClock(clock)}</span>
                <span className="inline-flex items-center gap-1 text-[#8B97AD]">
                  ·
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      Date.now() - lastPulse.getTime() < 6000
                        ? "qcare-breathe bg-[#10B981]"
                        : "bg-[#F59E0B]"
                    )}
                  />
                  <span className="text-[10px] font-bold uppercase tracking-[0.14em]">
                    Live
                  </span>
                </span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <MetricPill
                label="Waiting"
                value={summary.waiting}
                color="#4F46E5"
                tint="#EEF2FF"
                onClick={() => setLaneView("waiting")}
              />
              <MetricPill
                label="With Dr."
                value={summary.serving}
                color="#047857"
                tint="#F0FDF4"
                onClick={() => setLaneView("serving")}
              />
              <MetricPill
                label="Done"
                value={summary.complete}
                color="#1D4ED8"
                tint="#F3F7FF"
                onClick={() => setLaneView("complete")}
              />
              <MetricPill
                label="Hold"
                value={summary.steppedOut}
                color="#6D28D9"
                tint="#FAF5FF"
                onClick={() => setLaneView("stepped_out")}
              />
              <MetricPill
                label="Skipped"
                value={summary.skipped}
                color="#B45309"
                tint="#FFFBEB"
                onClick={() => setLaneView("skipped")}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-col items-stretch gap-1.5">
                <button
                  className="rounded-full border border-[#E0E7FF] bg-[linear-gradient(135deg,#EEF2FF_0%,#F8FAFF_100%)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#4F46E5] shadow-[0_8px_18px_-14px_rgba(79,70,229,0.55)] transition hover:-translate-y-[1px]"
                  onClick={() => setJourneysOpen(true)}
                  type="button"
                >
                  ⌘K · Journeys
                </button>
                {activePause ? (
                  <button
                    className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[#BBF7D0] bg-[linear-gradient(135deg,#DCFCE7_0%,#F0FDF4_100%)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#047857] shadow-[0_8px_18px_-14px_rgba(16,185,129,0.45)] transition hover:-translate-y-[1px] disabled:opacity-50"
                    disabled={isWorking}
                    onClick={() => void resumeQueueNow()}
                    type="button"
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    ⌘P · Resume
                  </button>
                ) : (
                  <button
                    className="inline-flex items-center justify-center gap-1.5 rounded-full border border-[#FDE68A] bg-[linear-gradient(135deg,#FFFBEB_0%,#FEF3C7_100%)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B45309] shadow-[0_8px_18px_-14px_rgba(245,158,11,0.45)] transition hover:-translate-y-[1px] disabled:opacity-50"
                    disabled={isWorking}
                    onClick={() => setPauseOpen(true)}
                    type="button"
                  >
                    <PauseCircle className="h-3.5 w-3.5" />
                    ⌘P · Pause
                  </button>
                )}
              </div>
            </div>
          </div>
        </header>

        {error ? (
          <div className="mb-5 rounded-[24px] border border-[#FECACA] bg-[#FFF1F2] px-5 py-3 text-sm font-semibold text-[#B91C1C] shadow-[0_12px_30px_-22px_rgba(185,28,28,0.45)]">
            {error}
          </div>
        ) : null}


        <div className="grid min-h-0 flex-1 auto-rows-fr gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <WithDoctorCard
            token={currentServing}
            isWorking={isWorking}
            onDone={(id) => runAction("mark_consultation_done", id)}
            onHold={() => currentServing && setHoldTarget(currentServing)}
            onSkip={(id) => runAction("skip", id)}
            onOpenProfile={(pid) => {
              // open via the same path as co-pilot search — search by phone & open detail
              void (async () => {
                const res = await fetch(
                  `/api/patients/search?q=${encodeURIComponent(currentServing?.patients?.phone ?? "")}`,
                  { cache: "no-store" }
                );
                const body = await readJson<{ results?: PatientHit[] }>(res);
                const hit = (body?.results ?? []).find((r) => r.id === pid);
                if (hit) setPatientDetail(hit);
              })();
            }}
          />
          <NextCard
            token={nextWaiting}
            clinicName={clinic?.name ?? "the clinic"}
            upcoming={upcomingAfterNext}
            isWorking={isWorking || Boolean(currentServing)}
            behind={Math.max(0, waitingList.length - 1)}
            onStart={(id) => runAction("start_consultation", id)}
            onOpenProfile={(pid) => {
              void (async () => {
                const res = await fetch(
                  `/api/patients/search?q=${encodeURIComponent(nextWaiting?.patients?.phone ?? "")}`,
                  { cache: "no-store" }
                );
                const body = await readJson<{ results?: PatientHit[] }>(res);
                const hit = (body?.results ?? []).find((r) => r.id === pid);
                if (hit) setPatientDetail(hit);
              })();
            }}
          />
          <NeedsYouCard
            items={needsYou}
            isWorking={isWorking}
            onDismiss={(id) => setDismissed((d) => new Set(d).add(id))}
          />
        </div>

        {/* Co-pilot is the natural bottom of the page — not floating */}
        <div className="mt-6">
          <CoPilotBar
            inputRef={copilotRef}
            value={copilot}
            onChange={setCopilot}
            onSubmitPhone={(phone) => {
              if (clinic)
                window.location.href = `/checkin/${clinic.id}?phone=${encodeURIComponent(phone)}`;
            }}
            onSubmitNewPatient={() => {
              if (clinic) window.location.href = `/checkin/${clinic.id}`;
            }}
            onPickPatient={(hit) => setPatientDetail(hit)}
            onAnswerAction={(action) => {
              if (action.kind === "checkin" && clinic) {
                window.location.href = `/checkin/${clinic.id}`;
                return;
              }
              if (action.href) window.location.href = action.href;
            }}
          />
        </div>

        <p className="mt-4 text-center text-[10px] font-bold uppercase tracking-[0.18em] text-[#95A0B5]">
          Signed in as {userLabel} · role {actorRole} · Last sync {formatClock(lastPulse)}
        </p>
      </div>

      {/* Popovers rendered via portal so they escape overflow:hidden */}
      <PortalPopover
        anchorRef={switcherBtnRef}
        open={switcherOpen}
        onDismiss={() => setSwitcherOpen(false)}
      >
        <div className="w-80 rounded-2xl border border-white bg-white/98 p-1.5 shadow-[0_30px_60px_-24px_rgba(15,23,42,0.35)] backdrop-blur-xl">
          {doctors.map((d) => {
            const active = d.id === doctorId;
            const pause = clinicPauses[d.id];
            const minsLeft = pause
              ? Math.max(0, minutesUntil(pause.ends_at))
              : 0;
            return (
              <button
                aria-selected={active}
                className={cn(
                  "flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition",
                  active
                    ? "bg-[#EEF2FF]"
                    : pause
                      ? "hover:bg-[#FFFBEB]"
                      : "hover:bg-[#F5F7FB]"
                )}
                key={d.id}
                onClick={() => {
                  setDoctorId(d.id);
                  setSwitcherOpen(false);
                }}
                role="option"
                type="button"
              >
                <div className="min-w-0">
                  <p
                    className={cn(
                      "truncate text-sm font-bold",
                      active ? "text-[#4F46E5]" : "text-[#0B1840]"
                    )}
                  >
                    {d.name}
                  </p>
                  <p className="truncate text-[11px] font-medium text-[#6A7283]">
                    {d.specialty ?? "General"}
                    {d.room ? ` · ${d.room}` : ""}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {pause ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[#FDE68A] bg-[#FFFBEB] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#B45309]">
                      <PauseCircle className="h-3 w-3" />
                      Paused · {formatDur(minsLeft)}
                    </span>
                  ) : null}
                  {active ? (
                    <CheckCircle2 className="h-4 w-4 text-[#4F46E5]" />
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </PortalPopover>

      {journeysOpen ? (
        <ConsultationJourneysModal
          doctorName={doctorName}
          doctorSpecialty={doctorSpecialty}
          queue={queue}
          activePause={activePause}
          isWorking={isWorking}
          onClose={() => setJourneysOpen(false)}
          onCheckout={runCheckout}
        />
      ) : null}

      {patientDetail ? (
        <PatientDetailModal
          actorDoctorId={doctorId}
          hit={patientDetail}
          onClose={() => setPatientDetail(null)}
          onCheckIn={() => {
            if (clinic) {
              window.location.href = `/checkin/${clinic.id}?phone=${encodeURIComponent(
                patientDetail.phone
              )}`;
            }
          }}
          onAction={async (action, tokenId, doctorOverride) => {
            await runAction(action, tokenId, doctorOverride);
            setPatientDetail(null);
          }}
        />
      ) : null}

      {holdTarget ? (
        <HoldDialog
          token={holdTarget}
          isWorking={isWorking}
          onClose={() => setHoldTarget(null)}
          onSubmit={async ({ minutes, note }) => {
            await runAction("hold_slot", holdTarget.id, undefined, {
              holdMinutes: minutes,
              holdNote: note
            });
            setHoldTarget(null);
          }}
        />
      ) : null}

      {pauseOpen ? (
        <PauseDialog
          doctorName={doctorName}
          isWorking={isWorking}
          onClose={() => setPauseOpen(false)}
          onSubmit={async ({ minutes, reason, note }) => {
            await pauseQueueWith({ minutes, reason, note });
            setPauseOpen(false);
          }}
        />
      ) : null}

      {laneView ? (
        <LaneModal
          doctorName={doctorName}
          isWorking={isWorking}
          items={queue.filter((q) => q.status === laneView)}
          hasServing={Boolean(currentServing)}
          onClose={() => setLaneView(null)}
          onQueueAction={(action, tokenId, extra) =>
            runAction(action, tokenId, undefined, extra)
          }
          onHold={(t) => {
            setLaneView(null);
            setHoldTarget(t);
          }}
          status={laneView}
        />
      ) : null}
    </section>
  );
}

/* ---------- Portal helpers ---------- */

function PortalPopover({
  anchorRef,
  open,
  onDismiss,
  children
}: {
  anchorRef: React.RefObject<HTMLElement | null>;
  open: boolean;
  onDismiss: () => void;
  children: React.ReactNode;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function measure() {
      const r = anchorRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 8, left: r.left });
    }
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onDismiss();
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open, onDismiss, anchorRef]);

  if (!open || !pos || typeof document === "undefined") return null;
  return createPortal(
    <div
      className="fixed z-[60]"
      ref={ref}
      style={{ top: pos.top, left: pos.left }}
    >
      {children}
    </div>,
    document.body
  );
}

/* ---------- Co-pilot bar + expanded ---------- */

type CoPilotAnswer = {
  answer: string;
  intent?: string;
  patient: PatientHit | null;
  actions: Array<{ label: string; href?: string; kind: "link" | "call" | "checkin" }>;
};

function looksLikeQuestion(q: string): boolean {
  if (q.trim().endsWith("?")) return true;
  return /^\s*(is|are|was|were|does|do|did|has|have|had|can|could|will|who|what|whats|what's|which|when|where|why|how)\b/i.test(
    q
  );
}

function CoPilotBar({
  inputRef,
  value,
  onChange,
  onSubmitPhone,
  onSubmitNewPatient,
  onPickPatient,
  onAnswerAction
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  onSubmitPhone: (phone: string) => void;
  onSubmitNewPatient: () => void;
  onPickPatient: (hit: PatientHit) => void;
  onAnswerAction: (action: { label: string; href?: string; kind: "link" | "call" | "checkin" }) => void;
}) {
  const [openResults, setOpenResults] = useState(false);
  const [answer, setAnswer] = useState<CoPilotAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const { results, loading } = usePatientSearch(value);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (value.trim().length === 0) {
      setOpenResults(false);
      setAnswer(null);
      return;
    }
    if (!looksLikeQuestion(value)) {
      setOpenResults(value.trim().length >= 2);
    } else {
      setOpenResults(false);
    }
  }, [value]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpenResults(false);
        setAnswer(null);
      }
    }
    if (openResults || answer) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [openResults, answer]);

  async function askQuestion(q: string) {
    setAsking(true);
    const res = await fetch("/api/copilot/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q })
    });
    const body = await readJson<CoPilotAnswer>(res);
    setAsking(false);
    setAnswer(
      body ?? {
        answer: "Sorry — something went wrong asking the co-pilot.",
        patient: null,
        actions: []
      }
    );
  }

  return (
    <div className="relative" ref={wrapperRef}>
        {answer ? (
          <CoPilotAnswerCard
            answer={answer}
            onClose={() => setAnswer(null)}
            onPickPatient={(hit) => {
              setAnswer(null);
              onPickPatient(hit);
            }}
            onAction={(action) => {
              setAnswer(null);
              onAnswerAction(action);
            }}
          />
        ) : openResults ? (
          <CoPilotResultsList
            loading={loading}
            results={results}
            onPick={(hit) => {
              setOpenResults(false);
              onPickPatient(hit);
            }}
            onNewPatient={onSubmitNewPatient}
          />
        ) : null}
        <div className="flex flex-wrap items-center gap-3 rounded-[24px] border border-[#E0E7FF] bg-white/95 p-3 shadow-[0_24px_48px_-24px_rgba(79,70,229,0.35)] backdrop-blur-xl">
          <span className="flex h-9 items-center gap-1.5 rounded-full border border-[#E0E7FF] bg-[linear-gradient(135deg,#EEF2FF_0%,#F8FAFF_100%)] px-3 text-[10px] font-bold uppercase tracking-[0.18em] text-[#4F46E5]">
            <Sparkles className="h-3.5 w-3.5" />
            Co-pilot
          </span>
          <input
            className="h-11 flex-1 rounded-full border border-[#E2E8F0] bg-white px-4 text-sm font-medium text-[#0B1840] placeholder:text-[#94A3B8]"
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => {
              if (value.trim().length >= 2 && !looksLikeQuestion(value)) setOpenResults(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const q = value.trim();
                if (!q) return;
                if (looksLikeQuestion(q)) {
                  setOpenResults(false);
                  void askQuestion(q);
                  return;
                }
                const phone = q.replace(/[^\d+]/g, "");
                if (phone.length >= 7) onSubmitPhone(phone);
                else if (/^(new|add|walk)/i.test(q)) onSubmitNewPatient();
                else if (results.length === 1) onPickPatient(results[0]);
              }
              if (e.key === "Escape") {
                setOpenResults(false);
                setAnswer(null);
              }
            }}
            placeholder={`Ask: "Is Swaminathan a returning patient?" · or type a phone / name`}
            ref={inputRef}
            value={value}
          />
          {asking ? (
            <span className="text-[11px] font-semibold text-[#4F46E5]">Thinking…</span>
          ) : (
            <span className="hidden text-[11px] font-semibold text-[#8B97AD] md:inline">
              <Kbd>/</Kbd> focus · <Kbd>⌘K</Kbd> journeys
            </span>
          )}
        </div>
      </div>
  );
}

function CoPilotAnswerCard({
  answer,
  onClose,
  onPickPatient,
  onAction
}: {
  answer: CoPilotAnswer;
  onClose: () => void;
  onPickPatient: (hit: PatientHit) => void;
  onAction: (action: { label: string; href?: string; kind: "link" | "call" | "checkin" }) => void;
}) {
  const p = answer.patient;
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 rounded-[28px] border border-white bg-white/98 p-4 shadow-[0_30px_60px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <div className="mt-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-[linear-gradient(135deg,#EEF2FF_0%,#E0E7FF_100%)] text-[#4F46E5]">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#4F46E5]">
              Co-pilot
            </p>
            <p className="mt-0.5 text-sm font-bold leading-snug text-[#0B1840]">
              {answer.answer}
            </p>
          </div>
        </div>
        <button
          className="rounded-full p-1.5 text-[#8B97AD] hover:bg-[#F5F7FB] hover:text-[#0B1840]"
          onClick={onClose}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {p ? (
        <button
          className="mt-3 flex w-full items-center justify-between gap-2 rounded-2xl border border-[#E0E7FF] bg-[#F7F9FF] px-3 py-2 text-left transition hover:border-[#C7D2FE]"
          onClick={() => onPickPatient(p)}
          type="button"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-[#0B1840]">
              {p.name}
              <span className="ml-2 text-[11px] font-semibold text-[#8B97AD]">{p.phone}</span>
            </p>
            <p className="mt-0.5 text-[11px] font-medium text-[#6A7283]">
              {p.totalVisits} visit{p.totalVisits === 1 ? "" : "s"}
              {p.todayToken ? (
                <span className="ml-2 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#047857]">
                  Today · #{p.todayToken.token_number} · {p.todayToken.status}
                </span>
              ) : null}
            </p>
          </div>
          <ChevronDown className="h-4 w-4 -rotate-90 text-[#8B97AD]" />
        </button>
      ) : null}

      {answer.actions.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {answer.actions.map((a) => (
            <button
              className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#1A2550] transition hover:border-[#CBD5E1]"
              key={a.label}
              onClick={() => onAction(a)}
              type="button"
            >
              {a.kind === "call" ? <Phone className="h-3 w-3" /> : null}
              {a.kind === "checkin" ? <UserPlus className="h-3 w-3" /> : null}
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- Lane themes (shared between LaneModal and any lane surface) ---------- */

const LANE_THEME: Record<
  TokenStatus,
  {
    label: string;
    title: string;
    dot: string;
    chipBg: string;
    chipText: string;
    tintBorder: string;
    tintBg: string;
  }
> = {
  waiting: {
    label: "Waiting",
    title: "text-[#1E3A8A]",
    dot: "bg-[#4F46E5]",
    chipBg: "bg-[#EEF2FF]",
    chipText: "text-[#4F46E5]",
    tintBorder: "border-[#E0E7FF]",
    tintBg: "bg-[linear-gradient(145deg,#F7F9FF_0%,#FFFFFF_100%)]"
  },
  serving: {
    label: "With doctor",
    title: "text-[#047857]",
    dot: "bg-[#10B981]",
    chipBg: "bg-[#DCFCE7]",
    chipText: "text-[#047857]",
    tintBorder: "border-[#BBF7D0]",
    tintBg: "bg-[linear-gradient(145deg,#F0FDF4_0%,#FFFFFF_100%)]"
  },
  complete: {
    label: "Done",
    title: "text-[#1D4ED8]",
    dot: "bg-[#3B82F6]",
    chipBg: "bg-[#DBEAFE]",
    chipText: "text-[#1D4ED8]",
    tintBorder: "border-[#DBEAFE]",
    tintBg: "bg-[linear-gradient(145deg,#F3F7FF_0%,#FFFFFF_100%)]"
  },
  stepped_out: {
    label: "On hold",
    title: "text-[#6D28D9]",
    dot: "bg-[#8B5CF6]",
    chipBg: "bg-[#EDE9FE]",
    chipText: "text-[#6D28D9]",
    tintBorder: "border-[#DDD6FE]",
    tintBg: "bg-[linear-gradient(145deg,#F7F5FF_0%,#FFFFFF_100%)]"
  },
  skipped: {
    label: "Skipped",
    title: "text-[#B45309]",
    dot: "bg-[#F59E0B]",
    chipBg: "bg-[#FEF3C7]",
    chipText: "text-[#B45309]",
    tintBorder: "border-[#FDE68A]",
    tintBg: "bg-[linear-gradient(145deg,#FFFBEB_0%,#FFFFFF_100%)]"
  }
};

/* ---------- Consultation Journeys modal (post-consult only) ---------- */

const POST_LANES: Array<{
  stage: CheckoutStage;
  label: string;
  pane: string;
  border: string;
  chipBg: string;
  chipText: string;
}> = [
  {
    stage: "awaiting_payment",
    label: "Awaiting payment",
    pane: "bg-[#FFFBEB]",
    border: "border-[#FDE68A]",
    chipBg: "bg-[#FEF3C7]",
    chipText: "text-[#B45309]"
  },
  {
    stage: "payment_done",
    label: "Paid",
    pane: "bg-[#F3F7FF]",
    border: "border-[#DBEAFE]",
    chipBg: "bg-[#DBEAFE]",
    chipText: "text-[#1D4ED8]"
  },
  {
    stage: "pharmacy_pickup",
    label: "Pharmacy",
    pane: "bg-[#F0F9FF]",
    border: "border-[#BAE6FD]",
    chipBg: "bg-[#E0F2FE]",
    chipText: "text-[#0369A1]"
  },
  {
    stage: "referred_for_lab",
    label: "Lab",
    pane: "bg-[#F5F3FF]",
    border: "border-[#DDD6FE]",
    chipBg: "bg-[#EDE9FE]",
    chipText: "text-[#6D28D9]"
  },
  {
    stage: "visit_closed",
    label: "Closed",
    pane: "bg-[#F5F7FB]",
    border: "border-[#D7E1EF]",
    chipBg: "bg-[#E2E8F0]",
    chipText: "text-[#334155]"
  }
];

function ConsultationJourneysModal({
  doctorName,
  doctorSpecialty,
  queue,
  activePause,
  isWorking,
  onClose,
  onCheckout
}: {
  doctorName: string;
  doctorSpecialty: string | null;
  queue: QueueItem[];
  activePause: QueuePause | null;
  isWorking: boolean;
  onClose: () => void;
  onCheckout: (tokenId: string, stage: CheckoutStage) => void;
}) {
  const postScrollRef = useRef<HTMLUListElement | null>(null);
  useSmoothScroll(postScrollRef);

  const stageOrder: Record<CheckoutStage, number> = {
    awaiting_payment: 0,
    payment_done: 1,
    pharmacy_pickup: 2,
    referred_for_lab: 3,
    visit_closed: 99
  };

  const completed = queue.filter((t) => t.status === "complete");
  const open = completed
    .filter((t) => (t.checkout?.checkout_stage ?? "awaiting_payment") !== "visit_closed")
    .sort((a, b) => {
      const aStage = (a.checkout?.checkout_stage ?? "awaiting_payment") as CheckoutStage;
      const bStage = (b.checkout?.checkout_stage ?? "awaiting_payment") as CheckoutStage;
      const primary = stageOrder[aStage] - stageOrder[bStage];
      if (primary !== 0) return primary;
      // Within the same stage, earliest-completed first.
      return (
        new Date(a.completed_at ?? a.checked_in_at).getTime() -
        new Date(b.completed_at ?? b.checked_in_at).getTime()
      );
    });
  const closedToday = completed.filter(
    (t) => (t.checkout?.checkout_stage ?? "awaiting_payment") === "visit_closed"
  );

  const isPaused = Boolean(activePause);

  return (
    <ModalShell accent="indigo" maxWidth="max-w-[1280px]" onClose={onClose}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#4F46E5]">
            Consultation Journeys
          </p>
          <h2 className="mt-1.5 text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.035em] text-[#0B1840]">
            {doctorName}
            <span className="ml-2 text-sm font-semibold text-[#6A7283]">
              {doctorSpecialty ?? "General"}
            </span>
          </h2>
          <p className="mt-1.5 text-[12.5px] font-semibold text-[#5C667D]">
            Click a chip on a card to advance the patient through billing, pharmacy, lab, and close.
          </p>
        </div>
        <button
          aria-label="Close"
          className="rounded-full border border-[#E2E8F0] bg-white/80 p-2 text-[#8B97AD] transition hover:border-[#CBD5E1] hover:bg-white hover:text-[#0B1840]"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {isPaused && activePause ? (
        <div className="mt-5 rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-sm font-semibold text-[#B45309]">
          Queue is paused until {formatClock(new Date(activePause.ends_at))}
          {activePause.note ? ` · ${activePause.note}` : ""}.
        </div>
      ) : null}

      <section className="mt-6">
          <div className="mb-3 flex items-baseline justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#4F46E5]">
              Post-consult journey
            </h3>
            <p className="text-[11px] font-semibold text-[#8B97AD]">
              <span className="text-[#0B1840]">{open.length} open</span>
              <span className="mx-1 text-[#CBD5E1]">·</span>
              <span>{closedToday.length} closed today</span>
            </p>
          </div>

          {open.length === 0 ? (
            <div className="rounded-[22px] border border-[#E2E8F0] bg-white/80 px-5 py-10 text-center">
              <p className="text-sm font-bold text-[#0B1840]">
                No open post-consult patients.
              </p>
              <p className="mt-1 text-xs font-medium text-[#8B97AD]">
                Everybody who finished with {doctorName} today has been closed out.
              </p>
            </div>
          ) : (
            <ul
              className="qcare-scroll qcare-scroll-fade grid max-h-[52vh] gap-2 overflow-y-auto pr-1"
              ref={postScrollRef}
            >
              {open.map((t, idx) => (
                <PostConsultRow
                  animationIndex={Math.min(idx, 8)}
                  isWorking={isWorking}
                  key={t.id}
                  onCheckout={onCheckout}
                  token={t}
                />
              ))}
            </ul>
          )}

          {closedToday.length > 0 ? (
            <details className="mt-4 rounded-[20px] border border-[#E2E8F0] bg-white/70">
              <summary className="cursor-pointer list-none px-4 py-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#6A7283] transition hover:text-[#0B1840]">
                <span className="inline-flex items-center gap-1.5">
                  <ChevronDown className="h-3.5 w-3.5 transition group-open:rotate-180" />
                  Closed today · {closedToday.length}
                </span>
              </summary>
              <ul className="grid gap-1.5 border-t border-[#E2E8F0] px-3 py-3">
                {closedToday.map((t) => (
                  <li
                    className="flex items-center justify-between rounded-xl px-2 py-1.5 text-[12px]"
                    key={t.id}
                  >
                    <span className="truncate">
                      <span className="font-extrabold tabular-nums text-[#0B1840]">
                        #{t.token_number}
                      </span>
                      <span className="ml-2 font-semibold text-[#1A2550]">
                        {t.patients?.name ?? "Patient"}
                      </span>
                    </span>
                    <a
                      className="shrink-0 text-[10px] font-bold uppercase tracking-[0.12em] text-[#4F46E5] hover:underline"
                      href={`/track/${t.id}`}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Tracking ↗
                    </a>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
    </ModalShell>
  );
}

/**
 * One patient, one row, one obvious next action.
 * Stage-specific primary button + small secondary chips for alternate routes.
 */
function PostConsultRow({
  token,
  isWorking,
  onCheckout,
  animationIndex = 0
}: {
  token: QueueItem;
  isWorking: boolean;
  onCheckout: (tokenId: string, stage: CheckoutStage) => void;
  animationIndex?: number;
}) {
  const stage = (token.checkout?.checkout_stage ?? "awaiting_payment") as CheckoutStage;
  const chip = POST_LANES.find((c) => c.stage === stage)!;
  const sinceDone = minutesSince(token.completed_at ?? token.serving_started_at ?? token.checked_in_at);

  // Per-stage routing: primary action + optional secondary alternatives
  const routing: Record<
    CheckoutStage,
    { primary: { label: string; stage: CheckoutStage }; secondary?: Array<{ label: string; stage: CheckoutStage }> }
  > = {
    awaiting_payment: {
      primary: { label: "Mark paid", stage: "payment_done" },
      secondary: [{ label: "Close visit", stage: "visit_closed" }]
    },
    payment_done: {
      primary: { label: "Close visit", stage: "visit_closed" },
      secondary: [
        { label: "To pharmacy", stage: "pharmacy_pickup" },
        { label: "To lab", stage: "referred_for_lab" }
      ]
    },
    pharmacy_pickup: {
      primary: { label: "Close visit", stage: "visit_closed" },
      secondary: [{ label: "Still awaiting payment", stage: "awaiting_payment" }]
    },
    referred_for_lab: {
      primary: { label: "Close visit", stage: "visit_closed" },
      secondary: [{ label: "Back to payment", stage: "awaiting_payment" }]
    },
    visit_closed: {
      primary: { label: "Closed", stage: "visit_closed" }
    }
  };
  const plan = routing[stage];

  return (
    <li
      className="qcare-list-item-in flex flex-wrap items-center gap-3 rounded-2xl border border-[#E2E8F0] bg-white p-3 shadow-[0_8px_18px_-16px_rgba(11,24,64,0.22)] transition hover:shadow-[0_14px_26px_-18px_rgba(11,24,64,0.28)]"
      style={{ ["--i" as string]: animationIndex }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="text-[22px] font-extrabold leading-none tracking-[-0.02em] text-[#0B1840] tabular-nums">
            #{token.token_number}
          </span>
          <span className="truncate text-base font-bold text-[#1A2550]">
            {token.patients?.name ?? "Patient"}
          </span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]",
              chip.chipBg,
              chip.chipText
            )}
          >
            {chip.label}
          </span>
        </div>
        <p className="mt-1 text-[11px] font-semibold text-[#8B97AD]">
          {token.patients?.phone ? (
            <a
              className="inline-flex items-center gap-1 hover:text-[#4F46E5]"
              href={`sms:${token.patients.phone}`}
            >
              <MessageSquare className="h-3 w-3" />
              {token.patients.phone}
            </a>
          ) : (
            "No phone"
          )}
          <span className="mx-1 text-[#CBD5E1]">·</span>
          done {formatDur(sinceDone)} ago
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {plan.secondary?.map((opt) => (
          <button
            className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#1A2550] transition hover:border-[#CBD5E1] disabled:opacity-50"
            disabled={isWorking}
            key={opt.stage}
            onClick={() => onCheckout(token.id, opt.stage)}
            type="button"
          >
            {opt.label}
          </button>
        ))}
        <button
          className="inline-flex items-center gap-1 rounded-full bg-[linear-gradient(135deg,#6366F1_0%,#4F46E5_100%)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-white shadow-[0_10px_22px_-14px_rgba(79,70,229,0.7)] transition hover:-translate-y-[1px] disabled:opacity-50 disabled:hover:translate-y-0"
          disabled={isWorking}
          onClick={() => onCheckout(token.id, plan.primary.stage)}
          type="button"
        >
          {plan.primary.label}
        </button>
      </div>
    </li>
  );
}

function CoPilotResultsList({
  results,
  loading,
  onPick,
  onNewPatient
}: {
  results: PatientHit[];
  loading: boolean;
  onPick: (hit: PatientHit) => void;
  onNewPatient: () => void;
}) {
  return (
    <div className="absolute bottom-full left-0 right-0 mb-2 rounded-[24px] border border-white bg-white/98 p-1.5 shadow-[0_30px_60px_-20px_rgba(15,23,42,0.35)] backdrop-blur-xl">
      {loading ? (
        <p className="px-3 py-3 text-sm font-medium text-[#8B97AD]">Searching…</p>
      ) : results.length === 0 ? (
        <div className="flex items-center justify-between gap-2 px-3 py-2">
          <p className="text-sm font-medium text-[#8B97AD]">No patient found.</p>
          <button
            className="rounded-full bg-[linear-gradient(135deg,#6366F1_0%,#4F46E5_100%)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white"
            onClick={onNewPatient}
            type="button"
          >
            Check-in new
          </button>
        </div>
      ) : (
        <ul className="grid gap-1">
          {results.slice(0, 6).map((r) => (
            <li key={r.id}>
              <button
                className="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left hover:bg-[#F7F9FF]"
                onClick={() => onPick(r)}
                type="button"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-[#0B1840]">
                    {r.name}
                    <span className="ml-2 text-[11px] font-semibold text-[#8B97AD]">
                      {r.phone}
                    </span>
                  </p>
                  <p className="text-[11px] font-medium text-[#6A7283]">
                    {r.totalVisits} visit{r.totalVisits === 1 ? "" : "s"}
                    {r.todayToken ? (
                      <span className="ml-2 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#047857]">
                        Today #{r.todayToken.token_number} · {r.todayToken.status}
                      </span>
                    ) : null}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function usePatientSearch(query: string) {
  const debounced = useDebounced(query.trim(), 200);
  const [results, setResults] = useState<PatientHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (debounced.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      const res = await fetch(`/api/patients/search?q=${encodeURIComponent(debounced)}`, {
        cache: "no-store"
      });
      const body = await readJson<{ results?: PatientHit[] }>(res);
      if (!cancelled) {
        setResults(body?.results ?? []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return { results, loading };
}

/* ---------- Patient detail modal ---------- */

function PatientDetailModal({
  hit,
  actorDoctorId,
  onClose,
  onCheckIn,
  onAction
}: {
  hit: PatientHit;
  actorDoctorId: string;
  onClose: () => void;
  onCheckIn: () => void;
  onAction: (
    action:
      | "start_consultation"
      | "mark_consultation_done"
      | "skip"
      | "hold_slot"
      | "return_to_waiting",
    tokenId: string,
    doctorOverride?: string
  ) => void;
}) {
  const now = new Date();
  const isNew = hit.created_at ? isSameDate(hit.created_at, now) : false;
  const today = hit.todayToken;
  const sameDoctor = today?.doctor_id === actorDoctorId;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(11,24,64,0.45)] px-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-[32px] border border-white bg-white/98 p-6 shadow-[0_40px_80px_-30px_rgba(15,23,42,0.5)] backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#4F46E5]">
              Patient
            </p>
            <h2 className="mt-1 text-2xl font-extrabold leading-tight tracking-[-0.02em] text-[#0B1840]">
              {hit.name}
            </h2>
            <p className="mt-0.5 text-xs font-semibold text-[#6A7283]">
              <a
                className="inline-flex items-center gap-1 hover:text-[#4F46E5]"
                href={`tel:${hit.phone}`}
              >
                <Phone className="h-3 w-3" />
                {hit.phone}
              </a>
              {hit.age ? <span> · {hit.age}</span> : null}
              {hit.gender ? <span> · {genderGlyph(hit.gender)}</span> : null}
              {hit.language_preference && hit.language_preference !== "en" ? (
                <span> · {langLabel(hit.language_preference)}</span>
              ) : null}
            </p>
          </div>
          <button
            className="rounded-full p-1.5 text-[#8B97AD] hover:bg-[#F5F7FB] hover:text-[#0B1840]"
            onClick={onClose}
            type="button"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Fact label="Status" value={isNew ? "New patient" : "Returning"} />
          <Fact label="Total visits" value={`${hit.totalVisits}`} />
          <Fact
            label="First seen"
            value={
              hit.created_at
                ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
                    new Date(hit.created_at)
                  )
                : "—"
            }
          />
          <Fact
            label="Allergies"
            value={hit.allergies.length > 0 ? hit.allergies.join(", ") : "None recorded"}
            tone={hit.allergies.length > 0 ? "warn" : undefined}
          />
        </div>

        {today ? (
          <div className="mt-5 rounded-2xl border border-[#BBF7D0] bg-[#F0FDF4] p-4">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#047857]">
              Today
            </p>
            <p className="mt-1 text-base font-bold text-[#0B1840]">
              Token #{today.token_number}{" "}
              <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#047857]">
                {today.status}
              </span>
            </p>
            <p className="text-xs font-semibold text-[#5C667D]">
              with {today.doctor_name ?? "Doctor"}
              {!sameDoctor ? (
                <span className="ml-1 text-[#B45309]">· different doctor than selected</span>
              ) : null}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                className="inline-flex items-center rounded-full border border-[#E2E8F0] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#1A2550] hover:border-[#CBD5E1]"
                href={`/track/${today.id}`}
                target="_blank"
                rel="noreferrer"
              >
                View tracking
              </a>
              {sameDoctor && today.status === "waiting" ? (
                <button
                  className="rounded-full bg-[linear-gradient(135deg,#6366F1_0%,#4F46E5_100%)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white shadow-[0_8px_18px_-14px_rgba(79,70,229,0.7)]"
                  onClick={() => onAction("start_consultation", today.id)}
                  type="button"
                >
                  Start consultation
                </button>
              ) : null}
              {sameDoctor && today.status === "serving" ? (
                <button
                  className="rounded-full bg-[linear-gradient(135deg,#6366F1_0%,#4F46E5_100%)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white"
                  onClick={() => onAction("mark_consultation_done", today.id)}
                  type="button"
                >
                  Done
                </button>
              ) : null}
              {sameDoctor &&
              (today.status === "waiting" || today.status === "serving") ? (
                <button
                  className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#1A2550] hover:border-[#CBD5E1]"
                  onClick={() => onAction("skip", today.id)}
                  type="button"
                >
                  Skip
                </button>
              ) : null}
              {sameDoctor &&
              (today.status === "stepped_out" || today.status === "skipped") ? (
                <button
                  className="rounded-full border border-[#E2E8F0] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#1A2550] hover:border-[#CBD5E1]"
                  onClick={() => onAction("return_to_waiting", today.id)}
                  type="button"
                >
                  Return to waiting
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {!today ? (
          <div className="mt-5 flex items-center justify-between rounded-2xl border border-[#E0E7FF] bg-[#F7F9FF] p-4">
            <p className="text-sm font-semibold text-[#1A2550]">
              Not checked in today.
            </p>
            <button
              className="inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#6366F1_0%,#4F46E5_100%)] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_10px_22px_-14px_rgba(79,70,229,0.7)]"
              onClick={onCheckIn}
              type="button"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Check in now
            </button>
          </div>
        ) : null}

        {hit.lastToken ? (
          <div className="mt-5">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8B97AD]">
              Last visit
            </p>
            <div className="mt-1 rounded-2xl border border-[#E2E8F0] bg-white p-3">
              <p className="text-sm font-bold text-[#0B1840]">
                {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
                  new Date(hit.lastToken.date)
                )}{" "}
                · #{hit.lastToken.token_number} with{" "}
                {hit.lastToken.doctor_name ?? "Doctor"}
              </p>
              {hit.lastToken.raw_complaint ? (
                <p className="mt-1 text-xs font-medium text-[#5C667D]">
                  {hit.lastToken.raw_complaint}
                </p>
              ) : null}
              <a
                className="mt-2 inline-flex items-center rounded-full border border-[#E2E8F0] bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#1A2550] hover:border-[#CBD5E1]"
                href={`/track/${hit.lastToken.id}`}
                rel="noreferrer"
                target="_blank"
              >
                Open tracking
              </a>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  tone
}: {
  label: string;
  value: string;
  tone?: "warn";
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-3",
        tone === "warn" ? "border-[#FDE68A] bg-[#FFFBEB]" : "border-[#E2E8F0] bg-white"
      )}
    >
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8B97AD]">{label}</p>
      <p
        className={cn(
          "mt-0.5 text-sm font-bold",
          tone === "warn" ? "text-[#B45309]" : "text-[#0B1840]"
        )}
      >
        {value}
      </p>
    </div>
  );
}

/* ---------- Cards ---------- */

function MetricPill({
  label,
  value,
  color,
  tint,
  onClick
}: {
  label: string;
  value: number;
  color: string;
  tint: string;
  onClick?: () => void;
}) {
  return (
    <button
      className="group relative overflow-hidden rounded-2xl border px-5 py-2.5 text-center shadow-[0_14px_28px_-18px_rgba(11,24,64,0.28)] min-w-[96px] transition-all duration-200 ease-out hover:-translate-y-[2px] hover:shadow-[0_22px_40px_-14px_rgba(11,24,64,0.4)] focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30"
      disabled={!onClick}
      onClick={onClick}
      style={{
        background: `linear-gradient(150deg, ${tint} 0%, #FFFFFF 62%)`,
        borderColor: `${color}2B`
      }}
      type="button"
    >
      <ChevronRight
        aria-hidden
        className="absolute right-1.5 top-1.5 h-3 w-3 opacity-30 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-90"
        style={{ color }}
      />
      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#8B97AD] transition-colors duration-200 group-hover:text-[#5C667D]">
        {label}
      </p>
      <p
        className="mt-1 text-[28px] font-extrabold leading-none tracking-[-0.03em] tabular-nums transition-transform duration-200"
        style={{ color }}
      >
        {value}
      </p>
    </button>
  );
}

function estimateETAForNext(token: QueueItem | null): number | null {
  if (!token) return null;
  const elapsed = minutesSince(token.serving_started_at ?? token.checked_in_at);
  return Math.max(0, AVG_CONSULT_MIN - elapsed);
}

function PatientChip({
  tone,
  children
}: {
  tone: "lang" | "qr" | "walk" | "new" | "returning" | "flag";
  children: React.ReactNode;
}) {
  const map: Record<typeof tone, string> = {
    lang: "bg-[#EEF2FF] text-[#4F46E5]",
    qr: "bg-[#DBEAFE] text-[#1D4ED8]",
    walk: "bg-[#E2E8F0] text-[#334155]",
    new: "bg-[#E0F2FE] text-[#0369A1]",
    returning: "bg-[#EDE9FE] text-[#6D28D9]",
    flag: "bg-[#FEE2E2] text-[#B91C1C]"
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em]",
        map[tone]
      )}
    >
      {children}
    </span>
  );
}

function patientChips(t: QueueItem, now: Date) {
  const chips: React.ReactNode[] = [];
  const lang = langLabel(t.patients?.language_preference);
  if (lang && lang !== "EN") chips.push(<PatientChip key="lang" tone="lang">{lang}</PatientChip>);

  if (t.checkin_channel === "qr") {
    chips.push(<PatientChip key="qr" tone="qr">QR</PatientChip>);
  } else if (t.checkin_channel === "reception") {
    chips.push(<PatientChip key="walk" tone="walk">Walk-in</PatientChip>);
  }

  // SMS status no longer rendered as a chip — unreachable patients surface
  // via the red token-number treatment (tokenNeedsCall) + the Needs-you panel.

  const createdAt = t.patients?.created_at;
  if (createdAt) {
    const isNew = isSameDate(createdAt, now);
    chips.push(
      <PatientChip key="visit" tone={isNew ? "new" : "returning"}>
        {isNew ? "New" : "Returning"}
      </PatientChip>
    );
  }

  if (t.raw_complaint && RED_FLAG_RE.test(t.raw_complaint)) {
    chips.push(<PatientChip key="flag" tone="flag">Red flag</PatientChip>);
  }
  return chips;
}

/**
 * A waiting QR patient whose check-in SMS didn't deliver is effectively unreachable —
 * they likely walked away not knowing their token is active. Surface as a red token #.
 */
function tokenNeedsCall(t: QueueItem): boolean {
  if (t.status !== "waiting") return false;
  if (t.checkin_channel !== "qr") return false;
  const s = t.sms?.checkin_confirm;
  return s === "failed" || s === "undelivered";
}

function patientMeta(t: QueueItem) {
  const g = genderGlyph(t.patients?.gender);
  const age = t.patients?.age;
  const parts: string[] = [];
  if (g && age) parts.push(`${g} · ${age}`);
  else if (age) parts.push(`${age}`);
  else if (g) parts.push(g);
  return parts.join(" ");
}

/**
 * Compact contact row: SMS is the primary tap target (most patients prefer
 * SMS/WhatsApp), Call is a small secondary icon, meta sits after an em-dash.
 * Single flex line — no baseline breakage.
 */
function ContactLine({
  token,
  tone = "emerald"
}: {
  token: QueueItem;
  tone?: "emerald" | "indigo" | "sky" | "violet";
}) {
  const phone = token.patients?.phone ?? null;
  const meta = patientMeta(token);
  const hoverColor =
    tone === "emerald"
      ? "hover:text-[#047857]"
      : tone === "indigo"
        ? "hover:text-[#4F46E5]"
        : tone === "sky"
          ? "hover:text-[#0369A1]"
          : "hover:text-[#7E22CE]";
  return (
    <div className="mt-1.5 flex items-center gap-2 text-xs font-semibold text-[#5C667D]">
      {phone ? (
        <>
          <a
            className={cn("inline-flex items-center gap-1", hoverColor)}
            href={`sms:${phone}`}
            title="Send SMS"
          >
            <MessageSquare className="h-3 w-3 shrink-0" />
            <span>{phone}</span>
          </a>
          <a
            aria-label="Call"
            className={cn("text-[#8B97AD]", hoverColor)}
            href={`tel:${phone}`}
            title="Call"
          >
            <Phone className="h-3 w-3 shrink-0" />
          </a>
        </>
      ) : (
        <span className="text-[#94A3B8]">No phone</span>
      )}
      {meta ? <span className="text-[#8B97AD]">· {meta}</span> : null}
    </div>
  );
}

type PatientBrief = {
  patient: {
    id: string;
    name: string;
    phone: string;
    age: number | null;
    gender: "male" | "female" | "other" | null;
    language_preference: string | null;
    allergies: string[];
    created_at: string | null;
    insurance_provider?: string | null;
    insurance_policy_number?: string | null;
  };
  totalVisits: number;
  familyAllTime: number;
  familyToday: Array<{ id: string; name: string; token_number: number; status: string }>;
  lastToken: {
    id: string;
    date: string;
    doctor_name: string | null;
    raw_complaint: string | null;
    checkout_stage: CheckoutStage | null;
    payment_status: string | null;
  } | null;
  recentVisits?: Array<{
    id: string;
    date: string;
    doctor_name: string | null;
    raw_complaint: string | null;
  }>;
  unpaidPriorVisits: number;
};

function WithDoctorCard({
  token,
  isWorking,
  onDone,
  onHold,
  onSkip,
  onOpenProfile
}: {
  token: QueueItem | null;
  isWorking: boolean;
  onDone: (id: string) => void;
  onHold: () => void;
  onSkip: (id: string) => void;
  onOpenProfile: (patientId: string) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [brief, setBrief] = useState<PatientBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const patientId = token?.patient_id ?? null;

  // Reset flip + brief when the serving token changes
  useEffect(() => {
    setFlipped(false);
    setBrief(null);
  }, [token?.id]);

  // Eagerly fetch brief on token change — used by BOTH front-face pill and back face.
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    setBriefLoading(true);
    (async () => {
      const res = await fetch(`/api/patients/brief?id=${encodeURIComponent(patientId)}`, {
        cache: "no-store"
      });
      const body = await readJson<PatientBrief & { error?: string }>(res);
      if (cancelled) return;
      setBriefLoading(false);
      if (body && !body.error) setBrief(body);
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  // Esc to flip back
  useEffect(() => {
    if (!flipped) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const inField =
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (inField) return;
      if (e.key === "Escape") setFlipped(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped]);

  const topSnippet = useMemo(() => {
    if (!token) return null;
    const all = buildSnippets(token, brief);
    return all[0] ?? null;
  }, [token, brief]);

  if (!token) {
    return (
      <div className="flex h-full min-h-[260px] flex-col rounded-[28px] border border-white bg-white/85 px-5 py-4 shadow-[0_20px_40px_-24px_rgba(0,0,0,0.1)] backdrop-blur-xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#4F46E5]">
          With doctor
        </p>
        <p className="my-auto text-center text-sm font-semibold text-[#8B97AD]">
          Nobody in consultation right now.
        </p>
      </div>
    );
  }

  const elapsed = minutesSince(token.serving_started_at ?? token.checked_in_at);

  return (
    <div className="group h-full transition-transform duration-200 ease-out hover:-translate-y-[2px] [perspective:1400px]">
      <div
        className={cn(
          "relative h-full [transform-style:preserve-3d] transition-transform duration-300 ease-out will-change-transform",
          flipped && "[transform:rotateY(180deg)]"
        )}
      >
        {/* FRONT FACE */}
        <div className="relative flex h-full flex-col overflow-hidden rounded-[28px] border border-[#BBF7D0] bg-[linear-gradient(145deg,#F0FDF4_0%,#DCFCE7_55%,#FFFFFF_100%)] px-5 py-4 shadow-[0_20px_40px_-22px_rgba(16,185,129,0.4)] transition-shadow duration-200 group-hover:shadow-[0_28px_56px_-18px_rgba(16,185,129,0.55)] [backface-visibility:hidden]">
          <div className="pointer-events-none absolute inset-0 qcare-breathe bg-[radial-gradient(circle_at_75%_20%,rgba(16,185,129,0.18)_0%,rgba(255,255,255,0)_60%)]" />
          <div className="relative flex flex-1 flex-col">
            <div>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#047857]">
                  With doctor
                </p>
                <span className="qcare-breathe inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#DCFCE7_0%,#BBF7D0_100%)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#047857]">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#10B981]" />
                  {formatDur(elapsed)}
                </span>
              </div>
              <div className="mt-2">
                <p className="text-[28px] font-extrabold leading-[1] tracking-[-0.03em] tabular-nums text-[#0B1840]">
                  #{token.token_number}
                </p>
                <button
                  aria-expanded={flipped}
                  className="mt-1 flex w-full items-center gap-1 text-left text-base font-bold leading-[1.2] text-[#1A2550] transition group-hover:text-[#047857]"
                  onClick={() => setFlipped(true)}
                  title="Show briefing"
                  type="button"
                >
                  <span className="min-w-0 flex-1 truncate">
                    {token.patients?.name ?? "Patient"}
                  </span>
                  <ChevronRight
                    aria-hidden
                    className="h-4 w-4 shrink-0 text-[#94A3B8] transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[#047857]"
                  />
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {patientChips(token, new Date())}
              </div>
              <ContactLine token={token} tone="emerald" />

              {/* Top brief snippet — surfaced so she never has to flip to see the critical thing */}
              {topSnippet ? (
                <button
                  className={cn(
                    "mt-2.5 inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-[0.98]",
                    topSnippet.tone === "safety" &&
                      "bg-[#FEE2E2] text-[#B91C1C]",
                    topSnippet.tone === "people" &&
                      "bg-[#EEF2FF] text-[#4F46E5]",
                    topSnippet.tone === "ops" && "bg-[#F1F5F9] text-[#475569]"
                  )}
                  onClick={() => setFlipped(true)}
                  title="Open briefing"
                  type="button"
                >
                  {topSnippet.tone === "safety" ? (
                    <AlertTriangle className="h-3 w-3 shrink-0" />
                  ) : (
                    <span
                      className={cn(
                        "h-1.5 w-1.5 shrink-0 rounded-full",
                        topSnippet.tone === "people" ? "bg-[#4F46E5]" : "bg-[#94A3B8]"
                      )}
                    />
                  )}
                  <span className="truncate">{topSnippet.text}</span>
                </button>
              ) : null}
            </div>

            {/* Actions pushed to bottom */}
            <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
              <Btn disabled={isWorking} onClick={() => onDone(token.id)} tone="primary">
                Done · D
              </Btn>
              <Btn disabled={isWorking} onClick={() => onHold()} tone="outline">
                Hold · H
              </Btn>
              <Btn disabled={isWorking} onClick={() => onSkip(token.id)} tone="outline">
                Skip · S
              </Btn>
            </div>
          </div>
        </div>

        {/* BACK FACE — calmer, paper-like, briefing */}
        <div className="absolute inset-0 flex h-full flex-col overflow-hidden rounded-[28px] border border-[#E2E8F0] bg-white/95 px-5 py-4 shadow-[0_18px_34px_-24px_rgba(15,23,42,0.25)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#6A7283]">
              Briefing
            </p>
            <button
              aria-label="Flip back"
              className="rounded-full p-1 text-[#8B97AD] hover:bg-[#F5F7FB] hover:text-[#0B1840]"
              onClick={() => setFlipped(false)}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <span className="text-[22px] font-extrabold leading-none tracking-[-0.03em] text-[#0B1840] tabular-nums">
              #{token.token_number}
            </span>
            <span className="truncate text-sm font-bold text-[#1A2550]">
              {token.patients?.name ?? "Patient"}
            </span>
          </div>
          <BriefFaceBody token={token} brief={brief} loading={briefLoading} />
          <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
            {token.patients?.phone ? (
              <a
                className="inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#6366F1_0%,#4F46E5_100%)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-white shadow-[0_8px_18px_-14px_rgba(79,70,229,0.7)]"
                href={`tel:${token.patients.phone}`}
              >
                <Phone className="h-3 w-3" />
                Call
              </a>
            ) : null}
            <Btn onClick={() => patientId && onOpenProfile(patientId)} tone="outline">
              Full profile
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Back face body. Composes an opener sentence + up to 3 snippets ranked by
 * time-saved. Silent when data is missing.
 */
function BriefFaceBody({
  token,
  brief,
  loading
}: {
  token: QueueItem;
  brief: PatientBrief | null;
  loading: boolean;
}) {
  const opener = buildOpener(token, brief);
  const snippets = buildSnippets(token, brief);
  const redFlag =
    token.raw_complaint && RED_FLAG_RE.test(token.raw_complaint)
      ? token.raw_complaint
      : null;

  return (
    <div className="mt-2 min-h-[120px]">
      {opener ? (
        <p className="text-[12px] font-medium leading-snug text-[#5C667D]">{opener}</p>
      ) : null}
      {redFlag ? <RedFlagCallout complaint={redFlag} /> : null}
      <ul className="mt-2.5 grid gap-1.5">
        {loading && !brief
          ? [0, 1, 2].map((i) => (
              <li
                className="h-3 w-[70%] animate-pulse rounded bg-[#EEF2F7]"
                key={i}
                style={{ opacity: 1 - i * 0.25 }}
              />
            ))
          : snippets.map((s, i) => (
              <li className="flex items-start gap-2" key={i}>
                <span
                  className={cn(
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    s.tone === "safety"
                      ? "bg-[#B91C1C]"
                      : s.tone === "people"
                        ? "bg-[#4F46E5]"
                        : "bg-[#8B97AD]"
                  )}
                />
                <p
                  className={cn(
                    "text-[12.5px] font-medium leading-snug",
                    s.tone === "safety" ? "text-[#B91C1C]" : "text-[#1A2550]"
                  )}
                >
                  {s.text}
                </p>
              </li>
            ))}
      </ul>
    </div>
  );
}

type Snippet = { text: string; tone: "safety" | "people" | "ops" };

function buildOpener(token: QueueItem, brief: PatientBrief | null): string | null {
  // opener: New | Returning · Nyo (M/F) · language non-EN · family link
  const parts: string[] = [];
  const createdAt = token.patients?.created_at ?? null;
  const isNew =
    createdAt && isSameDate(createdAt, new Date()) && (brief ? brief.totalVisits <= 1 : true);
  parts.push(isNew ? "New patient today" : "Returning");

  const age = token.patients?.age;
  const g = token.patients?.gender;
  if (age && g) parts.push(`${age}yo ${g === "male" ? "M" : g === "female" ? "F" : ""}`.trim());
  else if (age) parts.push(`${age}yo`);
  else if (g) parts.push(g === "male" ? "M" : g === "female" ? "F" : "other");

  const lang = token.patients?.language_preference;
  if (lang && lang.toLowerCase() !== "en") {
    const name: Record<string, string> = {
      hi: "Hindi",
      ta: "Tamil",
      te: "Telugu",
      kn: "Kannada",
      ml: "Malayalam"
    };
    parts.push(`prefers ${name[lang.toLowerCase()] ?? lang}`);
  }
  if (brief && brief.familyAllTime > 0) parts.push("usually comes with family");
  return parts.length > 0 ? parts.join(" · ") : null;
}

function buildSnippets(token: QueueItem, brief: PatientBrief | null): Snippet[] {
  const all: Snippet[] = [];

  // 1 · Safety — allergies (red)
  // token.patients only carries fields from the queue API; allergies come from the brief fetch.
  const allergies = brief?.patient.allergies ?? [];
  if (allergies && allergies.length > 0) {
    all.push({
      tone: "safety",
      text: `Allergic to ${allergies.slice(0, 2).join(", ")}${allergies.length > 2 ? "…" : ""}`
    });
  }

  // 2 · People — family also here today
  if (brief && brief.familyToday.length > 0) {
    const t = brief.familyToday[0];
    all.push({
      tone: "people",
      text:
        brief.familyToday.length === 1
          ? `Came with ${t.name} (#${t.token_number}, ${t.status.replace(/_/g, " ")})`
          : `Came with ${brief.familyToday.length} family members today`
    });
  }

  // 3 · Visit cadence — only if returning
  if (brief && brief.totalVisits > 1) {
    all.push({
      tone: "people",
      text: `${brief.totalVisits}${ordinalSuffix(brief.totalVisits)} visit${brief.totalVisits === 1 ? "" : ""} on record`
    });
  }

  // 4 · Age-based assistance
  const age = token.patients?.age ?? null;
  if (age !== null && age >= 65) {
    all.push({ tone: "people", text: `Age ${age} · may need assistance walking out` });
  } else if (age !== null && age < 12) {
    all.push({ tone: "people", text: `Child, age ${age} · guardian at counter` });
  }

  // 5 · Operational — unpaid prior visits
  if (brief && brief.unpaidPriorVisits > 0) {
    all.push({
      tone: "ops",
      text: `${brief.unpaidPriorVisits} prior visit${brief.unpaidPriorVisits === 1 ? "" : "s"} still awaiting payment`
    });
  }

  // 6 · Operational — last visit outcome hint
  if (brief?.lastToken?.checkout_stage) {
    const stageLabel: Record<string, string> = {
      awaiting_payment: "ended at billing (awaiting payment)",
      payment_done: "left after paying",
      pharmacy_pickup: "went to pharmacy",
      referred_for_lab: "was referred to lab",
      visit_closed: "closed cleanly"
    };
    const label = stageLabel[brief.lastToken.checkout_stage];
    if (label) {
      all.push({
        tone: "ops",
        text: `Last visit (${fmtShortDate(brief.lastToken.date)}) — ${label}`
      });
    }
  }

  // Rank: safety first, then people, then ops. Cap at 3.
  const rank = (s: Snippet) => (s.tone === "safety" ? 0 : s.tone === "people" ? 1 : 2);
  return all.sort((a, b) => rank(a) - rank(b)).slice(0, 3);
}

function ordinalSuffix(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return "st";
  if (mod10 === 2 && mod100 !== 12) return "nd";
  if (mod10 === 3 && mod100 !== 13) return "rd";
  return "th";
}

function fmtShortDate(iso: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short" }).format(new Date(iso));
}

function NextCard({
  token,
  clinicName,
  upcoming,
  isWorking,
  behind,
  onStart,
  onOpenProfile
}: {
  token: QueueItem | null;
  clinicName: string;
  upcoming: QueueItem[];
  isWorking: boolean;
  behind: number;
  onStart: (id: string) => void;
  onOpenProfile: (patientId: string) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [brief, setBrief] = useState<PatientBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const patientId = token?.patient_id ?? null;

  // Reset flip + brief when token changes
  useEffect(() => {
    setFlipped(false);
    setBrief(null);
  }, [token?.id]);

  // Fetch brief eagerly so flip is instant
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    setBriefLoading(true);
    (async () => {
      const res = await fetch(`/api/patients/brief?id=${encodeURIComponent(patientId)}`, {
        cache: "no-store"
      });
      const body = await readJson<PatientBrief & { error?: string }>(res);
      if (cancelled) return;
      setBriefLoading(false);
      if (body && !body.error) setBrief(body);
    })();
    return () => {
      cancelled = true;
    };
  }, [patientId]);

  // Esc to flip back
  useEffect(() => {
    if (!flipped) return;
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null;
      const inField =
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (inField) return;
      if (e.key === "Escape") setFlipped(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped]);

  if (!token) {
    return (
      <div className="flex h-full min-h-[260px] flex-col rounded-[28px] border border-[#BAE6FD] bg-[linear-gradient(145deg,#F0F9FF_0%,#E0F2FE_55%,#FFFFFF_100%)] px-5 py-4 shadow-[0_20px_40px_-24px_rgba(14,165,233,0.22)] backdrop-blur-xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#0369A1]">
          Next up
        </p>
        <p className="my-auto text-center text-sm font-semibold text-[#8B97AD]">
          Queue is empty.
        </p>
      </div>
    );
  }
  const waited = minutesSince(token.checked_in_at);

  return (
    <div className="group h-full transition-transform duration-200 ease-out hover:-translate-y-[2px] [perspective:1400px]">
      <div
        className={cn(
          "relative h-full [transform-style:preserve-3d] transition-transform duration-300 ease-out will-change-transform",
          flipped && "[transform:rotateY(180deg)]"
        )}
      >
        {/* FRONT */}
        <div className="relative flex h-full flex-col overflow-hidden rounded-[28px] border border-[#BAE6FD] bg-[linear-gradient(145deg,#F0F9FF_0%,#E0F2FE_55%,#FFFFFF_100%)] px-5 py-4 shadow-[0_20px_40px_-22px_rgba(14,165,233,0.32)] transition-shadow duration-200 group-hover:shadow-[0_28px_56px_-18px_rgba(14,165,233,0.5)] [backface-visibility:hidden]">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#0369A1]">
              Next up
            </p>
            <span className="rounded-full bg-[linear-gradient(135deg,#E0F2FE_0%,#BAE6FD_100%)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#0369A1]">
              waited {formatDur(waited)}
            </span>
          </div>
          <div className="mt-2">
            <p
              className={cn(
                "text-[28px] font-extrabold leading-[1] tracking-[-0.03em] tabular-nums",
                tokenNeedsCall(token) ? "text-[#B91C1C]" : "text-[#0B1840]"
              )}
              title={tokenNeedsCall(token) ? "Check-in SMS didn't deliver — call them" : undefined}
            >
              #{token.token_number}
            </p>
            <button
              aria-expanded={flipped}
              className="mt-1 flex w-full items-center gap-1 text-left text-base font-bold leading-[1.2] text-[#1A2550] transition group-hover:text-[#0369A1]"
              onClick={() => setFlipped(true)}
              title="Show briefing"
              type="button"
            >
              <span className="min-w-0 flex-1 truncate">
                {token.patients?.name ?? "Patient"}
              </span>
              <ChevronRight
                aria-hidden
                className="h-4 w-4 shrink-0 text-[#94A3B8] transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[#0369A1]"
              />
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {patientChips(token, new Date())}
          </div>
          <ContactLine token={token} tone="sky" />
          <PreflightRow token={token} />
          <p className="mt-1 text-[11px] font-semibold text-[#8B97AD]">
            {behind} more behind
          </p>
          {upcoming.length > 0 ? (
            <div className="mt-3 rounded-2xl border border-[#E2E8F0] bg-white/70 p-2.5">
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#8B97AD]">
                Then
              </p>
              <div className="mt-1 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-[#1A2550]">
                {upcoming.map((u) => (
                  <Fragment key={u.id}>
                    <span className="tabular-nums text-[#4F46E5]">
                      #{u.token_number}
                    </span>
                    <span className="truncate">
                      {u.patients?.name ?? "Patient"}
                    </span>
                    <span className="text-[#8B97AD]">
                      {formatDur(minutesSince(u.checked_in_at))}
                    </span>
                  </Fragment>
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-auto pt-3">
            <Btn disabled={isWorking} onClick={() => onStart(token.id)} tone="primary">
              Start consultation · N
            </Btn>
          </div>
        </div>

        {/* BACK — briefing */}
        <div className="absolute inset-0 flex h-full flex-col overflow-hidden rounded-[28px] border border-[#E2E8F0] bg-white/95 px-5 py-4 shadow-[0_18px_34px_-24px_rgba(15,23,42,0.25)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#6A7283]">
              Briefing
            </p>
            <button
              aria-label="Flip back"
              className="rounded-full p-1 text-[#8B97AD] hover:bg-[#F5F7FB] hover:text-[#0B1840]"
              onClick={() => setFlipped(false)}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1.5 flex items-baseline gap-3">
            <span className="text-[22px] font-extrabold leading-none tracking-[-0.03em] text-[#0B1840] tabular-nums">
              #{token.token_number}
            </span>
            <span className="truncate text-sm font-bold text-[#1A2550]">
              {token.patients?.name ?? "Patient"}
            </span>
          </div>

          <NextBriefBody
            token={token}
            brief={brief}
            loading={briefLoading}
          />

          {/* Terminal actions */}
          <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
            <SendTextAction
              token={token}
              clinicName={clinicName}
              prominent={token.proximity_status === "unknown"}
            />
            {token.patients?.phone ? (
              <a
                className="inline-flex items-center gap-1.5 rounded-full border border-[#E2E8F0] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#1A2550] hover:border-[#CBD5E1]"
                href={`tel:${token.patients.phone}`}
              >
                <Phone className="h-3 w-3" />
                Call
              </a>
            ) : null}
            <Btn
              onClick={() => patientId && onOpenProfile(patientId)}
              tone="ghost"
            >
              Full profile
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Red-flag complaint callout — shown at the top of any flipped briefing
 * when the raw complaint matches a safety keyword. Spells out *what* the
 * flag is so the receptionist isn't left guessing.
 */
function RedFlagCallout({ complaint }: { complaint: string }) {
  return (
    <div className="mt-3 rounded-2xl border border-[#FECACA] bg-[#FFF1F2] p-3">
      <p className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[#B91C1C]">
        <AlertTriangle className="h-3 w-3" />
        Red flag
      </p>
      <p className="mt-1 text-[12.5px] font-semibold leading-snug text-[#7F1D1D]">
        “{complaint}”
      </p>
    </div>
  );
}

function NextBriefBody({
  token,
  brief,
  loading
}: {
  token: QueueItem;
  brief: PatientBrief | null;
  loading: boolean;
}) {
  const opener = buildOpener(token, brief);
  const visits = brief?.recentVisits ?? [];
  const insurance = brief?.patient.insurance_provider ?? null;
  const policy = brief?.patient.insurance_policy_number ?? null;
  const redFlag =
    token.raw_complaint && RED_FLAG_RE.test(token.raw_complaint)
      ? token.raw_complaint
      : null;

  return (
    <div className="mt-2">
      {opener ? (
        <p className="text-[12px] font-medium leading-snug text-[#5C667D]">{opener}</p>
      ) : null}

      {redFlag ? <RedFlagCallout complaint={redFlag} /> : null}

      {loading && !brief ? (
        <div className="mt-3 space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div
              className="h-3 rounded bg-[#EEF2F7]"
              key={i}
              style={{
                width: `${80 - i * 15}%`,
                opacity: 1 - i * 0.25,
                animation: "pulse 1.5s ease-in-out infinite"
              }}
            />
          ))}
        </div>
      ) : null}

      {visits.length > 0 ? (
        <div className="mt-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#8B97AD]">
            Past visits
          </p>
          <ul className="mt-1.5 space-y-1">
            {visits.map((v) => (
              <li key={v.id} className="text-[12px] leading-snug">
                <span className="font-bold text-[#1A2550]">
                  {new Intl.DateTimeFormat("en-IN", {
                    day: "numeric",
                    month: "short"
                  }).format(new Date(v.date))}
                </span>
                {v.raw_complaint ? (
                  <span className="text-[#5C667D]">
                    {" · "}
                    {v.raw_complaint.length > 60
                      ? v.raw_complaint.slice(0, 60) + "…"
                      : v.raw_complaint}
                  </span>
                ) : null}
                {v.doctor_name ? (
                  <span className="text-[#8B97AD]"> · {v.doctor_name}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {insurance ? (
        <div className="mt-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#8B97AD]">
            Insurance
          </p>
          <p className="mt-0.5 text-[12.5px] font-semibold text-[#1A2550]">
            {insurance}
            {policy ? (
              <span className="ml-2 font-mono text-[11px] text-[#8B97AD]">{policy}</span>
            ) : null}
          </p>
        </div>
      ) : brief ? (
        <div className="mt-3">
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#8B97AD]">
            Insurance
          </p>
          <p className="mt-0.5 text-[12.5px] font-semibold text-[#64748B]">Self-pay</p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Tap-to-SMS button with a pre-filled message.  Prominent (filled) when the
 * patient's proximity is unknown — the card asks for confirmation.
 */
function SendTextAction({
  token,
  clinicName,
  prominent
}: {
  token: QueueItem;
  clinicName: string;
  prominent: boolean;
}) {
  const phone = token.patients?.phone ?? null;
  if (!phone) return null;

  const firstName = (token.patients?.name ?? "there").split(/\s+/)[0] ?? "there";
  const message = prominent
    ? `Hi ${firstName}, this is ${clinicName} reception. Token #${token.token_number} is coming up next — please let us know if you're on your way.`
    : `Hi ${firstName}, this is ${clinicName} reception. Token #${token.token_number} will be called in a few minutes. Thank you.`;

  const label = prominent ? "Send text to confirm arrival" : "Send text";

  const baseCls =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition";
  const cls = prominent
    ? "bg-[linear-gradient(135deg,#6366F1_0%,#4F46E5_100%)] text-white shadow-[0_10px_22px_-14px_rgba(79,70,229,0.7)] hover:-translate-y-[1px]"
    : "border border-[#E2E8F0] bg-white text-[#1A2550] hover:border-[#CBD5E1]";

  return (
    <a
      className={cn(baseCls, cls)}
      href={`sms:${phone}?body=${encodeURIComponent(message)}`}
    >
      <MessageSquare className="h-3 w-3" />
      {label}
    </a>
  );
}

function NeedsYouCard({
  items,
  isWorking,
  onDismiss
}: {
  items: NeedsYouItem[];
  isWorking: boolean;
  onDismiss: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-[28px] border border-[#E9D5FF] bg-[linear-gradient(145deg,#FAF5FF_0%,#F3E8FF_55%,#FFFFFF_100%)] px-5 py-4 shadow-[0_20px_40px_-22px_rgba(168,85,247,0.28)] backdrop-blur-xl">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7E22CE]">
          Needs you
        </p>
        <span className="rounded-full bg-[linear-gradient(135deg,#F3E8FF_0%,#E9D5FF_100%)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#7E22CE]">
          {items.length}
        </span>
      </div>
      {items.length === 0 ? (
        <div className="mt-5 flex flex-col items-center gap-1.5 py-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#DCFCE7] text-[#047857]">
            <CheckCircle2 className="h-5 w-5" />
          </div>
          <p className="text-sm font-bold text-[#0B1840]">All quiet.</p>
          <p className="text-[11px] font-medium text-[#8B97AD]">Co-pilot is watching.</p>
        </div>
      ) : (
        <ul className="mt-3 grid min-h-0 flex-1 auto-rows-min gap-2 overflow-y-auto pr-1">
          {items.map((item) => (
            <li
              className={cn(
                "rounded-2xl border px-3 py-2.5",
                item.severity === "red" && "border-[#FECACA] bg-[#FFF1F2]",
                item.severity === "amber" && "border-[#FDE68A] bg-[#FFFBEB]",
                item.severity === "info" && "border-[#DBEAFE] bg-[#F3F7FF]"
              )}
              key={item.id}
            >
              <p
                className={cn(
                  "text-[13px] font-bold leading-snug",
                  item.severity === "red" && "text-[#B91C1C]",
                  item.severity === "amber" && "text-[#B45309]",
                  item.severity === "info" && "text-[#1D4ED8]"
                )}
              >
                {item.title}
              </p>
              <p className="mt-0.5 text-[11px] font-medium text-[#5C667D]">{item.detail}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.primary ? (
                  <Btn
                    disabled={isWorking}
                    onClick={() => void item.primary?.run()}
                    tone="primary"
                  >
                    {item.primary.label}
                  </Btn>
                ) : null}
                {item.secondary ? (
                  <Btn
                    disabled={isWorking}
                    onClick={() => void item.secondary?.run()}
                    tone="outline"
                  >
                    {item.secondary.label}
                  </Btn>
                ) : null}
                <Btn onClick={() => onDismiss(item.id)} tone="ghost">
                  Dismiss
                </Btn>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ---------- Tiny UI ---------- */

function Btn({
  children,
  onClick,
  disabled,
  tone
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone: "primary" | "outline" | "ghost";
}) {
  const cls =
    tone === "primary"
      ? "bg-[linear-gradient(135deg,#6366F1_0%,#4F46E5_100%)] text-white shadow-[0_8px_18px_-14px_rgba(79,70,229,0.7)] hover:-translate-y-[1px]"
      : tone === "outline"
        ? "border border-[#E2E8F0] bg-white text-[#1A2550] hover:border-[#CBD5E1]"
        : "bg-transparent text-[#6A7283] hover:bg-[#F3F4F9]";
  return (
    <button
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition disabled:opacity-50",
        cls
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-[#E2E8F0] bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#4F46E5]">
      {children}
    </kbd>
  );
}

/* ---------- Premium modal shell (shared across Hold, Pause, Lane, etc.) ---------- */

type ModalAccent = "violet" | "amber" | "indigo" | "emerald" | "sky" | "rose";

const MODAL_AURA_RGB: Record<ModalAccent, string> = {
  violet: "139, 92, 246",
  amber: "245, 158, 11",
  indigo: "99, 102, 241",
  emerald: "16, 185, 129",
  sky: "14, 165, 233",
  rose: "244, 63, 94"
};

function ModalShell({
  accent,
  children,
  onClose,
  maxWidth = "max-w-md"
}: {
  accent: ModalAccent;
  children: React.ReactNode;
  onClose: () => void;
  maxWidth?: string;
}) {
  const rgb = MODAL_AURA_RGB[accent];
  return (
    <div
      className="qcare-backdrop-in fixed inset-0 z-50 flex items-center justify-center bg-[rgba(11,24,64,0.6)] px-4 py-6 backdrop-blur-md overflow-y-auto"
      onClick={onClose}
    >
      <div
        className={cn(
          "qcare-modal-in relative w-full overflow-hidden rounded-[36px] border border-white bg-white/96 shadow-[0_60px_120px_-40px_rgba(11,24,64,0.6)] backdrop-blur-2xl",
          maxWidth
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ambient accent glow, top-right */}
        <div
          aria-hidden
          className="pointer-events-none absolute right-[-15%] top-[-35%] h-[440px] w-[440px] rounded-full"
          style={{
            background: `radial-gradient(circle, rgba(${rgb}, 0.22) 0%, rgba(255,255,255,0) 70%)`
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute left-[-12%] bottom-[-30%] h-[320px] w-[320px] rounded-full"
          style={{
            background: `radial-gradient(circle, rgba(${rgb}, 0.1) 0%, rgba(255,255,255,0) 70%)`
          }}
        />
        <div className="relative p-7 sm:p-8">{children}</div>
      </div>
    </div>
  );
}

function ModalHeader({
  kicker,
  kickerColor,
  title,
  subtitle,
  onClose
}: {
  kicker: string;
  kickerColor: string;
  title: React.ReactNode;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p
          className="text-[11px] font-bold uppercase tracking-[0.24em]"
          style={{ color: kickerColor }}
        >
          {kicker}
        </p>
        <h2 className="mt-1.5 text-[1.75rem] font-extrabold leading-[1.05] tracking-[-0.035em] text-[#0B1840]">
          {title}
        </h2>
        {subtitle ? (
          <p className="mt-1.5 text-[12.5px] font-semibold text-[#5C667D]">
            {subtitle}
          </p>
        ) : null}
      </div>
      <button
        aria-label="Close"
        className="rounded-full border border-[#E2E8F0] bg-white/80 p-2 text-[#8B97AD] transition hover:border-[#CBD5E1] hover:bg-white hover:text-[#0B1840]"
        onClick={onClose}
        type="button"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ---------- Duration picker (mixed min + hr presets + unit toggle) ---------- */

function DurationPicker({
  minutes,
  onChange,
  presets,
  maxMinutes = 240
}: {
  minutes: number;
  onChange: (mins: number) => void;
  presets: number[];
  maxMinutes?: number;
}) {
  const [customUnit, setCustomUnit] = useState<"min" | "hr">(
    minutes >= 60 && minutes % 60 === 0 ? "hr" : "min"
  );

  const isPreset = presets.includes(minutes);
  const displayValue = customUnit === "hr" ? minutes / 60 : minutes;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {presets.map((m) => (
        <button
          className={cn(
            "rounded-full border px-3 py-1.5 text-[11px] font-bold tracking-[0.05em] transition",
            minutes === m
              ? "border-[#4F46E5] bg-[linear-gradient(135deg,#EEF2FF_0%,#E0E7FF_100%)] text-[#4F46E5] shadow-[0_6px_14px_-10px_rgba(79,70,229,0.5)]"
              : "border-[#E2E8F0] bg-white text-[#1A2550] hover:border-[#CBD5E1]"
          )}
          key={m}
          onClick={() => {
            onChange(m);
            setCustomUnit(m >= 60 && m % 60 === 0 ? "hr" : "min");
          }}
          type="button"
        >
          {m < 60 ? `${m} min` : m % 60 === 0 ? `${m / 60} hr` : `${Math.floor(m / 60)}h ${m % 60}m`}
        </button>
      ))}
      <div
        className={cn(
          "flex items-center gap-1 rounded-full border bg-white px-2 py-1 transition",
          isPreset ? "border-[#E2E8F0]" : "border-[#4F46E5] shadow-[0_6px_14px_-10px_rgba(79,70,229,0.5)]"
        )}
      >
        <input
          aria-label="Custom duration"
          className="w-14 border-0 bg-transparent text-center text-sm font-bold text-[#0B1840] focus:outline-none"
          max={customUnit === "hr" ? Math.floor(maxMinutes / 60) : maxMinutes}
          min={customUnit === "hr" ? 1 : 1}
          onChange={(e) => {
            const v = Number(e.target.value) || 0;
            const nextMins = customUnit === "hr" ? Math.round(v * 60) : Math.round(v);
            onChange(Math.max(1, Math.min(maxMinutes, nextMins)));
          }}
          step={customUnit === "hr" ? 0.5 : 1}
          type="number"
          value={displayValue}
        />
        <button
          className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#4F46E5] transition hover:bg-[#EEF2FF]"
          onClick={() => setCustomUnit((u) => (u === "min" ? "hr" : "min"))}
          title="Toggle unit"
          type="button"
        >
          {customUnit === "hr" ? "hr" : "min"}
        </button>
      </div>
    </div>
  );
}

/* ---------- Next-up preflight row (vitals · insurance · proximity) ---------- */

function PreflightRow({ token }: { token: QueueItem }) {
  const vitalsDone = Boolean(token.vitals_taken_at);
  const insurance = token.patients?.insurance_provider ?? null;
  const proximity = (token.proximity_status ?? "unknown") as ProximityStatus;

  // Vitals — green if done, amber if pending
  const vitalsClass = vitalsDone ? "text-[#047857]" : "text-[#B45309]";
  const vitalsDot = vitalsDone ? "bg-[#10B981]" : "bg-[#F59E0B]";
  const vitalsText = vitalsDone ? "Vitals done" : "Vitals pending";

  // Insurance — blue if on file, muted if self-pay
  const insuranceClass = insurance ? "text-[#1D4ED8]" : "text-[#64748B]";
  const insuranceDot = insurance ? "bg-[#3B82F6]" : "bg-[#94A3B8]";
  const insuranceText = insurance ?? "Self-pay";

  // Proximity
  const proxMap: Record<
    ProximityStatus,
    { text: string; cls: string; dot: string }
  > = {
    in_clinic: { text: "In clinic", cls: "text-[#047857]", dot: "bg-[#10B981]" },
    nearby: { text: "Nearby", cls: "text-[#B45309]", dot: "bg-[#F59E0B]" },
    unknown: { text: "Not confirmed", cls: "text-[#64748B]", dot: "bg-[#94A3B8]" }
  };
  const prox = proxMap[proximity];

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold">
      <span className={cn("inline-flex items-center gap-1.5", vitalsClass)}>
        <span className={cn("h-1.5 w-1.5 rounded-full", vitalsDot)} />
        {vitalsText}
      </span>
      <span className={cn("inline-flex items-center gap-1.5", insuranceClass)}>
        <span className={cn("h-1.5 w-1.5 rounded-full", insuranceDot)} />
        {insuranceText}
      </span>
      <span className={cn("inline-flex items-center gap-1.5", prox.cls)}>
        <span className={cn("h-1.5 w-1.5 rounded-full", prox.dot)} />
        {prox.text}
      </span>
    </div>
  );
}

/* ---------- Hold dialog ---------- */

type HoldReasonKey = "bathroom" | "phone" | "paperwork" | "family" | "other";

const HOLD_REASONS: Array<{
  key: HoldReasonKey;
  label: string;
  note: string;
  defaultMinutes: number;
}> = [
  { key: "bathroom", label: "Bathroom break", note: "Bathroom break", defaultMinutes: 5 },
  { key: "phone", label: "Phone call", note: "Stepped out for a phone call", defaultMinutes: 10 },
  { key: "paperwork", label: "Paperwork", note: "Fetching documents or records", defaultMinutes: 10 },
  { key: "family", label: "Waiting for family", note: "Waiting for family member to arrive", defaultMinutes: 15 },
  { key: "other", label: "Other", note: "", defaultMinutes: 5 }
];

const HOLD_MINUTE_PRESETS = [5, 10, 15, 30, 60];

function HoldDialog({
  token,
  isWorking,
  onClose,
  onSubmit
}: {
  token: QueueItem;
  isWorking: boolean;
  onClose: () => void;
  onSubmit: (v: { minutes: number; note: string }) => void;
}) {
  const [reason, setReason] = useState<HoldReasonKey>("bathroom");
  const [minutes, setMinutes] = useState(5);
  const [otherText, setOtherText] = useState("");

  const preset = HOLD_REASONS.find((r) => r.key === reason)!;
  const finalNote = reason === "other" ? otherText.trim() : preset.note;
  const canSubmit = minutes >= 1 && minutes <= 120 && finalNote.length >= 8;

  function pickReason(k: HoldReasonKey) {
    setReason(k);
    const r = HOLD_REASONS.find((x) => x.key === k)!;
    setMinutes(r.defaultMinutes);
  }

  return (
    <ModalShell accent="violet" maxWidth="max-w-lg" onClose={onClose}>
      <ModalHeader
        kicker="Hold slot"
        kickerColor="#6D28D9"
        onClose={onClose}
        subtitle="The patient's place in line is preserved while you step them out."
        title={
          <>
            <span className="tabular-nums text-[#6D28D9]">#{token.token_number}</span>
            <span className="ml-2 text-[#1A2550]">{token.patients?.name ?? "Patient"}</span>
          </>
        }
      />

      <div className="mt-7">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-[#6A7283]">
          What for?
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {HOLD_REASONS.map((r) => (
            <button
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition",
                reason === r.key
                  ? "border-[#DDD6FE] bg-[linear-gradient(135deg,#EDE9FE_0%,#DDD6FE_100%)] text-[#6D28D9] shadow-[0_8px_18px_-14px_rgba(109,40,217,0.5)]"
                  : "border-[#E2E8F0] bg-white text-[#1A2550] hover:border-[#CBD5E1]"
              )}
              key={r.key}
              onClick={() => pickReason(r.key)}
              type="button"
            >
              {r.label}
            </button>
          ))}
        </div>
        {reason === "other" ? (
          <input
            autoFocus
            className="mt-3 h-11 w-full rounded-xl border border-[#E2E8F0] bg-white px-3.5 text-sm font-medium text-[#0B1840] placeholder:text-[#94A3B8] focus:border-[#6D28D9] focus:outline-none focus:ring-2 focus:ring-[#6D28D9]/20"
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="Brief reason (min 8 characters)"
            value={otherText}
          />
        ) : null}
      </div>

      <div className="mt-6">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-[#6A7283]">
          For how long?
        </p>
        <div className="mt-2.5">
          <DurationPicker
            maxMinutes={120}
            minutes={minutes}
            onChange={setMinutes}
            presets={HOLD_MINUTE_PRESETS}
          />
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between border-t border-[#EEF2F7] pt-5">
        <p className="text-[11px] font-semibold text-[#8B97AD]">
          Hold ends in <span className="text-[#0B1840]">{formatDur(minutes)}</span>
        </p>
        <div className="flex gap-2">
          <Btn onClick={onClose} tone="ghost">
            Cancel
          </Btn>
          <button
            className="inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#8B5CF6_0%,#6D28D9_100%)] px-5 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-white shadow-[0_14px_28px_-14px_rgba(109,40,217,0.7)] transition hover:-translate-y-[1px] disabled:opacity-50 disabled:hover:translate-y-0"
            disabled={!canSubmit || isWorking}
            onClick={() => onSubmit({ minutes, note: finalNote })}
            type="button"
          >
            <PauseCircle className="h-3.5 w-3.5" />
            Confirm hold
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

/* ---------- On-hold strip ---------- */

function HeldStrip({
  items,
  isWorking,
  onReturn,
  onOpen
}: {
  items: QueueItem[];
  isWorking: boolean;
  onReturn: (tokenId: string) => void;
  onOpen: (token: QueueItem) => void;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-[22px] border border-[#E9D5FF] bg-[linear-gradient(145deg,#FAF5FF_0%,#FFFFFF_100%)] px-3 py-2 shadow-[0_12px_24px_-20px_rgba(168,85,247,0.25)]">
      <span className="pl-2 text-[10px] font-bold uppercase tracking-[0.22em] text-[#7E22CE]">
        On hold
      </span>
      <div className="flex flex-1 flex-wrap gap-1.5">
        {items.map((t) => {
          const remaining = minutesUntil(t.hold_until);
          const overdue = remaining <= 0;
          return (
            <div
              className={cn(
                "group inline-flex items-center gap-1.5 rounded-full border bg-white px-2.5 py-1 text-[11px] shadow-[0_6px_14px_-10px_rgba(11,24,64,0.25)]",
                overdue ? "border-[#FECACA]" : "border-[#E9D5FF]"
              )}
              key={t.id}
            >
              <button
                className="inline-flex min-w-0 items-baseline gap-1 text-left"
                onClick={() => onOpen(t)}
                title={t.hold_note ?? "Open patient"}
                type="button"
              >
                <span className="font-extrabold text-[#0B1840] tabular-nums">
                  #{t.token_number}
                </span>
                <span className="truncate font-bold text-[#1A2550]">
                  {t.patients?.name ?? "Patient"}
                </span>
                <span
                  className={cn(
                    "font-semibold",
                    overdue ? "text-[#B91C1C]" : "text-[#8B97AD]"
                  )}
                >
                  · {overdue ? "expired" : `${formatDur(Math.max(0, remaining))} left`}
                </span>
              </button>
              <button
                aria-label="Return to waiting"
                className="inline-flex items-center gap-1 rounded-full bg-[#EEF2FF] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-[#4F46E5] transition hover:bg-[#E0E7FF]"
                disabled={isWorking}
                onClick={() => onReturn(t.id)}
                title="Return to waiting"
                type="button"
              >
                <RotateCcw className="h-3 w-3" />
                Return
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- Lane popover (triggered by clicking a metric pill) ---------- */

function LaneModal({
  doctorName,
  status,
  items,
  isWorking,
  hasServing,
  onClose,
  onQueueAction,
  onHold
}: {
  doctorName: string;
  status: TokenStatus;
  items: QueueItem[];
  isWorking: boolean;
  hasServing: boolean;
  onClose: () => void;
  onQueueAction: (
    action:
      | "start_consultation"
      | "mark_consultation_done"
      | "skip"
      | "hold_slot"
      | "return_to_waiting",
    tokenId: string,
    extra?: { holdMinutes?: number; holdNote?: string }
  ) => void;
  onHold: (token: QueueItem) => void;
}) {
  const laneScrollRef = useRef<HTMLDivElement | null>(null);
  useSmoothScroll(laneScrollRef);
  const theme = LANE_THEME[status];
  const accent: ModalAccent =
    status === "waiting"
      ? "indigo"
      : status === "serving"
        ? "emerald"
        : status === "stepped_out"
          ? "violet"
          : status === "complete"
            ? "indigo"
            : "amber";
  const kickerColor =
    status === "waiting"
      ? "#4F46E5"
      : status === "serving"
        ? "#047857"
        : status === "stepped_out"
          ? "#6D28D9"
          : status === "complete"
            ? "#1D4ED8"
            : "#B45309";

  const sorted = useMemo(() => {
    const copy = [...items];
    if (status === "waiting" || status === "serving") {
      copy.sort((a, b) => a.token_number - b.token_number);
    } else if (status === "stepped_out") {
      copy.sort((a, b) => {
        const ta = a.hold_until ? new Date(a.hold_until).getTime() : 0;
        const tb = b.hold_until ? new Date(b.hold_until).getTime() : 0;
        return ta - tb;
      });
    } else {
      copy.sort(
        (a, b) =>
          new Date(b.checked_in_at).getTime() - new Date(a.checked_in_at).getTime()
      );
    }
    return copy;
  }, [items, status]);

  return (
    <ModalShell accent={accent} maxWidth="max-w-2xl" onClose={onClose}>
      <ModalHeader
        kicker={theme.label}
        kickerColor={kickerColor}
        onClose={onClose}
        subtitle={`${items.length} ${
          items.length === 1 ? "patient" : "patients"
        } · ${doctorName}`}
        title={
          <span className="flex items-center gap-3">
            <span className={cn("h-3 w-3 rounded-full", theme.dot)} />
            <span className="text-[#0B1840]">{theme.label}</span>
            <span
              className={cn(
                "rounded-full px-2.5 py-0.5 text-[13px] font-extrabold tabular-nums",
                theme.chipBg,
                theme.chipText
              )}
            >
              {items.length}
            </span>
          </span>
        }
      />

      <div
        className="qcare-scroll qcare-scroll-fade mt-6 max-h-[60vh] overflow-y-auto pr-1"
        ref={laneScrollRef}
      >
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 py-14 text-center">
            <p className="text-base font-bold text-[#0B1840]">Empty lane.</p>
            <p className="text-[12px] font-medium text-[#8B97AD]">
              Nobody in {theme.label.toLowerCase()} right now.
            </p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {sorted.map((t, idx) => (
              <LaneRow
                key={t.id}
                animationIndex={Math.min(idx, 8)}
                hasServing={hasServing}
                isWorking={isWorking}
                onHold={() => onHold(t)}
                onQueueAction={onQueueAction}
                status={status}
                token={t}
              />
            ))}
          </ul>
        )}
      </div>
    </ModalShell>
  );
}

function LaneRow({
  token,
  status,
  isWorking,
  hasServing,
  onQueueAction,
  onHold,
  animationIndex = 0
}: {
  token: QueueItem;
  status: TokenStatus;
  isWorking: boolean;
  hasServing: boolean;
  onQueueAction: (
    action:
      | "start_consultation"
      | "mark_consultation_done"
      | "skip"
      | "hold_slot"
      | "return_to_waiting",
    tokenId: string,
    extra?: { holdMinutes?: number; holdNote?: string }
  ) => void;
  onHold: () => void;
  animationIndex?: number;
}) {
  const isRed = token.raw_complaint ? RED_FLAG_RE.test(token.raw_complaint) : false;
  const waited = minutesSince(token.checked_in_at);
  const elapsed = minutesSince(
    token.serving_started_at ?? token.checked_in_at
  );
  const holdLeft = token.hold_until ? minutesUntil(token.hold_until) : null;

  return (
    <li
      className={cn(
        "qcare-list-item-in rounded-2xl border bg-white p-3 shadow-[0_6px_14px_-12px_rgba(11,24,64,0.22)]",
        "border-[#E6EAF7]",
        isRed && "ring-1 ring-[#FECACA]"
      )}
      style={{ ["--i" as string]: animationIndex }}
    >
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[18px] font-extrabold tabular-nums text-[#0B1840]">
          #{token.token_number}
        </span>
        <span className="truncate text-sm font-bold text-[#1A2550]">
          {token.patients?.name ?? "Patient"}
        </span>
        {isRed ? (
          <span className="ml-1 rounded-full bg-[#FEE2E2] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#B91C1C]">
            Red flag
          </span>
        ) : null}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-1">
        {patientChips(token, new Date())}
      </div>

      <p className="mt-1 text-[11px] font-semibold text-[#5C667D]">
        {token.patients?.phone ? (
          <a
            className="inline-flex items-center gap-1 hover:text-[#4F46E5]"
            href={`sms:${token.patients.phone}`}
          >
            <MessageSquare className="h-3 w-3" />
            {token.patients.phone}
          </a>
        ) : (
          <span className="text-[#94A3B8]">No phone</span>
        )}
        {patientMeta(token) ? (
          <span className="text-[#8B97AD]"> · {patientMeta(token)}</span>
        ) : null}
        {status === "waiting" ? (
          <span className="text-[#8B97AD]"> · waited {formatDur(waited)}</span>
        ) : null}
        {status === "serving" ? (
          <span className="text-[#047857]"> · {formatDur(elapsed)} in consult</span>
        ) : null}
        {status === "stepped_out" && holdLeft !== null ? (
          <span className={holdLeft <= 0 ? "text-[#B91C1C]" : "text-[#6D28D9]"}>
            {" "}
            · {holdLeft <= 0 ? "hold expired" : `${formatDur(holdLeft)} left`}
            {token.hold_note ? ` · ${token.hold_note}` : ""}
          </span>
        ) : null}
      </p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {status === "waiting" ? (
          <>
            <MiniLaneBtn
              disabled={isWorking || hasServing}
              onClick={() => onQueueAction("start_consultation", token.id)}
              tone="primary"
              title={hasServing ? "Finish the current consult first" : "Start consultation"}
            >
              Start
            </MiniLaneBtn>
            <MiniLaneBtn disabled={isWorking} onClick={onHold} tone="outline">
              Hold
            </MiniLaneBtn>
            <MiniLaneBtn
              disabled={isWorking}
              onClick={() => onQueueAction("skip", token.id)}
              tone="outline"
            >
              Skip
            </MiniLaneBtn>
          </>
        ) : null}
        {status === "serving" ? (
          <>
            <MiniLaneBtn
              disabled={isWorking}
              onClick={() => onQueueAction("mark_consultation_done", token.id)}
              tone="primary"
            >
              Done
            </MiniLaneBtn>
            <MiniLaneBtn disabled={isWorking} onClick={onHold} tone="outline">
              Hold
            </MiniLaneBtn>
            <MiniLaneBtn
              disabled={isWorking}
              onClick={() => onQueueAction("skip", token.id)}
              tone="outline"
            >
              Skip
            </MiniLaneBtn>
          </>
        ) : null}
        {status === "stepped_out" ? (
          <>
            <MiniLaneBtn
              disabled={isWorking}
              onClick={() => onQueueAction("return_to_waiting", token.id)}
              tone="primary"
            >
              Return to waiting
            </MiniLaneBtn>
            <MiniLaneBtn
              disabled={isWorking}
              onClick={() => onQueueAction("skip", token.id)}
              tone="outline"
            >
              Skip
            </MiniLaneBtn>
          </>
        ) : null}
        {status === "skipped" ? (
          <MiniLaneBtn
            disabled={isWorking}
            onClick={() => onQueueAction("return_to_waiting", token.id)}
            tone="primary"
          >
            Return to waiting
          </MiniLaneBtn>
        ) : null}
        {status === "complete" ? (
          <a
            className="inline-flex items-center gap-1 rounded-full border border-[#E2E8F0] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-[#1A2550] hover:border-[#CBD5E1]"
            href={`/track/${token.id}`}
            rel="noreferrer"
            target="_blank"
          >
            View tracking
          </a>
        ) : null}
      </div>
    </li>
  );
}

/* ---------- Pause dialog ---------- */

type PauseReasonKey = "personal_emergency" | "medical_emergency" | "break" | "other";

const PAUSE_REASONS: Array<{
  key: PauseReasonKey;
  label: string;
  apiReason: "personal_emergency" | "medical_emergency" | "other";
  note: string;
  defaultMinutes: number;
}> = [
  {
    key: "personal_emergency",
    label: "Personal emergency",
    apiReason: "personal_emergency",
    note: "Personal emergency",
    defaultMinutes: 15
  },
  {
    key: "medical_emergency",
    label: "Medical emergency",
    apiReason: "medical_emergency",
    note: "Medical emergency on-site",
    defaultMinutes: 30
  },
  {
    key: "break",
    label: "Break",
    apiReason: "other",
    note: "Doctor on break",
    defaultMinutes: 15
  },
  {
    key: "other",
    label: "Other",
    apiReason: "other",
    note: "",
    defaultMinutes: 15
  }
];

const PAUSE_MINUTE_PRESETS = [15, 30, 60, 120];

function PauseDialog({
  doctorName,
  isWorking,
  onClose,
  onSubmit
}: {
  doctorName: string;
  isWorking: boolean;
  onClose: () => void;
  onSubmit: (v: {
    minutes: number;
    reason: "personal_emergency" | "medical_emergency" | "other";
    note: string;
  }) => void;
}) {
  const [reason, setReason] = useState<PauseReasonKey>("break");
  const [minutes, setMinutes] = useState(15);
  const [otherText, setOtherText] = useState("");

  const preset = PAUSE_REASONS.find((r) => r.key === reason)!;
  const finalNote = reason === "other" ? otherText.trim() : preset.note;
  const canSubmit = minutes >= 1 && minutes <= 240 && finalNote.length >= 1;

  function pickReason(k: PauseReasonKey) {
    setReason(k);
    const r = PAUSE_REASONS.find((x) => x.key === k)!;
    setMinutes(r.defaultMinutes);
  }

  return (
    <ModalShell accent="amber" maxWidth="max-w-lg" onClose={onClose}>
      <ModalHeader
        kicker="Pause queue"
        kickerColor="#B45309"
        onClose={onClose}
        subtitle="Patients already in line stay in position. New check-ins can still arrive but won't be called."
        title={<span className="text-[#0B1840]">{doctorName}</span>}
      />

      <div className="mt-7">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-[#6A7283]">
          Why?
        </p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {PAUSE_REASONS.map((r) => (
            <button
              className={cn(
                "rounded-full border px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition",
                reason === r.key
                  ? "border-[#FDE68A] bg-[linear-gradient(135deg,#FFFBEB_0%,#FEF3C7_100%)] text-[#B45309] shadow-[0_8px_18px_-14px_rgba(245,158,11,0.5)]"
                  : "border-[#E2E8F0] bg-white text-[#1A2550] hover:border-[#CBD5E1]"
              )}
              key={r.key}
              onClick={() => pickReason(r.key)}
              type="button"
            >
              {r.label}
            </button>
          ))}
        </div>
        {reason === "other" ? (
          <input
            autoFocus
            className="mt-3 h-11 w-full rounded-xl border border-[#E2E8F0] bg-white px-3.5 text-sm font-medium text-[#0B1840] placeholder:text-[#94A3B8] focus:border-[#B45309] focus:outline-none focus:ring-2 focus:ring-[#F59E0B]/20"
            onChange={(e) => setOtherText(e.target.value)}
            placeholder="Brief reason"
            value={otherText}
          />
        ) : null}
      </div>

      <div className="mt-6">
        <p className="text-[10.5px] font-bold uppercase tracking-[0.22em] text-[#6A7283]">
          For how long?
        </p>
        <div className="mt-2.5">
          <DurationPicker
            maxMinutes={240}
            minutes={minutes}
            onChange={setMinutes}
            presets={PAUSE_MINUTE_PRESETS}
          />
        </div>
      </div>

      <div className="mt-8 flex items-center justify-between border-t border-[#EEF2F7] pt-5">
        <p className="text-[11px] font-semibold text-[#8B97AD]">
          Queue resumes in <span className="text-[#0B1840]">{formatDur(minutes)}</span>
        </p>
        <div className="flex gap-2">
          <Btn onClick={onClose} tone="ghost">
            Cancel
          </Btn>
          <button
            className="inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#F59E0B_0%,#B45309_100%)] px-5 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-white shadow-[0_14px_28px_-14px_rgba(180,83,9,0.7)] transition hover:-translate-y-[1px] disabled:opacity-50 disabled:hover:translate-y-0"
            disabled={!canSubmit || isWorking}
            onClick={() =>
              onSubmit({ minutes, reason: preset.apiReason, note: finalNote })
            }
            type="button"
          >
            <PauseCircle className="h-3.5 w-3.5" />
            Pause queue
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function MiniLaneBtn({
  children,
  disabled,
  onClick,
  tone,
  title
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  tone: "primary" | "outline";
  title?: string;
}) {
  const cls =
    tone === "primary"
      ? "bg-[linear-gradient(135deg,#6366F1_0%,#4F46E5_100%)] text-white shadow-[0_8px_18px_-14px_rgba(79,70,229,0.7)]"
      : "border border-[#E2E8F0] bg-white text-[#1A2550] hover:border-[#CBD5E1]";
  return (
    <button
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.1em] transition disabled:opacity-50",
        cls
      )}
      disabled={disabled}
      onClick={onClick}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}
