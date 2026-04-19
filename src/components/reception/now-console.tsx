"use client";

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
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
  /** Priority score (higher = shown earlier). Queue-pause is pinned at 100. */
  priority: number;
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

/**
 * Returns a single display token for a patient — honorific-aware first name,
 * so "Mr. Reyansh Gupta" becomes "Reyansh" and long full names never crowd a
 * compact card. Mirrors the logic on the patient tracking and intake screens
 * so the name a patient sees on their SMS matches what reception sees.
 */
const HONORIFICS = new Set([
  "mr",
  "mrs",
  "ms",
  "miss",
  "dr",
  "doctor",
  "prof",
  "sir",
  "shri",
  "smt"
]);
function formatPatientName(name: string | null | undefined): string {
  const normalized = (name ?? "").trim();
  if (!normalized) return "Patient";
  const parts = normalized.replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (parts.length === 0) return "Patient";
  const honorific = parts[0]?.replace(/\./g, "").toLowerCase();
  if (HONORIFICS.has(honorific) && parts.length > 1) {
    return parts[1] ?? "Patient";
  }
  return parts[0] ?? "Patient";
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
  const [paymentTarget, setPaymentTarget] = useState<QueueItem | null>(null);
  const [vitalsTarget, setVitalsTarget] = useState<QueueItem | null>(null);
  const [proximityTarget, setProximityTarget] = useState<QueueItem | null>(null);
  const [insuranceTarget, setInsuranceTarget] = useState<QueueItem | null>(null);
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

  // Warm mutation routes so Next.js dev-mode route compilation doesn't add
  // 2-5 s to the first Pause/Hold/Action click. Each route Zod-validates the
  // body and returns 400 instantly when we send `{}`; the Important Thing is
  // that compiling the route+dependency graph is done before the receptionist
  // actually clicks anything. No-op in production (routes are pre-compiled).
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;
    const warmPaths = [
      "/api/queue/pause",
      "/api/queue/action",
      "/api/checkout/action"
    ];
    warmPaths.forEach((p) => {
      void fetch(p, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store"
      }).catch(() => {
        /* compile-only ping; ignore response */
      });
    });
  }, []);

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

    // 1 · Queue paused — pinned at priority 100 so it's always the top card.
    if (activePause) {
      items.push({
        id: `pause-${activePause.id}`,
        severity: "amber",
        priority: 100,
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
      // LLM-ish weighting: expired holds beat active holds; shorter remaining
      // time is more urgent. Caps below queue-pause, above red flags.
      const score = expired ? 88 : 82 - Math.min(12, Math.floor(mins / 5));
      items.push({
        id: `held-${t.id}`,
        severity: "amber",
        priority: score,
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
        // Red flags weight by how long the patient has been waiting — someone
        // with chest pain who's been there 25 min is higher priority than a
        // fresh check-in.
        const waited = minutesSince(t.checked_in_at);
        const score = 70 + Math.min(15, Math.floor(waited / 5));
        items.push({
          id: `red-${t.id}`,
          severity: "red",
          priority: score,
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
          priority: 55,
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
        priority: 48,
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
        priority: 20,
        title: `On hold — #${t.token_number} ${name}`,
        detail: `${formatDur(mins)} left${t.hold_note ? ` · ${t.hold_note}` : ""}`,
        primary: {
          label: "Return to waiting",
          run: () => runAction("return_to_waiting", t.id)
        },
        secondary: { label: "Skip", run: () => runAction("skip", t.id) }
      });
    });

    return items
      .filter((i) => !dismissed.has(i.id))
      .sort((a, b) => b.priority - a.priority);
  }, [queue, heldList, activePause, dismissed, doctorName]);

  // Top 3 go to the Action Center card; the rest spill into the Actions
  // metric pill and the overflow modal behind it.
  const ACTION_CENTER_MAX = 3;
  const needsYouTop = needsYou.slice(0, ACTION_CENTER_MAX);
  const needsYouOverflow = needsYou.slice(ACTION_CENTER_MAX);

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
    <section className="relative flex h-[100dvh] flex-col overflow-hidden bg-[#FBFBFD] px-5 pb-3 pt-5 sm:px-8 sm:pb-4">
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
            clinicName={clinic?.name ?? "the clinic"}
            isWorking={isWorking}
            onCollectPayment={(t) => setPaymentTarget(t)}
            onDone={(id) => runAction("mark_consultation_done", id)}
            onHold={() => currentServing && setHoldTarget(currentServing)}
            onOpenInsurance={(t) => setInsuranceTarget(t)}
            onOpenProximity={(t) => setProximityTarget(t)}
            onOpenVitals={(t) => setVitalsTarget(t)}
            onSkip={(id) => runAction("skip", id)}
            token={currentServing}
          />
          <NextCard
            token={nextWaiting}
            clinicName={clinic?.name ?? "the clinic"}
            upcoming={upcomingAfterNext}
            isWorking={isWorking || Boolean(currentServing)}
            behind={Math.max(0, waitingList.length - 1)}
            onCollectPayment={(t) => setPaymentTarget(t)}
            onOpenInsurance={(t) => setInsuranceTarget(t)}
            onOpenProximity={(t) => setProximityTarget(t)}
            onOpenVitals={(t) => setVitalsTarget(t)}
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
            isWorking={isWorking}
            items={needsYouTop}
            onDismiss={(id) => setDismissed((d) => new Set(d).add(id))}
            overflowItems={needsYouOverflow}
          />
        </div>

        <div className="mt-4 shrink-0">
          <PranaBar
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

      {paymentTarget ? (
        <PaymentDialog
          token={paymentTarget}
          onClose={() => setPaymentTarget(null)}
        />
      ) : null}

      {vitalsTarget ? (
        <VitalsDialog
          token={vitalsTarget}
          onClose={() => setVitalsTarget(null)}
        />
      ) : null}

      {proximityTarget ? (
        <ProximityDialog
          clinicName={clinic?.name ?? "the clinic"}
          token={proximityTarget}
          onClose={() => setProximityTarget(null)}
        />
      ) : null}

      {insuranceTarget ? (
        <InsuranceDialog
          token={insuranceTarget}
          onClose={() => setInsuranceTarget(null)}
          onCollectCopay={() => {
            const t = insuranceTarget;
            setInsuranceTarget(null);
            setPaymentTarget(t);
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

type PranaAmberMarkProps = {
  activationKey?: number;
  thinking?: boolean;
  ripple?: boolean;
  boxSize?: number;
  glyphSize?: number;
  className?: string;
};

function PranaAmberMark({
  activationKey = 0,
  thinking = false,
  ripple = false,
  boxSize = 48,
  glyphSize = 20,
  className
}: PranaAmberMarkProps) {
  const gradientId = useId().replace(/:/g, "");
  // Legacy sun-wheel spokes — retained below for reference only; the static
  // symbol now uses the Padma-Bindu (lotus+bindu), defined further down.
  const spokes = [
    { angle: 0, y: -10.1, length: 5.1, width: 1.9, opacity: 0.94 },
    { angle: 43, y: -9.6, length: 4.4, width: 1.8, opacity: 0.86 },
    { angle: 89, y: -10.4, length: 5.4, width: 1.85, opacity: 0.98 },
    { angle: 133, y: -9.3, length: 4.2, width: 1.72, opacity: 0.83 },
    { angle: 180, y: -9.9, length: 4.8, width: 1.9, opacity: 0.92 },
    { angle: 224, y: -9.2, length: 4.3, width: 1.76, opacity: 0.81 },
    { angle: 271, y: -10.2, length: 5.2, width: 1.84, opacity: 0.96 },
    { angle: 316, y: -9.4, length: 4.5, width: 1.78, opacity: 0.85 }
  ] as const;

  return (
    <span
      aria-hidden
      className={cn("relative inline-flex items-center justify-center", className)}
      style={{ width: boxSize, height: boxSize }}
    >
      {/* Outer ambient halo — breathing, extends beyond the box so the orb
          feels like a presence, not a clipped icon. */}
      <span
        className="qcare-prana-idle absolute inset-[-6%] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(251,191,36,0.28) 0%, rgba(245,158,11,0.18) 30%, rgba(217,119,6,0.08) 52%, rgba(120,53,15,0.02) 72%, transparent 86%)"
        }}
      />

      {thinking ? (
        <span
          className="qcare-prana-thinking-halo absolute inset-[-18%] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(251,191,36,0.28) 0%, rgba(245,158,11,0.17) 40%, rgba(217,119,6,0.06) 62%, transparent 78%)"
          }}
        />
      ) : null}

      {ripple && activationKey > 0 ? (
        <span
          className="qcare-prana-ripple absolute inset-[6%] rounded-full border border-[#FBBF24]/65"
          key={`prana-ripple-${activationKey}`}
        />
      ) : null}

      {/* Glass amber sphere — the orb body. Translucent, like amber resin or
          honey suspended in glass. Every opacity is kept well below 0.5 so
          the background of the page (cards, panels) bleeds through, tying the
          orb into the room rather than sitting on top of it. */}
      <span
        className={cn(
          "absolute inset-[8%] rounded-full",
          activationKey > 0 && "qcare-prana-sphere-lift"
        )}
        key={`prana-sphere-${activationKey || "rest"}`}
        style={{
          background:
            "radial-gradient(circle at 30% 24%, rgba(255,245,210,0.46) 0%, rgba(253,230,138,0.3) 24%, rgba(251,191,36,0.2) 52%, rgba(217,119,6,0.15) 80%, rgba(180,83,9,0.18) 100%)",
          boxShadow:
            "inset 0 2px 6px rgba(255,251,235,0.65), inset 0 -5px 14px rgba(146,64,14,0.18), 0 0 24px rgba(245,158,11,0.4), 0 0 52px rgba(245,158,11,0.2)"
        }}
      />

      {/* Warm interior glow — a very gentle amber wash at the heart of the
          sphere. Replaces the old opaque dark ember so the orb is luminous
          all the way through, not pierced by a black dot. */}
      <span
        aria-hidden
        className="absolute inset-[28%] rounded-full"
        style={{
          background:
            "radial-gradient(circle at 42% 38%, rgba(253,230,138,0.32) 0%, rgba(251,191,36,0.18) 55%, rgba(217,119,6,0.08) 100%)"
        }}
      />

      <span
        className={cn(
          "relative flex items-center justify-center",
          activationKey > 0 && "qcare-prana-ignite"
        )}
        key={`prana-activate-${activationKey || "rest"}`}
        style={{ width: glyphSize, height: glyphSize }}
      >
        <span
          className={cn("relative flex items-center justify-center", thinking && "qcare-prana-thinking")}
          style={{ width: glyphSize, height: glyphSize }}
        >
          {/* Padma-Bindu — five lotus petals radiating from a luminous central
              Bindu. Five for the Pancha-Prāṇa (Prāna, Apāna, Vyāna, Udāna,
              Samāna). The Bindu is the seed of consciousness that animates all
              five. Translucent amber gradient so it reads like a jewel, not a
              logo. */}
          <svg
            fill="none"
            height={glyphSize}
            viewBox="0 0 24 24"
            width={glyphSize}
          >
            <defs>
              <linearGradient
                id={`${gradientId}-petal`}
                x1="12"
                x2="12"
                y1="2"
                y2="12"
              >
                <stop offset="0%" stopColor="#FFF4E5" stopOpacity="0.95" />
                <stop offset="40%" stopColor="#FBBF24" stopOpacity="0.85" />
                <stop offset="100%" stopColor="#D97706" stopOpacity="0.6" />
              </linearGradient>
              <radialGradient
                id={`${gradientId}-bindu`}
                cx="0.5"
                cy="0.5"
                r="0.5"
              >
                <stop offset="0%" stopColor="#FFF4E5" stopOpacity="1" />
                <stop offset="45%" stopColor="#FCD34D" stopOpacity="0.98" />
                <stop offset="100%" stopColor="#D97706" stopOpacity="0.85" />
              </radialGradient>
            </defs>
            <g transform="translate(12 12)">
              {/* Five petals at 72° intervals — pancha-prāṇa */}
              {[0, 72, 144, 216, 288].map((angle) => (
                <g key={angle} transform={`rotate(${angle})`}>
                  {/* Petal body — translucent amber almond */}
                  <path
                    d="M 0 -2.6 C 1.7 -3.7 2.4 -6.8 0 -10 C -2.4 -6.8 -1.7 -3.7 0 -2.6 Z"
                    fill={`url(#${gradientId}-petal)`}
                  />
                  {/* Light edge on one side — the glint that makes it read
                      as a 3D petal, not a flat shape */}
                  <path
                    d="M 0 -2.6 C 1.7 -3.7 2.4 -6.8 0 -10"
                    fill="none"
                    stroke="#FEF3C7"
                    strokeOpacity="0.55"
                    strokeWidth="0.35"
                  />
                </g>
              ))}
              {/* Subtle inner ring — faintest contour around the bindu */}
              <circle
                cx="0"
                cy="0"
                fill="none"
                r="2.8"
                stroke="#FEF3C7"
                strokeOpacity="0.22"
                strokeWidth="0.35"
              />
              {/* The Bindu — seed of consciousness, the one luminous dot */}
              <circle cx="0" cy="0" fill={`url(#${gradientId}-bindu)`} r="1.9" />
              {/* Inner hottest point */}
              <circle cx="-0.35" cy="-0.35" fill="#FFFBEB" opacity="0.9" r="0.6" />
            </g>
          </svg>
        </span>
      </span>
    </span>
  );
}

/* ============================================================
   Activation waveform — a luminous amber ECG pulse that draws
   across the dark bar when Prāṇa is summoned. Mimics the hero
   visualization from the reference: a quiet baseline, a sharp
   twin peak at the heart of the filament, trails dissolving to
   the left and right. Three stacked strokes (wide/soft glow →
   mid glow → crisp line) give it that volumetric "light in a
   vacuum" quality.
   ============================================================ */
function PranaActivationWave() {
  // ECG-style pulse path: long baseline approaching the peak, two sharp
  // inflections (rise + dip), then baseline trailing out. Drawn on a
  // non-uniformly scaled viewBox so it fills any bar width.
  const path =
    "M 0 50 L 200 50 C 215 50 222 50 230 30 C 236 14 242 14 248 50 C 254 86 260 86 266 50 C 272 40 278 50 286 50 L 600 50";
  return (
    <svg
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
      preserveAspectRatio="none"
      viewBox="0 0 600 100"
    >
      <defs>
        <linearGradient
          id="prana-wave-gradient"
          x1="0"
          x2="1"
          y1="0"
          y2="0"
        >
          <stop offset="0%" stopColor="#D97706" stopOpacity="0" />
          <stop offset="18%" stopColor="#F59E0B" stopOpacity="0.55" />
          <stop offset="35%" stopColor="#FBBF24" stopOpacity="0.95" />
          <stop offset="50%" stopColor="#F59E0B" stopOpacity="1" />
          <stop offset="65%" stopColor="#FBBF24" stopOpacity="0.95" />
          <stop offset="82%" stopColor="#F59E0B" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#D97706" stopOpacity="0" />
        </linearGradient>
        <filter
          height="200%"
          id="prana-wave-softglow"
          width="140%"
          x="-20%"
          y="-50%"
        >
          <feGaussianBlur stdDeviation="6" />
        </filter>
        <filter
          height="200%"
          id="prana-wave-midglow"
          width="140%"
          x="-20%"
          y="-50%"
        >
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      {/* Outer halo pass — soft blurred bloom */}
      <path
        className="qcare-prana-wave-draw"
        d={path}
        fill="none"
        filter="url(#prana-wave-softglow)"
        opacity="0.6"
        pathLength="1"
        stroke="url(#prana-wave-gradient)"
        strokeDasharray="1"
        strokeDashoffset="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="5"
      />
      {/* Medium pass — glowing body */}
      <path
        className="qcare-prana-wave-draw"
        d={path}
        fill="none"
        filter="url(#prana-wave-midglow)"
        pathLength="1"
        stroke="url(#prana-wave-gradient)"
        strokeDasharray="1"
        strokeDashoffset="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
      />
      {/* Crisp filament line on top */}
      <path
        className="qcare-prana-wave-draw"
        d={path}
        fill="none"
        pathLength="1"
        stroke="url(#prana-wave-gradient)"
        strokeDasharray="1"
        strokeDashoffset="1"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.25"
      />
    </svg>
  );
}

/* ============================================================
   OPTION B — PranaBar: ambient horizontal bar.
   A horizontal presence at the bottom of the page. Soft, glassy,
   borderless input. A small breathing mini-orb stands in for the
   old "Co-pilot" chip, so Prāṇa reads as *a voice waiting to speak*
   rather than a labelled feature.
   ============================================================ */
function PranaBar({
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
  const [focused, setFocused] = useState(false);
  const [answer, setAnswer] = useState<CoPilotAnswer | null>(null);
  const [asking, setAsking] = useState(false);
  const [wakeKey, setWakeKey] = useState(0);
  const { results, loading } = usePatientSearch(value);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Every time the user summons Prāṇa (focused false → true), re-key the
  // wake animation so the orb "inhales" visibly — swell, bloom, settle.
  useEffect(() => {
    if (focused) setWakeKey((k) => k + 1);
  }, [focused]);

  // Click outside collapses the surface
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setFocused(false);
        setAnswer(null);
      }
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

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
        answer: "Sorry — Prāṇa couldn't answer that right now.",
        patient: null,
        actions: []
      }
    );
  }

  const trimmed = value.trim();
  const isQuestion = looksLikeQuestion(trimmed);
  const showResults = trimmed.length >= 2 && !isQuestion && !answer && !asking;
  const showSuggestions = focused && trimmed.length === 0 && !answer && !asking;
  const showSurface = focused || answer || asking;

  function submit() {
    const q = value.trim();
    if (!q) return;
    if (looksLikeQuestion(q)) {
      void askQuestion(q);
      return;
    }
    const phone = q.replace(/[^\d+]/g, "");
    if (phone.length >= 7) onSubmitPhone(phone);
    else if (/^(new|add|walk)/i.test(q)) onSubmitNewPatient();
    else if (results.length === 1) onPickPatient(results[0]);
  }

  const SUGGESTIONS: Array<{ label: string; q: string }> = [
    { label: "Any red flags right now?", q: "Any red flags right now?" },
    { label: "Who has been waiting longest?", q: "Who has been waiting the longest?" },
    { label: "Add walk-in", q: "new" }
  ];

  return (
    <div className="relative" ref={wrapperRef}>
        {/* ---------- Floating rich surface — translucent amber glass ---------- */}
        {showSurface ? (
          <div
            className="qcare-modal-in absolute bottom-full left-0 right-0 mb-3 overflow-hidden rounded-[32px] border border-[#F59E0B]/30 bg-white/85 shadow-[0_40px_80px_-20px_rgba(217,119,6,0.45),0_0_100px_-24px_rgba(245,158,11,0.35)] backdrop-blur-2xl"
            style={{ transformOrigin: "50% 100%" }}
          >
            {/* ambient amber top wash */}
            <span
              aria-hidden
              className="pointer-events-none absolute -top-24 left-1/2 h-[320px] w-[320px] -translate-x-1/2 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(245,158,11,0.26) 0%, rgba(217,119,6,0.08) 45%, rgba(245,158,11,0) 78%)"
              }}
            />
            {/* bronze side wash right */}
            <span
              aria-hidden
              className="pointer-events-none absolute -right-16 top-1/3 h-[220px] w-[220px] rounded-full"
              style={{
                background:
                  "radial-gradient(circle, rgba(217,119,6,0.2) 0%, rgba(180,83,9,0.06) 45%, transparent 75%)"
              }}
            />
            <div className="relative p-5">
              {/* Header — mini orb + greeting */}
              <div className="flex items-center gap-3">
                <PranaAmberMark
                  activationKey={wakeKey}
                  boxSize={42}
                  className="shrink-0"
                  glyphSize={18}
                  thinking={asking}
                />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-[#B45309]">
                    Prāṇa
                  </p>
                  <p className="text-[11px] font-semibold text-[#78716C]">
                    {asking
                      ? "Thinking…"
                      : answer
                        ? "Here's what I found."
                        : showResults
                          ? "Matching patients"
                          : "How can I help?"}
                  </p>
                </div>
                {asking ? (
                  <div className="ml-auto flex items-center gap-1">
                    {[0, 1, 2].map((i) => (
                      <span
                        className="h-1.5 w-1.5 rounded-full bg-[#D97706] shadow-[0_0_8px_rgba(217,119,6,0.55)]"
                        key={i}
                        style={{
                          animation: "qcareBreathe 1s ease-in-out infinite",
                          animationDelay: `${i * 140}ms`
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Suggestions — empty focused state */}
              {showSuggestions ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((s, i) => (
                    <button
                      className="qcare-list-item-in group/s inline-flex items-center gap-1.5 rounded-full border border-[#FDE68A] bg-white/70 px-3.5 py-1.5 text-[12px] font-semibold text-[#B45309] transition-all duration-300 hover:-translate-y-[1px] hover:border-[#FCD34D] hover:bg-[#FFFBEB] hover:shadow-[0_10px_22px_-10px_rgba(217,119,6,0.5)]"
                      key={s.label}
                      onClick={() => {
                        onChange(s.q);
                        window.setTimeout(() => {
                          if (looksLikeQuestion(s.q)) void askQuestion(s.q);
                          else if (/^(new|add|walk)/i.test(s.q)) onSubmitNewPatient();
                        }, 0);
                      }}
                      style={{ ["--i" as string]: i } as React.CSSProperties}
                      type="button"
                    >
                      <span>{s.label}</span>
                      <ChevronRight className="h-3 w-3 transition-transform duration-200 group-hover/s:translate-x-0.5" />
                    </button>
                  ))}
                </div>
              ) : null}

              {/* Inline search results */}
              {showResults ? (
                <div className="mt-3 max-h-[44vh] overflow-y-auto rounded-2xl border border-[#FDE68A] bg-white/70 p-1.5">
                  {loading ? (
                    <p className="px-3 py-3 text-sm font-medium text-[#8B97AD]">
                      Searching…
                    </p>
                  ) : results.length === 0 ? (
                    <div className="flex items-center justify-between gap-2 px-3 py-2">
                      <p className="text-sm font-medium text-[#8B97AD]">
                        No patient found.
                      </p>
                      <button
                        className="rounded-full bg-[linear-gradient(135deg,#F59E0B_0%,#D97706_55%,#B45309_100%)] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_8px_18px_-14px_rgba(217,119,6,0.7)]"
                        onClick={() => {
                          setFocused(false);
                          onSubmitNewPatient();
                        }}
                        type="button"
                      >
                        Check-in new
                      </button>
                    </div>
                  ) : (
                    <ul className="grid gap-1">
                      {results.slice(0, 6).map((r, i) => (
                        <li
                          className="qcare-list-item-in"
                          key={r.id}
                          style={{ ["--i" as string]: i } as React.CSSProperties}
                        >
                          <button
                            className="flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left transition hover:bg-[#FFFBEB]"
                            onClick={() => {
                              setFocused(false);
                              onPickPatient(r);
                            }}
                            type="button"
                          >
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-[#0B1840]">
                                {r.name}
                                <span className="ml-2 text-[11px] font-semibold text-[#8B97AD]">
                                  {r.phone}
                                </span>
                              </p>
                              <p className="mt-0.5 text-[11px] font-medium text-[#6A7283]">
                                {r.totalVisits} visit
                                {r.totalVisits === 1 ? "" : "s"}
                                {r.todayToken ? (
                                  <span className="ml-2 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#047857]">
                                    Today #{r.todayToken.token_number} ·{" "}
                                    {r.todayToken.status}
                                  </span>
                                ) : null}
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-[#94A3B8]" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ) : null}

              {/* Answer */}
              {answer ? (
                <div className="qcare-list-item-in mt-3 rounded-2xl border border-[#FDE68A] bg-[linear-gradient(145deg,#FFFEF8_0%,#FEF3C7_100%)] p-4">
                  <p className="text-sm font-bold leading-snug text-[#0B1840]">
                    {answer.answer}
                  </p>
                  {answer.patient ? (
                    <button
                      className="mt-3 flex w-full items-center justify-between gap-2 rounded-2xl border border-[#FDE68A] bg-white px-3 py-2 text-left transition hover:border-[#FCD34D] hover:bg-[#FFFBEB]"
                      onClick={() => {
                        const p = answer.patient!;
                        setAnswer(null);
                        setFocused(false);
                        onPickPatient(p);
                      }}
                      type="button"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold text-[#0B1840]">
                          {answer.patient.name}
                          <span className="ml-2 text-[11px] font-semibold text-[#8B97AD]">
                            {answer.patient.phone}
                          </span>
                        </p>
                        <p className="mt-0.5 text-[11px] font-medium text-[#6A7283]">
                          {answer.patient.totalVisits} visit
                          {answer.patient.totalVisits === 1 ? "" : "s"}
                          {answer.patient.todayToken ? (
                            <span className="ml-2 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#047857]">
                              Today #{answer.patient.todayToken.token_number} ·{" "}
                              {answer.patient.todayToken.status}
                            </span>
                          ) : null}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-[#8B97AD]" />
                    </button>
                  ) : null}
                  {answer.actions.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {answer.actions.map((a) => (
                        <button
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#FDE68A] bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-[#B45309] transition hover:-translate-y-[1px] hover:border-[#FCD34D] hover:bg-[#FFFBEB]"
                          key={a.label}
                          onClick={() => {
                            setAnswer(null);
                            setFocused(false);
                            onAnswerAction(a);
                          }}
                          type="button"
                        >
                          {a.kind === "call" ? <Phone className="h-3 w-3" /> : null}
                          {a.kind === "checkin" ? (
                            <UserPlus className="h-3 w-3" />
                          ) : null}
                          {a.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {showSuggestions || answer ? (
                <p className="mt-4 text-center text-[10px] font-bold uppercase tracking-[0.28em] text-[#B4966A]">
                  Enter to send · Esc to close
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {/* ---------- The bar itself — translucent amber glass ---------- */}
        <div
          className="group/bar relative flex cursor-text items-center gap-4 overflow-hidden rounded-[28px] border border-[#F59E0B]/30 bg-white/75 p-3 shadow-[0_24px_48px_-24px_rgba(217,119,6,0.32)] backdrop-blur-xl transition-all duration-500 focus-within:border-[#F59E0B]/55 focus-within:bg-white/85 focus-within:shadow-[0_30px_60px_-22px_rgba(217,119,6,0.5),0_0_90px_-28px_rgba(245,158,11,0.45)]"
          onClick={() => {
            setFocused(true);
            inputRef.current?.focus();
          }}
        >
          {/* Soft amber wash from left — golden-hour sunlight through glass */}
          <span
            aria-hidden
            className="pointer-events-none absolute -left-20 top-1/2 h-[220px] w-[220px] -translate-y-1/2 opacity-55 transition-opacity duration-700 group-focus-within/bar:opacity-100"
            style={{
              background:
                "radial-gradient(circle, rgba(245,158,11,0.26) 0%, rgba(245,158,11,0.08) 42%, transparent 72%)"
            }}
          />
          {/* Bronze wash from the right */}
          <span
            aria-hidden
            className="pointer-events-none absolute -right-20 top-1/2 h-[200px] w-[200px] -translate-y-1/2 opacity-35 transition-opacity duration-700 group-focus-within/bar:opacity-75"
            style={{
              background:
                "radial-gradient(circle, rgba(217,119,6,0.22) 0%, rgba(180,83,9,0.06) 42%, transparent 72%)"
            }}
          />

          {/* Amber floor bloom — pulses outward on activation, now softer to
              match the translucent bar */}
          {wakeKey > 0 ? (
            <span
              aria-hidden
              className="qcare-prana-amber-bloom pointer-events-none absolute left-0 top-1/2 h-[240px] w-[240px] -translate-y-1/2 rounded-full"
              key={`bloom-${wakeKey}`}
              style={{
                background:
                  "radial-gradient(circle, rgba(253,230,138,0.45) 0%, rgba(251,191,36,0.22) 32%, rgba(245,158,11,0.1) 58%, transparent 82%)"
              }}
            />
          ) : null}

          {/* Activation waveform — draws out, peaks, dissolves */}
          {wakeKey > 0 ? (
            <PranaActivationWave key={`wave-${wakeKey}`} />
          ) : null}

          <PranaAmberMark
            activationKey={wakeKey}
            boxSize={56}
            className="shrink-0"
            glyphSize={22}
            ripple
            thinking={asking}
          />

          <input
            className="relative h-11 flex-1 border-0 bg-transparent px-1 text-[15px] font-medium tracking-[0.005em] text-[#0B1840] caret-[#D97706] outline-none placeholder:text-[#A89072] focus:ring-0"
            onChange={(e) => {
              onChange(e.target.value);
              if (!focused) setFocused(true);
            }}
            onFocus={() => setFocused(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                submit();
                return;
              }
              if (e.key === "Escape") {
                setFocused(false);
                setAnswer(null);
                (e.currentTarget as HTMLInputElement).blur();
              }
            }}
            placeholder="Ask Prāṇa, or type a phone / name…"
            ref={inputRef}
            value={value}
          />
          {asking ? (
            <span className="relative flex items-center gap-1 pr-1.5">
              {[0, 1, 2].map((i) => (
                <span
                  className="h-1.5 w-1.5 rounded-full bg-[#D97706] shadow-[0_0_8px_rgba(217,119,6,0.55)]"
                  key={i}
                  style={{
                    animation: "qcareBreathe 1s ease-in-out infinite",
                    animationDelay: `${i * 140}ms`
                  }}
                />
              ))}
            </span>
          ) : null}
        </div>
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
  onClick,
  pulse
}: {
  label: string;
  value: number;
  color: string;
  tint: string;
  onClick?: () => void;
  pulse?: boolean;
}) {
  return (
    <button
      className={cn(
        "group relative overflow-hidden rounded-2xl border px-5 py-2.5 text-center shadow-[0_14px_28px_-18px_rgba(11,24,64,0.28)] min-w-[96px] transition-all duration-200 ease-out hover:-translate-y-[2px] hover:shadow-[0_22px_40px_-14px_rgba(11,24,64,0.4)] focus:outline-none focus:ring-2 focus:ring-[#4F46E5]/30",
        pulse && "qcare-breathe"
      )}
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
  tone = "emerald",
  hideMeta = false
}: {
  token: QueueItem;
  tone?: "emerald" | "indigo" | "sky" | "violet";
  hideMeta?: boolean;
}) {
  const phone = token.patients?.phone ?? null;
  const meta = patientMeta(token);
  const pillCls =
    tone === "emerald"
      ? "border-[#BBF7D0] text-[#047857] hover:bg-[#F0FDF4] hover:border-[#86EFAC] hover:shadow-[0_8px_20px_-10px_rgba(16,185,129,0.55)]"
      : tone === "indigo"
        ? "border-[#C7D2FE] text-[#4F46E5] hover:bg-[#EEF2FF] hover:border-[#A5B4FC] hover:shadow-[0_8px_20px_-10px_rgba(99,102,241,0.55)]"
        : tone === "sky"
          ? "border-[#BAE6FD] text-[#0369A1] hover:bg-[#F0F9FF] hover:border-[#7DD3FC] hover:shadow-[0_8px_20px_-10px_rgba(14,165,233,0.5)]"
          : "border-[#E9D5FF] text-[#7E22CE] hover:bg-[#FAF5FF] hover:border-[#D8B4FE] hover:shadow-[0_8px_20px_-10px_rgba(168,85,247,0.5)]";

  if (!phone) {
    return (
      <div className="mt-2 text-[11px] font-semibold text-[#94A3B8]">
        No phone on file
        {!hideMeta && meta ? <span className="ml-1 text-[#8B97AD]">· {meta}</span> : null}
      </div>
    );
  }
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <a
        aria-label="Send SMS"
        className={cn(
          "group/ctn inline-flex items-center gap-1.5 rounded-full border bg-white/90 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] transition-all duration-200 hover:-translate-y-[1px]",
          pillCls
        )}
        href={`sms:${phone}`}
        title="Send SMS"
      >
        <MessageSquare className="h-4 w-4 shrink-0 transition-transform duration-300 ease-out group-hover/ctn:-rotate-6 group-hover/ctn:scale-[1.35]" />
        Text
      </a>
      <a
        aria-label="Call"
        className={cn(
          "group/ctn inline-flex items-center gap-1.5 rounded-full border bg-white/90 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.12em] transition-all duration-200 hover:-translate-y-[1px]",
          pillCls
        )}
        href={`tel:${phone}`}
        title="Call"
      >
        <Phone className="h-4 w-4 shrink-0 transition-transform duration-300 ease-out group-hover/ctn:rotate-[-12deg] group-hover/ctn:scale-[1.35]" />
        Call
      </a>
      {!hideMeta && meta ? (
        <span className="ml-1 text-[10px] font-semibold text-[#8B97AD]">{meta}</span>
      ) : null}
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
  clinicName,
  isWorking,
  onDone,
  onHold,
  onSkip,
  onCollectPayment,
  onOpenVitals,
  onOpenProximity,
  onOpenInsurance
}: {
  token: QueueItem | null;
  clinicName: string;
  isWorking: boolean;
  onDone: (id: string) => void;
  onHold: () => void;
  onSkip: (id: string) => void;
  onCollectPayment: (token: QueueItem) => void;
  onOpenVitals: (token: QueueItem) => void;
  onOpenProximity: (token: QueueItem) => void;
  onOpenInsurance: (token: QueueItem) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [brief, setBrief] = useState<PatientBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const patientId = token?.patient_id ?? null;
  const frontRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const flipMountedRef = useRef(false);

  useEffect(() => {
    setFlipped(false);
    setBrief(null);
  }, [token?.id]);

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

  useEffect(() => {
    if (!flipMountedRef.current) {
      flipMountedRef.current = true;
      return;
    }
    setIsFlipping(true);
    const t = window.setTimeout(() => setIsFlipping(false), 620);
    return () => window.clearTimeout(t);
  }, [flipped]);

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

  // Cursor hologram — emerald glow matching the card palette
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const host = frontRef.current;
    const orb = orbRef.current;
    if (!host || !orb) return;
    const rect = host.getBoundingClientRect();
    orb.style.transform = `translate3d(${e.clientX - rect.left - 130}px, ${
      e.clientY - rect.top - 130
    }px, 0)`;
    orb.style.opacity = "1";
  }
  function onPointerLeave() {
    if (orbRef.current) orbRef.current.style.opacity = "0";
  }

  if (!token) {
    return (
      <div className="flex h-full min-h-[260px] flex-col rounded-[28px] border border-[#BBF7D0] bg-[linear-gradient(145deg,#F0FDF4_0%,#DCFCE7_55%,#FFFFFF_100%)] px-5 py-4 shadow-[0_20px_40px_-24px_rgba(16,185,129,0.22)] backdrop-blur-xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#047857]">
          With doctor
        </p>
        <p className="my-auto text-center text-sm font-semibold text-[#8B97AD]">
          Nobody in consultation right now.
        </p>
      </div>
    );
  }

  const elapsed = minutesSince(token.serving_started_at ?? token.checked_in_at);
  const complaint = token.raw_complaint?.trim() ?? "";
  const complaintIsRedFlag = complaint ? RED_FLAG_RE.test(complaint) : false;

  return (
    <div className="group h-full [perspective:1400px]">
      <div
        className={cn(
          "h-full transition-transform duration-200 ease-out hover:-translate-y-[2px]",
          isFlipping && "qcare-flip-lift"
        )}
      >
      <div
        className={cn(
          "relative h-full [transform-style:preserve-3d] transition-transform duration-[520ms] will-change-transform [transition-timing-function:cubic-bezier(0.4,0,0.2,1)]",
          flipped && "[transform:rotateY(180deg)]"
        )}
      >
        {/* FRONT */}
        <div
          className="relative flex h-full flex-col overflow-hidden rounded-[28px] border border-[#BBF7D0] bg-[linear-gradient(145deg,#F0FDF4_0%,#DCFCE7_55%,#FFFFFF_100%)] px-5 py-4 shadow-[0_20px_40px_-22px_rgba(16,185,129,0.4)] backdrop-blur-xl transition-shadow duration-200 group-hover:shadow-[0_28px_56px_-18px_rgba(16,185,129,0.55)] [backface-visibility:hidden]"
          onPointerLeave={onPointerLeave}
          onPointerMove={onPointerMove}
          ref={frontRef}
        >
          {/* Cursor spotlight — emerald ambient glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-0 h-[260px] w-[260px] opacity-0 transition-opacity duration-300 ease-out"
            ref={orbRef}
            style={{
              background:
                "radial-gradient(circle, rgba(16,185,129,0.2) 0%, rgba(16,185,129,0.08) 35%, rgba(16,185,129,0) 70%)",
              willChange: "transform, opacity"
            }}
          />

          <div className="relative z-10 flex h-full min-h-0 flex-col">
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Header — kicker + elapsed pill */}
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#047857]">
                With doctor
              </p>
              <span className="qcare-breathe inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#DCFCE7_0%,#BBF7D0_100%)] px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#047857] ring-1 ring-[#86EFAC]">
                <Clock className="h-3 w-3" />
                <span className="opacity-70">serving</span>
                <span className="tabular-nums">{formatDur(elapsed)}</span>
              </span>
            </div>

            {/* Name hero — same grammar as NextCard */}
            <button
              aria-expanded={flipped}
              className="group/name relative mt-2 flex items-baseline gap-2 text-left"
              onClick={() => setFlipped(true)}
              title="Show briefing"
              type="button"
            >
              <span
                className="relative min-w-0 flex-1 truncate text-[22px] font-extrabold leading-[1.1] tracking-[-0.02em] text-[#0B1840] transition-[letter-spacing] duration-300 ease-out group-hover/name:tracking-[-0.025em]"
                title={token.patients?.name ?? undefined}
              >
                {formatPatientName(token.patients?.name)}
                {patientMeta(token) ? (
                  <span className="ml-2 text-[12px] font-semibold tracking-normal text-[#6A7283]">
                    {patientMeta(token)}
                  </span>
                ) : null}
                <span
                  aria-hidden
                  className="absolute -bottom-0.5 left-0 h-[2px] w-0 rounded-full bg-[linear-gradient(90deg,#10B981_0%,#6EE7B7_100%)] transition-[width] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/name:w-full"
                />
              </span>
              <span className="shrink-0 rounded-md bg-white/70 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] tabular-nums text-[#047857] ring-1 ring-[#BBF7D0] transition-colors duration-300 group-hover/name:bg-[#F0FDF4] group-hover/name:ring-[#86EFAC]">
                #{token.token_number}
              </span>
              <ChevronRight
                aria-hidden
                className="h-4 w-4 shrink-0 self-center text-[#6EE7B7] transition-all duration-300 ease-out group-hover/name:translate-x-1 group-hover/name:text-[#047857]"
              />
            </button>

            {/* Readiness indicators (tappable) */}
            <PreflightRow
              onFixProximity={() => onOpenProximity(token)}
              onFixVitals={() => onOpenVitals(token)}
              onInsurance={() =>
                token.patients?.insurance_provider
                  ? onOpenInsurance(token)
                  : onCollectPayment(token)
              }
              token={token}
            />

            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              {patientChips(token, new Date())}
            </div>

            <ContactLine hideMeta token={token} tone="emerald" />

            {/* Here for — the *why*, same block as NextCard */}
            {complaint ? (
              <div
                className={cn(
                  "mt-3 rounded-2xl border px-4 py-3.5 backdrop-blur-sm",
                  complaintIsRedFlag
                    ? "border-[#FECACA] bg-[#FFF5F5]/90 shadow-[0_10px_24px_-14px_rgba(185,28,28,0.35)]"
                    : "border-white/90 bg-white/85 shadow-[0_10px_24px_-16px_rgba(16,185,129,0.28)]"
                )}
              >
                <div className="flex items-center gap-1.5">
                  {complaintIsRedFlag ? (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#B91C1C]" />
                  ) : null}
                  <p
                    className={cn(
                      "text-[10px] font-bold uppercase tracking-[0.2em]",
                      complaintIsRedFlag ? "text-[#B91C1C]" : "text-[#047857]"
                    )}
                  >
                    Here for
                  </p>
                </div>
                <p
                  className={cn(
                    "mt-1 line-clamp-3 text-[15px] font-extrabold leading-snug tracking-[-0.01em]",
                    complaintIsRedFlag ? "text-[#991B1B]" : "text-[#0B1840]"
                  )}
                >
                  {complaint}
                </p>
                {brief && (brief.totalVisits > 1 || brief.lastToken) ? (
                  <div className="mt-2 flex items-start gap-1.5 border-t border-[#E8F3EE] pt-2">
                    <Sparkles className="mt-[2px] h-3 w-3 shrink-0 text-[#6EE7B7]" />
                    <p className="text-[11px] font-semibold leading-snug text-[#5C667D]">
                      {brief.totalVisits > 1 ? (
                        <>
                          <span className="text-[#047857]">Returning</span>
                          {" · "}
                          {brief.totalVisits} visits
                        </>
                      ) : (
                        <span className="text-[#047857]">First visit</span>
                      )}
                      {brief.lastToken?.raw_complaint ? (
                        <span className="text-[#8B97AD]">
                          {" · last: "}
                          <span className="italic">
                            {brief.lastToken.raw_complaint}
                          </span>
                        </span>
                      ) : null}
                    </p>
                  </div>
                ) : briefLoading ? (
                  <div className="mt-2 flex items-center gap-1.5 border-t border-[#E8F3EE] pt-2">
                    <Sparkles className="h-3 w-3 shrink-0 text-[#6EE7B7]" />
                    <p className="text-[11px] font-semibold italic text-[#94A3B8]">
                      Gathering context…
                    </p>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Action buttons — Done (primary emerald, shimmer) + Hold + Skip.
              All three share the same dimensions; hierarchy reads via color,
              not size. */}
          <div className="mt-auto grid shrink-0 grid-cols-3 gap-1.5 pt-3">
            {/* Done — emerald premium pill matching the Start-consultation grammar */}
            <button
              className="group/cta relative inline-flex items-center justify-center gap-1.5 overflow-hidden rounded-full bg-[linear-gradient(135deg,#10B981_0%,#059669_55%,#047857_100%)] px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white shadow-[0_10px_24px_-10px_rgba(16,185,129,0.75),inset_0_1px_0_rgba(255,255,255,0.22)] transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_16px_32px_-10px_rgba(16,185,129,0.9),inset_0_1px_0_rgba(255,255,255,0.28)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
              disabled={isWorking}
              onClick={() => onDone(token.id)}
              type="button"
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.35)_50%,transparent_100%)] transition-transform duration-700 ease-out group-hover/cta:translate-x-[300%]"
              />
              <span className="relative z-10">Done · D</span>
              <ChevronRight
                aria-hidden
                className="relative z-10 h-3.5 w-3.5 transition-transform duration-200 ease-out group-hover/cta:translate-x-0.5"
              />
            </button>

            {/* Hold — emerald outline */}
            <button
              className="group/sec inline-flex items-center justify-center gap-1.5 rounded-full border border-[#BBF7D0] bg-white/80 px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#047857] transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-[#86EFAC] hover:bg-[#F0FDF4] hover:shadow-[0_10px_20px_-10px_rgba(16,185,129,0.55)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              disabled={isWorking}
              onClick={onHold}
              type="button"
            >
              <PauseCircle className="h-3.5 w-3.5 transition-transform duration-200 group-hover/sec:scale-110" />
              Hold · H
            </button>

            {/* Skip — rose outline (negative action) */}
            <button
              className="group/sec inline-flex items-center justify-center gap-1.5 rounded-full border border-[#FECACA] bg-white/80 px-3 py-2.5 text-[11px] font-bold uppercase tracking-[0.14em] text-[#B91C1C] transition-all duration-200 ease-out hover:-translate-y-[1px] hover:border-[#FCA5A5] hover:bg-[#FFF1F2] hover:shadow-[0_10px_20px_-10px_rgba(220,38,38,0.5)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              disabled={isWorking}
              onClick={() => onSkip(token.id)}
              type="button"
            >
              Skip · S
            </button>
          </div>
          </div>
        </div>

        {/* BACK — dossier, same pattern as NextCard */}
        <div className="absolute inset-0 flex h-full flex-col overflow-hidden rounded-[28px] border border-[#E6E8EF] bg-[linear-gradient(180deg,#FDFDFE_0%,#F8F9FC_100%)] px-5 py-4 shadow-[0_18px_34px_-24px_rgba(15,23,42,0.25)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.06) 1px, transparent 1px)",
              backgroundSize: "22px 22px"
            }}
          />
          <div className="relative flex h-full min-h-0 flex-col">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#047857]">
                Dossier
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

            {flipped ? (
              <NextDossierBody
                brief={brief}
                clinicName={clinicName}
                key={`dossier-${token.id}`}
                loading={briefLoading}
                token={token}
              />
            ) : null}
          </div>
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
  onOpenProfile,
  onCollectPayment,
  onOpenVitals,
  onOpenProximity,
  onOpenInsurance
}: {
  token: QueueItem | null;
  clinicName: string;
  upcoming: QueueItem[];
  isWorking: boolean;
  behind: number;
  onStart: (id: string) => void;
  onOpenProfile: (patientId: string) => void;
  onCollectPayment: (token: QueueItem) => void;
  onOpenVitals: (token: QueueItem) => void;
  onOpenProximity: (token: QueueItem) => void;
  onOpenInsurance: (token: QueueItem) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const [brief, setBrief] = useState<PatientBrief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const patientId = token?.patient_id ?? null;
  const frontRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const flipMountedRef = useRef(false);

  // Reset flip + brief when token changes
  useEffect(() => {
    setFlipped(false);
    setBrief(null);
  }, [token?.id]);

  // Paper-lift animation on each flip. Skip the first mount so it doesn't
  // fire on open.
  useEffect(() => {
    if (!flipMountedRef.current) {
      flipMountedRef.current = true;
      return;
    }
    setIsFlipping(true);
    const t = window.setTimeout(() => setIsFlipping(false), 620);
    return () => window.clearTimeout(t);
  }, [flipped]);

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

  // Cursor hologram — direct DOM mutation for 60fps feel
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const host = frontRef.current;
    const orb = orbRef.current;
    if (!host || !orb) return;
    const rect = host.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    orb.style.transform = `translate3d(${x - 130}px, ${y - 130}px, 0)`;
    orb.style.opacity = "1";
  }
  function onPointerLeave() {
    if (orbRef.current) orbRef.current.style.opacity = "0";
  }

  if (!token) {
    return (
      <div className="flex h-full min-h-[260px] flex-col rounded-[28px] border border-[#C7D2FE] bg-[linear-gradient(145deg,#EEF2FF_0%,#E0E7FF_55%,#F5F7FF_100%)] px-5 py-4 shadow-[0_20px_40px_-24px_rgba(79,70,229,0.3)] backdrop-blur-xl">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#4F46E5]">
          Next up
        </p>
        <p className="my-auto text-center text-sm font-semibold text-[#8B97AD]">
          Queue is empty.
        </p>
      </div>
    );
  }
  const waited = minutesSince(token.checked_in_at);
  const visibleUpcoming = upcoming.slice(0, 1);
  const moreCount = Math.max(0, behind - visibleUpcoming.length);
  const complaint = token.raw_complaint?.trim() ?? "";
  const complaintIsRedFlag = complaint ? RED_FLAG_RE.test(complaint) : false;

  return (
    <div className="group h-full [perspective:1400px]">
      <div
        className={cn(
          "h-full transition-transform duration-200 ease-out hover:-translate-y-[2px]",
          isFlipping && "qcare-flip-lift"
        )}
      >
      <div
        className={cn(
          "relative h-full [transform-style:preserve-3d] transition-transform duration-[520ms] will-change-transform [transition-timing-function:cubic-bezier(0.4,0,0.2,1)]",
          flipped && "[transform:rotateY(180deg)]"
        )}
      >
        {/* FRONT */}
        <div
          className="relative flex h-full flex-col overflow-hidden rounded-[28px] border border-[#C7D2FE] bg-[linear-gradient(145deg,#EEF2FF_0%,#E0E7FF_55%,#F5F7FF_100%)] px-5 py-4 shadow-[0_20px_40px_-22px_rgba(79,70,229,0.35)] backdrop-blur-xl transition-shadow duration-200 group-hover:shadow-[0_28px_56px_-18px_rgba(79,70,229,0.55)] [backface-visibility:hidden]"
          onPointerLeave={onPointerLeave}
          onPointerMove={onPointerMove}
          ref={frontRef}
        >
          {/* Cursor spotlight — diffuse ambient glow that follows the pointer */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-0 top-0 z-0 h-[260px] w-[260px] opacity-0 transition-opacity duration-300 ease-out"
            ref={orbRef}
            style={{
              background:
                "radial-gradient(circle, rgba(99,102,241,0.18) 0%, rgba(99,102,241,0.07) 35%, rgba(99,102,241,0) 70%)",
              willChange: "transform, opacity"
            }}
          />

          <div className="relative z-10 flex h-full min-h-0 flex-col">
            <div className="shrink-0">
              {/* Header — kicker on left, waited-time pill on right (urgency signal) */}
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#4F46E5]">
                  Next up
                </p>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] ring-1",
                    waited >= 30
                      ? "qcare-breathe bg-[#FEE2E2] text-[#B91C1C] ring-[#FECACA]"
                      : waited >= 15
                        ? "bg-[#FFFBEB] text-[#B45309] ring-[#FDE68A]"
                        : "bg-white/80 text-[#4F46E5] ring-[#C7D2FE]"
                  )}
                  title={`Checked in ${formatDur(waited)} ago`}
                >
                  <Clock className="h-3 w-3" />
                  <span className="opacity-70">waited</span>
                  <span className="tabular-nums">{formatDur(waited)}</span>
                </span>
              </div>

              {/* Name as hero — token # + gender/age inline, animated underline on hover */}
              <button
                aria-expanded={flipped}
                className="group/name relative mt-2 flex items-baseline gap-2 text-left"
                onClick={() => setFlipped(true)}
                title="Show briefing"
                type="button"
              >
                <span
                  className="relative min-w-0 flex-1 truncate text-[22px] font-extrabold leading-[1.1] tracking-[-0.02em] text-[#0B1840] transition-[letter-spacing] duration-300 ease-out group-hover/name:tracking-[-0.025em]"
                  title={token.patients?.name ?? undefined}
                >
                  {formatPatientName(token.patients?.name)}
                  {patientMeta(token) ? (
                    <span className="ml-2 text-[12px] font-semibold tracking-normal text-[#6A7283]">
                      {patientMeta(token)}
                    </span>
                  ) : null}
                  <span
                    aria-hidden
                    className="absolute -bottom-0.5 left-0 h-[2px] w-0 rounded-full bg-[linear-gradient(90deg,#6366F1_0%,#A5B4FC_100%)] transition-[width] duration-400 ease-[cubic-bezier(0.22,1,0.36,1)] group-hover/name:w-full"
                  />
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-[0.14em] tabular-nums ring-1 transition-colors duration-300",
                    tokenNeedsCall(token)
                      ? "bg-[#FEE2E2] text-[#B91C1C] ring-[#FECACA]"
                      : "bg-white/70 text-[#4F46E5] ring-[#C7D2FE] group-hover/name:bg-[#EEF2FF] group-hover/name:ring-[#A5B4FC]"
                  )}
                  title={
                    tokenNeedsCall(token)
                      ? "Check-in SMS didn't deliver — call them"
                      : undefined
                  }
                >
                  #{token.token_number}
                </span>
                <ChevronRight
                  aria-hidden
                  className="h-4 w-4 shrink-0 self-center text-[#A5B4FC] transition-all duration-300 ease-out group-hover/name:translate-x-1 group-hover/name:text-[#4F46E5]"
                />
              </button>

              {/* Readiness indicators — right under the name for glanceable go/no-go.
                  Each unresolved dot is itself the fix-it affordance. */}
              <PreflightRow
                onFixProximity={() => onOpenProximity(token)}
                onFixVitals={() => onOpenVitals(token)}
                onInsurance={() =>
                  token.patients?.insurance_provider
                    ? onOpenInsurance(token)
                    : onCollectPayment(token)
                }
                token={token}
              />

              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {patientChips(token, new Date())}
              </div>

              <ContactLine hideMeta token={token} tone="indigo" />
            </div>

            <div
              className={cn(
                "min-h-0 flex-1",
                complaint ? "mt-3 overflow-hidden" : "mt-2"
              )}
            >
              {complaint ? (
                <div
                  className={cn(
                    "rounded-2xl border px-4 py-3 backdrop-blur-sm",
                    complaintIsRedFlag
                      ? "border-[#FECACA] bg-[#FFF5F5]/90 shadow-[0_10px_24px_-14px_rgba(185,28,28,0.35)]"
                      : "border-white/90 bg-white/85 shadow-[0_10px_24px_-16px_rgba(79,70,229,0.28)]"
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    {complaintIsRedFlag ? (
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[#B91C1C]" />
                    ) : null}
                    <p
                      className={cn(
                        "text-[10px] font-bold uppercase tracking-[0.2em]",
                        complaintIsRedFlag ? "text-[#B91C1C]" : "text-[#4F46E5]"
                      )}
                    >
                      Here for
                    </p>
                  </div>
                  <p
                    className={cn(
                      "mt-1 line-clamp-2 text-[15px] font-extrabold leading-snug tracking-[-0.01em]",
                      complaintIsRedFlag ? "text-[#991B1B]" : "text-[#0B1840]"
                    )}
                  >
                    {complaint}
                  </p>
                </div>
              ) : null}
            </div>

            {visibleUpcoming.length > 0 ? (
              <div className="mt-auto shrink-0 rounded-2xl border border-white/80 bg-white/70 p-2.5 backdrop-blur-sm">
                <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#8B97AD]">
                  Then
                </p>
                <div className="mt-1 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 text-[11px] font-semibold text-[#1A2550]">
                  {visibleUpcoming.map((u) => (
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
                  {moreCount > 0 ? (
                    <>
                      <span aria-hidden className="text-[#A5B4FC]">+</span>
                      <span className="italic text-[#6A7283]">
                        {moreCount} more {moreCount === 1 ? "patient" : "patients"}
                      </span>
                      <span aria-hidden />
                    </>
                  ) : null}
                </div>
              </div>
            ) : moreCount > 0 ? (
              <p className="mt-auto shrink-0 text-[11px] font-semibold italic text-[#6A7283]">
                + {moreCount} more {moreCount === 1 ? "patient" : "patients"} waiting
              </p>
            ) : null}

            <div className="mt-3 shrink-0">
              <button
                className="group/cta relative inline-flex w-full items-center justify-center gap-1.5 overflow-hidden rounded-full bg-[linear-gradient(135deg,#6366F1_0%,#4F46E5_55%,#4338CA_100%)] px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_10px_24px_-10px_rgba(79,70,229,0.7),inset_0_1px_0_rgba(255,255,255,0.22)] transition-all duration-200 ease-out hover:-translate-y-[1px] hover:shadow-[0_16px_32px_-10px_rgba(79,70,229,0.85),inset_0_1px_0_rgba(255,255,255,0.28)] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
                disabled={isWorking}
                onClick={() => onStart(token.id)}
                type="button"
              >
                {/* Shimmer sweep — ultra-premium sheen on hover */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.35)_50%,transparent_100%)] transition-transform duration-700 ease-out group-hover/cta:translate-x-[300%]"
                />
                <span className="relative z-10">Start consultation</span>
                <ChevronRight
                  aria-hidden
                  className="relative z-10 h-3.5 w-3.5 transition-transform duration-200 ease-out group-hover/cta:translate-x-1"
                />
              </button>
            </div>
          </div>
        </div>

        {/* BACK — dossier. Contents mount on flip, so the cascading reveal
            re-fires each time the card is flipped open. */}
        <div className="absolute inset-0 flex h-full flex-col overflow-hidden rounded-[28px] border border-[#E6E8EF] bg-[linear-gradient(180deg,#FDFDFE_0%,#F8F9FC_100%)] px-5 py-4 shadow-[0_18px_34px_-24px_rgba(15,23,42,0.25)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
          {/* subtle paper grain */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                "linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.06) 1px, transparent 1px)",
              backgroundSize: "22px 22px"
            }}
          />
          <div className="relative flex h-full flex-col">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#6A7283]">
                Dossier
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

            {flipped ? (
              <NextDossierBody
                brief={brief}
                clinicName={clinicName}
                key={`dossier-${token.id}`}
                loading={briefLoading}
                token={token}
              />
            ) : null}
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}

/**
 * Back-face dossier. Shape-shifts between "returning" and "new patient"
 * layouts. Each section is a cascading reveal keyed off the flip so items
 * land staggered.
 */
function NextDossierBody({
  token,
  clinicName,
  brief,
  loading
}: {
  token: QueueItem;
  clinicName: string;
  brief: PatientBrief | null;
  loading: boolean;
}) {
  const summary = buildOpener(token, brief);
  const isReturning = (brief?.totalVisits ?? 0) > 1;
  const lastVisit = brief?.lastToken ?? null;
  const unpaid = brief?.unpaidPriorVisits ?? 0;
  const familyToday = brief?.familyToday ?? [];
  const allergies = brief?.patient.allergies ?? [];
  const language = brief?.patient.language_preference ?? null;
  const phone = token.patients?.phone ?? null;
  const firstName =
    (token.patients?.name ?? "there").split(/\s+/)[0] ?? "there";
  let step = 0;
  const stepStyle = () =>
    ({ ["--i" as string]: step++ } as React.CSSProperties);

  return (
    <div className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      {/* AI summary — one-line whisper */}
      {summary ? (
        <div
          className="qcare-list-item-in flex items-start gap-2 rounded-2xl border border-[#E0E7FF] bg-[linear-gradient(135deg,#EEF2FF_0%,#F8FAFF_100%)] px-3 py-2 shadow-[0_8px_20px_-16px_rgba(79,70,229,0.35)]"
          style={stepStyle()}
        >
          <Sparkles className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[#6366F1]" />
          <p className="text-[12.5px] font-semibold leading-snug text-[#1A2550]">
            {summary}
          </p>
        </div>
      ) : null}

      {/* Returning: last visit */}
      {isReturning && lastVisit ? (
        <div
          className="qcare-list-item-in rounded-2xl border border-[#E2E8F0] bg-white px-3 py-2.5"
          style={stepStyle()}
        >
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#8B97AD]">
            Last visit
          </p>
          <p className="mt-0.5 text-[12.5px] font-semibold text-[#1A2550]">
            {new Intl.DateTimeFormat("en-IN", {
              day: "numeric",
              month: "short"
            }).format(new Date(lastVisit.date))}
            {lastVisit.doctor_name ? (
              <span className="text-[#8B97AD]"> · {lastVisit.doctor_name}</span>
            ) : null}
          </p>
          {lastVisit.raw_complaint ? (
            <p className="mt-0.5 line-clamp-2 text-[11.5px] italic text-[#5C667D]">
              “{lastVisit.raw_complaint}”
            </p>
          ) : null}
        </div>
      ) : null}

      {/* Returning: unfinished business (unpaid) */}
      {isReturning && unpaid > 0 ? (
        <div
          className="qcare-list-item-in flex items-start gap-2 rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] px-3 py-2.5"
          style={stepStyle()}
        >
          <AlertTriangle className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[#B45309]" />
          <div className="min-w-0 flex-1">
            <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#B45309]">
              Unfinished
            </p>
            <p className="mt-0.5 text-[12.5px] font-semibold text-[#92400E]">
              {unpaid} prior {unpaid === 1 ? "visit" : "visits"} with unpaid balance
            </p>
          </div>
        </div>
      ) : null}

      {/* New: intake checklist */}
      {!isReturning && brief ? (
        <div
          className="qcare-list-item-in rounded-2xl border border-[#E2E8F0] bg-white px-3 py-2.5"
          style={stepStyle()}
        >
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#8B97AD]">
            Intake checklist
          </p>
          <ul className="mt-1 space-y-0.5 text-[12px] font-semibold text-[#1A2550]">
            <li className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#CBD5E1]" />
              Confirm allergies & current medication
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#CBD5E1]" />
              Emergency contact
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#CBD5E1]" />
              How did they hear about us?
            </li>
            <li className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-[#CBD5E1]" />
              Preferred language for reports
            </li>
          </ul>
        </div>
      ) : null}

      {/* Notes — allergies + language. Shown for both new and returning. */}
      {(allergies.length > 0 || language) && brief ? (
        <div
          className="qcare-list-item-in rounded-2xl border border-[#E2E8F0] bg-white px-3 py-2.5"
          style={stepStyle()}
        >
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#8B97AD]">
            Notes
          </p>
          <ul className="mt-1 space-y-1 text-[12px] font-semibold">
            {allergies.length > 0 ? (
              <li className="flex items-start gap-1.5 text-[#B91C1C]">
                <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" />
                Allergic to {allergies.slice(0, 3).join(", ")}
                {allergies.length > 3 ? ", …" : ""}
              </li>
            ) : null}
            {language && language.toLowerCase() !== "en" ? (
              <li className="flex items-start gap-1.5 text-[#1A2550]">
                <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#6366F1]" />
                Prefers{" "}
                {({
                  hi: "Hindi",
                  ta: "Tamil",
                  te: "Telugu",
                  kn: "Kannada",
                  ml: "Malayalam"
                } as Record<string, string>)[language.toLowerCase()] ?? language}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      {/* Family today */}
      {familyToday.length > 0 ? (
        <div
          className="qcare-list-item-in rounded-2xl border border-[#E2E8F0] bg-white px-3 py-2.5"
          style={stepStyle()}
        >
          <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#8B97AD]">
            Family here today
          </p>
          <ul className="mt-1 space-y-0.5 text-[12px] font-semibold text-[#1A2550]">
            {familyToday.slice(0, 3).map((f) => (
              <li className="flex items-center gap-2" key={f.id}>
                <span className="tabular-nums text-[#4F46E5]">#{f.token_number}</span>
                <span className="truncate">{f.name}</span>
                <span className="ml-auto text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8B97AD]">
                  {f.status.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {loading && !brief ? (
        <div className="space-y-1.5">
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

      {/* Terminal actions — Text + Call only. No "Full profile" escape hatch. */}
      <div
        className="qcare-list-item-in mt-auto flex gap-1.5 pt-2"
        style={stepStyle()}
      >
        {phone ? (
          <>
            <a
              className="group/bc inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#C7D2FE] bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#4F46E5] transition-all duration-200 hover:-translate-y-[1px] hover:bg-[#EEF2FF] hover:shadow-[0_8px_20px_-10px_rgba(99,102,241,0.55)]"
              href={`sms:${phone}?body=${encodeURIComponent(
                `Hi ${firstName}, this is ${clinicName} reception. Token #${token.token_number} will be called in a few minutes.`
              )}`}
            >
              <MessageSquare className="h-4 w-4 transition-transform duration-300 group-hover/bc:-rotate-6 group-hover/bc:scale-[1.2]" />
              Text
            </a>
            <a
              className="group/bc inline-flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[#C7D2FE] bg-white px-3 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#4F46E5] transition-all duration-200 hover:-translate-y-[1px] hover:bg-[#EEF2FF] hover:shadow-[0_8px_20px_-10px_rgba(99,102,241,0.55)]"
              href={`tel:${phone}`}
            >
              <Phone className="h-4 w-4 transition-transform duration-300 group-hover/bc:rotate-[-12deg] group-hover/bc:scale-[1.2]" />
              Call
            </a>
          </>
        ) : null}
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
  overflowItems,
  isWorking,
  onDismiss
}: {
  items: NeedsYouItem[];
  overflowItems: NeedsYouItem[];
  isWorking: boolean;
  onDismiss: (id: string) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [isFlipping, setIsFlipping] = useState(false);
  const frontRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<HTMLDivElement>(null);
  const flipMountedRef = useRef(false);

  // When overflow drains to zero, pull the user back to the front automatically.
  useEffect(() => {
    if (overflowItems.length === 0 && flipped) setFlipped(false);
  }, [overflowItems.length, flipped]);

  // Paper-lift animation on each flip; skip initial mount.
  useEffect(() => {
    if (!flipMountedRef.current) {
      flipMountedRef.current = true;
      return;
    }
    setIsFlipping(true);
    const t = window.setTimeout(() => setIsFlipping(false), 620);
    return () => window.clearTimeout(t);
  }, [flipped]);

  // Esc to flip back
  useEffect(() => {
    if (!flipped) return;
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (inField) return;
      if (e.key === "Escape") setFlipped(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [flipped]);

  // Cursor hologram — violet ambient glow
  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const host = frontRef.current;
    const orb = orbRef.current;
    if (!host || !orb) return;
    const rect = host.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    orb.style.transform = `translate3d(${x - 130}px, ${y - 130}px, 0)`;
    orb.style.opacity = "1";
  }
  function onPointerLeave() {
    if (orbRef.current) orbRef.current.style.opacity = "0";
  }

  return (
    <div className="group h-full [perspective:1400px]">
      <div
        className={cn(
          "h-full transition-transform duration-200 ease-out hover:-translate-y-[2px]",
          isFlipping && "qcare-flip-lift"
        )}
      >
        <div
          className={cn(
            "relative h-full [transform-style:preserve-3d] transition-transform duration-[520ms] will-change-transform [transition-timing-function:cubic-bezier(0.4,0,0.2,1)]",
            flipped && "[transform:rotateY(180deg)]"
          )}
        >
          {/* FRONT — top 3 */}
          <div
            className="relative flex h-full flex-col overflow-hidden rounded-[28px] border border-[#E9D5FF] bg-[linear-gradient(145deg,#FAF5FF_0%,#F3E8FF_55%,#FFFFFF_100%)] px-5 py-4 shadow-[0_20px_40px_-22px_rgba(168,85,247,0.28)] backdrop-blur-xl transition-shadow duration-200 group-hover:shadow-[0_28px_56px_-18px_rgba(168,85,247,0.45)] [backface-visibility:hidden]"
            onPointerLeave={onPointerLeave}
            onPointerMove={onPointerMove}
            ref={frontRef}
          >
            {/* Violet cursor spotlight */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 top-0 z-0 h-[260px] w-[260px] opacity-0 transition-opacity duration-300 ease-out"
              ref={orbRef}
              style={{
                background:
                  "radial-gradient(circle, rgba(168,85,247,0.18) 0%, rgba(168,85,247,0.07) 35%, rgba(168,85,247,0) 70%)",
                willChange: "transform, opacity"
              }}
            />

            <div className="relative z-10 flex h-full min-h-0 flex-col">
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="h-3 w-3 text-[#7E22CE]" />
                    <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7E22CE]">
                      Action center
                    </p>
                  </div>
                  <span className="rounded-full bg-white/80 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#7E22CE] ring-1 ring-[#E9D5FF]">
                    Top {items.length}
                  </span>
                </div>

                {items.length === 0 ? (
                  <div className="my-auto flex flex-col items-center gap-1.5 py-6 text-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#DCFCE7] text-[#047857]">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <p className="text-sm font-bold text-[#0B1840]">All quiet.</p>
                    <p className="text-[11px] font-medium text-[#8B97AD]">
                      Prāṇa is watching.
                    </p>
                  </div>
                ) : (
                  <ul className="mt-3 grid auto-rows-min gap-2 overflow-hidden">
                    {items.map((item) => (
                      <NeedsYouRow
                        isWorking={isWorking}
                        item={item}
                        key={item.id}
                        onDismiss={onDismiss}
                      />
                    ))}
                  </ul>
                )}
              </div>

              {overflowItems.length > 0 ? (
                <div className="mt-auto shrink-0 pt-3">
                  <button
                    aria-expanded={flipped}
                    className="group/more flex w-full items-center justify-between rounded-full border border-[#E9D5FF] bg-white/80 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#7E22CE] transition-all duration-200 hover:-translate-y-[0.5px] hover:bg-[#FAF5FF] hover:shadow-[0_8px_20px_-10px_rgba(168,85,247,0.5)]"
                    onClick={() => setFlipped(true)}
                    title="Show the rest"
                    type="button"
                  >
                    <span>
                      {overflowItems.length} more{" "}
                      {overflowItems.length === 1 ? "action" : "actions"}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover/more:translate-x-0.5" />
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {/* BACK — overflow dossier */}
          <div className="absolute inset-0 flex h-full flex-col overflow-hidden rounded-[28px] border border-[#E6E8EF] bg-[linear-gradient(180deg,#FDFDFE_0%,#F8F9FC_100%)] px-5 py-4 shadow-[0_18px_34px_-24px_rgba(15,23,42,0.25)] [backface-visibility:hidden] [transform:rotateY(180deg)]">
            {/* subtle paper grain */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 opacity-[0.35]"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgba(148,163,184,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.06) 1px, transparent 1px)",
                backgroundSize: "22px 22px"
              }}
            />
            <div className="relative flex h-full min-h-0 flex-col">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3 w-3 text-[#7E22CE]" />
                  <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#7E22CE]">
                    Also on your plate
                  </p>
                </div>
                <button
                  aria-label="Flip back"
                  className="rounded-full p-1 text-[#8B97AD] hover:bg-[#F5F7FB] hover:text-[#0B1840]"
                  onClick={() => setFlipped(false)}
                  type="button"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              {flipped ? (
                <ul
                  className="mt-3 grid auto-rows-min gap-2 overflow-hidden"
                  key={`overflow-${overflowItems.length}`}
                >
                  {overflowItems.map((item, i) => (
                    <div
                      className="qcare-list-item-in"
                      key={item.id}
                      style={{ ["--i" as string]: i } as React.CSSProperties}
                    >
                      <NeedsYouRow
                        isWorking={isWorking}
                        item={item}
                        onDismiss={onDismiss}
                      />
                    </div>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function NeedsYouRow({
  item,
  isWorking,
  onDismiss
}: {
  item: NeedsYouItem;
  isWorking: boolean;
  onDismiss: (id: string) => void;
}) {
  return (
    <li
      className={cn(
        "rounded-2xl border px-3 py-2.5",
        item.severity === "red" && "border-[#FECACA] bg-[#FFF1F2]",
        item.severity === "amber" && "border-[#FDE68A] bg-[#FFFBEB]",
        item.severity === "info" && "border-[#DBEAFE] bg-[#F3F7FF]"
      )}
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
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {item.primary ? (
          <ActionCtaPrimary
            disabled={isWorking}
            onClick={() => void item.primary?.run()}
            severity={item.severity}
          >
            {item.primary.label}
          </ActionCtaPrimary>
        ) : null}
        {item.secondary ? (
          <ActionCtaSecondary
            disabled={isWorking}
            onClick={() => void item.secondary?.run()}
            severity={item.severity}
          >
            {item.secondary.label}
          </ActionCtaSecondary>
        ) : null}
        <button
          className="ml-auto inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-[#8B97AD] transition-colors duration-200 hover:bg-white/60 hover:text-[#475569]"
          onClick={() => onDismiss(item.id)}
          title="Dismiss"
          type="button"
        >
          <X className="h-3 w-3" />
          Dismiss
        </button>
      </div>
    </li>
  );
}

/**
 * Primary CTA inside an Action Center row. Premium gradient pill that mirrors
 * the "Start consultation" button on NextCard — shimmer sweep, inset top
 * highlight, deeper shadow on hover, chevron nudge. The gradient and shadow
 * recolor per severity so urgency reads at a glance.
 */
function ActionCtaPrimary({
  children,
  onClick,
  disabled,
  severity
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  severity: "red" | "amber" | "info";
}) {
  const tone = {
    red: {
      bg: "bg-[linear-gradient(135deg,#EF4444_0%,#DC2626_55%,#B91C1C_100%)]",
      shadowRest:
        "shadow-[0_10px_24px_-10px_rgba(220,38,38,0.7),inset_0_1px_0_rgba(255,255,255,0.22)]",
      shadowHover:
        "hover:shadow-[0_16px_32px_-10px_rgba(220,38,38,0.85),inset_0_1px_0_rgba(255,255,255,0.28)]"
    },
    amber: {
      bg: "bg-[linear-gradient(135deg,#F59E0B_0%,#D97706_55%,#B45309_100%)]",
      shadowRest:
        "shadow-[0_10px_24px_-10px_rgba(217,119,6,0.7),inset_0_1px_0_rgba(255,255,255,0.22)]",
      shadowHover:
        "hover:shadow-[0_16px_32px_-10px_rgba(217,119,6,0.85),inset_0_1px_0_rgba(255,255,255,0.28)]"
    },
    info: {
      bg: "bg-[linear-gradient(135deg,#6366F1_0%,#4F46E5_55%,#4338CA_100%)]",
      shadowRest:
        "shadow-[0_10px_24px_-10px_rgba(79,70,229,0.7),inset_0_1px_0_rgba(255,255,255,0.22)]",
      shadowHover:
        "hover:shadow-[0_16px_32px_-10px_rgba(79,70,229,0.85),inset_0_1px_0_rgba(255,255,255,0.28)]"
    }
  }[severity];

  return (
    <button
      className={cn(
        "group/cta relative inline-flex items-center justify-center gap-1.5 overflow-hidden rounded-full px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] text-white transition-all duration-200 ease-out hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0",
        tone.bg,
        tone.shadowRest,
        tone.shadowHover
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.35)_50%,transparent_100%)] transition-transform duration-700 ease-out group-hover/cta:translate-x-[300%]"
      />
      <span className="relative z-10">{children}</span>
      <ChevronRight
        aria-hidden
        className="relative z-10 h-3 w-3 transition-transform duration-200 ease-out group-hover/cta:translate-x-0.5"
      />
    </button>
  );
}

/**
 * Secondary CTA — bordered glass pill with tone-tinted hover shadow. Calm
 * sibling to the primary so the hierarchy reads at a glance.
 */
function ActionCtaSecondary({
  children,
  onClick,
  disabled,
  severity
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  severity: "red" | "amber" | "info";
}) {
  const tone = {
    red: "border-[#FECACA] text-[#B91C1C] hover:bg-white hover:border-[#FCA5A5] hover:shadow-[0_10px_20px_-10px_rgba(220,38,38,0.55)]",
    amber:
      "border-[#FDE68A] text-[#B45309] hover:bg-white hover:border-[#FCD34D] hover:shadow-[0_10px_20px_-10px_rgba(217,119,6,0.55)]",
    info: "border-[#C7D2FE] text-[#4F46E5] hover:bg-white hover:border-[#A5B4FC] hover:shadow-[0_10px_20px_-10px_rgba(79,70,229,0.55)]"
  }[severity];

  return (
    <button
      className={cn(
        "group/sec inline-flex items-center gap-1.5 rounded-full border bg-white/80 px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em] transition-all duration-200 ease-out hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
        tone
      )}
      disabled={disabled}
      onClick={onClick}
      type="button"
    >
      <span>{children}</span>
      <ChevronRight
        aria-hidden
        className="h-3 w-3 transition-transform duration-200 ease-out group-hover/sec:translate-x-0.5"
      />
    </button>
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

function PreflightRow({
  token,
  onFixVitals,
  onInsurance,
  onFixProximity
}: {
  token: QueueItem;
  onFixVitals?: () => void;
  /** Fires regardless of insured/self-pay — parent routes to the right dialog. */
  onInsurance?: () => void;
  onFixProximity?: () => void;
}) {
  const vitalsDone = Boolean(token.vitals_taken_at);
  const insurance = token.patients?.insurance_provider ?? null;
  const proximity = (token.proximity_status ?? "unknown") as ProximityStatus;

  const vitalsClass = vitalsDone ? "text-[#047857]" : "text-[#B45309]";
  const vitalsDot = vitalsDone ? "bg-[#10B981]" : "bg-[#F59E0B]";
  const vitalsText = vitalsDone ? "Vitals done" : "Vitals pending";
  const vitalsRing = vitalsDone ? "hover:ring-[#BBF7D0]" : "hover:ring-[#FDE68A]";

  // Self-pay gets its own indigo tone so it reads as "distinct category" rather
  // than "missing/broken" grey. Insurance stays blue.
  const insuranceClass = insurance ? "text-[#1D4ED8]" : "text-[#4F46E5]";
  const insuranceDot = insurance ? "bg-[#3B82F6]" : "bg-[#6366F1]";
  const insuranceText = insurance ?? "Self-pay";
  const insuranceRing = insurance ? "hover:ring-[#BFDBFE]" : "hover:ring-[#C7D2FE]";

  const proxMap: Record<
    ProximityStatus,
    { text: string; cls: string; dot: string; ring: string }
  > = {
    in_clinic: {
      text: "In clinic",
      cls: "text-[#047857]",
      dot: "bg-[#10B981]",
      ring: "hover:ring-[#BBF7D0]"
    },
    nearby: {
      text: "Nearby",
      cls: "text-[#B45309]",
      dot: "bg-[#F59E0B]",
      ring: "hover:ring-[#FDE68A]"
    },
    unknown: {
      text: "Not confirmed",
      cls: "text-[#64748B]",
      dot: "bg-[#94A3B8]",
      ring: "hover:ring-[#CBD5E1]"
    }
  };
  const prox = proxMap[proximity];

  // Every dot is tappable — resolved states open a "view / reconfirm" sheet,
  // unresolved states open a "fix it" sheet. The user always sees an invite.
  const vitalsActionable = Boolean(onFixVitals);
  const insuranceActionable = Boolean(onInsurance);
  const proxActionable = Boolean(onFixProximity);

  const base =
    "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 transition-all duration-200";
  const actionRing =
    "hover:-translate-y-[0.5px] hover:ring-1 hover:brightness-[1.03] focus-visible:outline-none focus-visible:ring-2";

  function Item({
    actionable,
    onFix,
    dotCls,
    labelCls,
    ringCls,
    children,
    title
  }: {
    actionable: boolean;
    onFix?: () => void;
    dotCls: string;
    labelCls: string;
    ringCls: string;
    children: React.ReactNode;
    title?: string;
  }) {
    if (!actionable) {
      return (
        <span className={cn(base, labelCls)}>
          <span className={cn("h-1.5 w-1.5 rounded-full", dotCls)} />
          {children}
        </span>
      );
    }
    return (
      <button
        className={cn("group/pf", base, actionRing, labelCls, ringCls)}
        onClick={onFix}
        title={title}
        type="button"
      >
        <span className={cn("h-1.5 w-1.5 rounded-full", dotCls)} />
        <span>{children}</span>
        <ChevronRight className="h-3 w-3 opacity-60 transition-all duration-200 group-hover/pf:translate-x-0.5 group-hover/pf:opacity-100" />
      </button>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] font-semibold">
      <Item
        actionable={vitalsActionable}
        dotCls={vitalsDot}
        labelCls={vitalsClass}
        onFix={onFixVitals}
        ringCls={vitalsRing}
        title={vitalsDone ? "View vitals" : "Record vitals"}
      >
        {vitalsText}
      </Item>
      <Item
        actionable={insuranceActionable}
        dotCls={insuranceDot}
        labelCls={insuranceClass}
        onFix={onInsurance}
        ringCls={insuranceRing}
        title={insurance ? "View coverage" : "Collect payment"}
      >
        {insuranceText}
      </Item>
      <Item
        actionable={proxActionable}
        dotCls={prox.dot}
        labelCls={prox.cls}
        onFix={onFixProximity}
        ringCls={prox.ring}
        title={proximity === "unknown" ? "Confirm arrival" : "Change status"}
      >
        {prox.text}
      </Item>
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

/* ---------- Payment dialog (demo portal) ---------- */

const PAYMENT_METHODS: Array<{
  key: "upi" | "card" | "cash";
  label: string;
  sub: string;
  icon: string;
}> = [
  { key: "upi", label: "UPI", sub: "GPay · PhonePe · Paytm", icon: "₹" },
  { key: "card", label: "Card", sub: "Credit or debit", icon: "▢" },
  { key: "cash", label: "Cash", sub: "Pay at counter", icon: "₹" }
];

const CONSULTATION_FEE = 500;

function PaymentDialog({
  token,
  onClose
}: {
  token: QueueItem;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<"upi" | "card" | "cash" | null>(null);
  const [phase, setPhase] = useState<"pick" | "processing" | "done">("pick");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && phase !== "processing") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  function start(m: "upi" | "card" | "cash") {
    setMethod(m);
    setPhase("processing");
    window.setTimeout(() => setPhase("done"), 1400);
  }

  const patientName = token.patients?.name ?? "Patient";
  const methodLabel = PAYMENT_METHODS.find((m) => m.key === method)?.label ?? "";

  return (
    <ModalShell accent="emerald" maxWidth="max-w-md" onClose={onClose}>
      <ModalHeader
        kicker="Collect payment"
        kickerColor="#047857"
        onClose={onClose}
        subtitle={`${patientName} · #${token.token_number}`}
        title={
          <span className="flex items-baseline gap-1.5">
            <span className="text-[#047857]">₹</span>
            <span className="tabular-nums">{CONSULTATION_FEE}</span>
            <span className="ml-1 text-base font-semibold text-[#8B97AD]">
              consultation
            </span>
          </span>
        }
      />

      {phase === "pick" ? (
        <div className="mt-5 space-y-2">
          {PAYMENT_METHODS.map((m, i) => (
            <button
              className="qcare-list-item-in group flex w-full items-center gap-3 rounded-2xl border border-[#E2E8F0] bg-white/80 px-4 py-3 text-left transition-all duration-200 hover:-translate-y-[1px] hover:border-[#86EFAC] hover:bg-[#F0FDF4] hover:shadow-[0_10px_24px_-14px_rgba(16,185,129,0.5)]"
              key={m.key}
              onClick={() => start(m.key)}
              style={{ ["--i" as string]: i } as React.CSSProperties}
              type="button"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#DCFCE7_0%,#F0FDF4_100%)] text-xl font-extrabold text-[#047857] transition-transform duration-200 group-hover:scale-110">
                {m.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-extrabold text-[#0B1840]">
                  {m.label}
                </p>
                <p className="text-[11px] font-semibold text-[#8B97AD]">
                  {m.sub}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#94A3B8] transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[#047857]" />
            </button>
          ))}
          <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
            Demo · no real charge
          </p>
        </div>
      ) : null}

      {phase === "processing" ? (
        <div className="mt-6 flex flex-col items-center gap-3 py-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#DCFCE7_0%,#BBF7D0_100%)]">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#10B981] border-t-transparent" />
          </div>
          <p className="text-[13px] font-bold text-[#0B1840]">
            Processing {methodLabel}…
          </p>
          <p className="text-[11px] font-semibold text-[#8B97AD]">
            Confirming with {methodLabel === "Cash" ? "counter" : "gateway"}
          </p>
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="mt-6 flex flex-col items-center gap-3 py-6">
          <div className="qcare-complete-reveal absolute flex h-20 w-20 items-center justify-center rounded-full bg-[#10B981]/20" />
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#10B981_0%,#059669_100%)] shadow-[0_12px_24px_-8px_rgba(16,185,129,0.55)]">
            <CheckCircle2 className="h-7 w-7 text-white" />
          </div>
          <p className="text-[14px] font-extrabold text-[#0B1840]">
            ₹{CONSULTATION_FEE} received
          </p>
          <p className="text-[11px] font-semibold text-[#8B97AD]">
            via {methodLabel} · receipt sent over SMS
          </p>
          <button
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#10B981_0%,#059669_100%)] px-5 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_10px_20px_-10px_rgba(16,185,129,0.7)] transition hover:-translate-y-[1px]"
            onClick={onClose}
            type="button"
          >
            Done
          </button>
        </div>
      ) : null}
    </ModalShell>
  );
}

/* ---------- Vitals dialog (demo entry) ---------- */

function VitalsDialog({
  token,
  onClose
}: {
  token: QueueItem;
  onClose: () => void;
}) {
  const [bpSys, setBpSys] = useState("");
  const [bpDia, setBpDia] = useState("");
  const [pulse, setPulse] = useState("");
  const [temp, setTemp] = useState("");
  const [spo2, setSpo2] = useState("");
  const [phase, setPhase] = useState<"entry" | "saving" | "done">("entry");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && phase !== "saving") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, phase]);

  const canSave =
    bpSys.trim().length >= 2 &&
    bpDia.trim().length >= 2 &&
    pulse.trim().length >= 2;

  function save() {
    setPhase("saving");
    window.setTimeout(() => setPhase("done"), 1200);
  }

  const patientName = token.patients?.name ?? "Patient";

  return (
    <ModalShell accent="amber" maxWidth="max-w-md" onClose={onClose}>
      <ModalHeader
        kicker="Record vitals"
        kickerColor="#B45309"
        onClose={onClose}
        subtitle={`${patientName} · #${token.token_number}`}
        title="Vitals"
      />

      {phase === "entry" ? (
        <div className="mt-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <VitalField
              label="BP (sys)"
              onChange={setBpSys}
              placeholder="120"
              suffix="mmHg"
              value={bpSys}
            />
            <VitalField
              label="BP (dia)"
              onChange={setBpDia}
              placeholder="80"
              suffix="mmHg"
              value={bpDia}
            />
            <VitalField
              label="Pulse"
              onChange={setPulse}
              placeholder="72"
              suffix="bpm"
              value={pulse}
            />
            <VitalField
              label="SpO₂"
              onChange={setSpo2}
              placeholder="98"
              suffix="%"
              value={spo2}
            />
            <VitalField
              label="Temp"
              onChange={setTemp}
              placeholder="98.6"
              suffix="°F"
              value={temp}
            />
          </div>
          <button
            className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#F59E0B_0%,#D97706_55%,#B45309_100%)] px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_10px_24px_-10px_rgba(217,119,6,0.65)] transition hover:-translate-y-[1px] disabled:cursor-not-allowed disabled:opacity-60"
            disabled={!canSave}
            onClick={save}
            type="button"
          >
            Save vitals
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <p className="text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
            Demo · values not persisted
          </p>
        </div>
      ) : null}

      {phase === "saving" ? (
        <div className="mt-6 flex flex-col items-center gap-3 py-8">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#FEF3C7_0%,#FDE68A_100%)]">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#D97706] border-t-transparent" />
          </div>
          <p className="text-[13px] font-bold text-[#0B1840]">Saving vitals…</p>
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="mt-6 flex flex-col items-center gap-3 py-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#10B981_0%,#059669_100%)] shadow-[0_12px_24px_-8px_rgba(16,185,129,0.55)]">
            <CheckCircle2 className="h-7 w-7 text-white" />
          </div>
          <p className="text-[14px] font-extrabold text-[#0B1840]">Vitals recorded</p>
          <p className="text-[11px] font-semibold text-[#8B97AD]">
            BP {bpSys}/{bpDia} · Pulse {pulse}
          </p>
          <button
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#10B981_0%,#059669_100%)] px-5 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_10px_20px_-10px_rgba(16,185,129,0.7)] transition hover:-translate-y-[1px]"
            onClick={onClose}
            type="button"
          >
            Done
          </button>
        </div>
      ) : null}
    </ModalShell>
  );
}

function VitalField({
  label,
  value,
  onChange,
  placeholder,
  suffix
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  suffix: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.16em] text-[#8B97AD]">
        {label}
      </span>
      <div className="flex items-center rounded-xl border border-[#E2E8F0] bg-white px-3 py-2 transition focus-within:border-[#FDE68A] focus-within:ring-2 focus-within:ring-[#FDE68A]/40">
        <input
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[14px] font-extrabold tabular-nums text-[#0B1840] outline-none placeholder:font-medium placeholder:text-[#CBD5E1] focus:ring-0"
          inputMode="decimal"
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          value={value}
        />
        <span className="ml-2 shrink-0 text-[10px] font-bold uppercase tracking-[0.14em] text-[#8B97AD]">
          {suffix}
        </span>
      </div>
    </label>
  );
}

/* ---------- Proximity dialog (confirm arrival) ---------- */

function ProximityDialog({
  token,
  clinicName,
  onClose
}: {
  token: QueueItem;
  clinicName: string;
  onClose: () => void;
}) {
  const [phase, setPhase] = useState<"pick" | "done">("pick");
  const [picked, setPicked] = useState<"sms" | "in_clinic" | "nearby" | null>(
    null
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const phone = token.patients?.phone ?? null;
  const firstName =
    (token.patients?.name ?? "there").split(/\s+/)[0] ?? "there";
  const smsBody = `Hi ${firstName}, this is ${clinicName} reception. Token #${token.token_number} is coming up next — please let us know if you're on your way.`;

  function pick(kind: "sms" | "in_clinic" | "nearby") {
    setPicked(kind);
    if (kind === "sms" && phone) {
      window.location.href = `sms:${phone}?body=${encodeURIComponent(smsBody)}`;
    }
    setPhase("done");
  }

  const options: Array<{
    key: "sms" | "in_clinic" | "nearby";
    label: string;
    sub: string;
    icon: React.ReactNode;
    disabled?: boolean;
  }> = [
    {
      key: "sms",
      label: "Send arrival SMS",
      sub: phone ?? "No phone on file",
      icon: <MessageSquare className="h-4 w-4" />,
      disabled: !phone
    },
    {
      key: "in_clinic",
      label: "Mark as in clinic",
      sub: "Patient is here at the desk",
      icon: <CheckCircle2 className="h-4 w-4" />
    },
    {
      key: "nearby",
      label: "Mark as nearby",
      sub: "On their way — within 10 min",
      icon: <Clock className="h-4 w-4" />
    }
  ];

  return (
    <ModalShell accent="sky" maxWidth="max-w-md" onClose={onClose}>
      <ModalHeader
        kicker="Confirm arrival"
        kickerColor="#0369A1"
        onClose={onClose}
        subtitle={`${token.patients?.name ?? "Patient"} · #${token.token_number}`}
        title="Where are they?"
      />

      {phase === "pick" ? (
        <div className="mt-5 space-y-2">
          {options.map((o, i) => (
            <button
              className="qcare-list-item-in group flex w-full items-center gap-3 rounded-2xl border border-[#E2E8F0] bg-white/80 px-4 py-3 text-left transition-all duration-200 hover:-translate-y-[1px] hover:border-[#7DD3FC] hover:bg-[#F0F9FF] hover:shadow-[0_10px_24px_-14px_rgba(14,165,233,0.5)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
              disabled={o.disabled}
              key={o.key}
              onClick={() => pick(o.key)}
              style={{ ["--i" as string]: i } as React.CSSProperties}
              type="button"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[linear-gradient(135deg,#DBEAFE_0%,#F0F9FF_100%)] text-[#0369A1] transition-transform duration-200 group-hover:scale-110">
                {o.icon}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-extrabold text-[#0B1840]">
                  {o.label}
                </p>
                <p className="truncate text-[11px] font-semibold text-[#8B97AD]">
                  {o.sub}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-[#94A3B8] transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-[#0369A1]" />
            </button>
          ))}
        </div>
      ) : null}

      {phase === "done" ? (
        <div className="mt-6 flex flex-col items-center gap-3 py-6">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[linear-gradient(135deg,#10B981_0%,#059669_100%)] shadow-[0_12px_24px_-8px_rgba(16,185,129,0.55)]">
            <CheckCircle2 className="h-7 w-7 text-white" />
          </div>
          <p className="text-[14px] font-extrabold text-[#0B1840]">
            {picked === "sms"
              ? "SMS opened"
              : picked === "in_clinic"
                ? "Marked as in clinic"
                : "Marked as nearby"}
          </p>
          <button
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-[linear-gradient(135deg,#0EA5E9_0%,#0369A1_100%)] px-5 py-2 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_10px_20px_-10px_rgba(14,165,233,0.7)] transition hover:-translate-y-[1px]"
            onClick={onClose}
            type="button"
          >
            Done
          </button>
        </div>
      ) : null}
    </ModalShell>
  );
}

/* ---------- Insurance dialog (coverage breakdown) ---------- */

/**
 * Dummy per-provider coverage rules. In production this comes from the
 * clinic's billing engine + provider policy database. For now: illustrative.
 */
function estimateCoverage(provider: string | null, fee: number) {
  if (!provider) {
    return {
      coveragePct: 0,
      covered: 0,
      copay: fee,
      authRequired: false,
      policyNote: "Self-pay — full fee collected at reception."
    };
  }
  const key = provider.toLowerCase();
  const rules: Array<{ match: RegExp; pct: number; auth: boolean; note: string }> = [
    { match: /star|health/, pct: 80, auth: false, note: "OPD covered up to ₹2,500/visit. No pre-auth for consultations." },
    { match: /hdfc|ergo/, pct: 70, auth: false, note: "Cashless OPD at network clinics. Claim via app post-visit." },
    { match: /icici|lombard/, pct: 75, auth: true, note: "Pre-auth required for amounts above ₹1,000." },
    { match: /bajaj|allianz/, pct: 60, auth: false, note: "Co-payment applies. OPD annual cap ₹10,000." },
    { match: /niva|bupa/, pct: 85, auth: false, note: "Premium plan — wellness visits fully covered once/year." },
    { match: /tata|aig/, pct: 70, auth: true, note: "Pre-auth form mandatory for follow-ups." }
  ];
  const rule = rules.find((r) => r.match.test(key));
  const pct = rule?.pct ?? 65;
  const covered = Math.round((fee * pct) / 100);
  return {
    coveragePct: pct,
    covered,
    copay: fee - covered,
    authRequired: rule?.auth ?? false,
    policyNote:
      rule?.note ?? "Standard OPD cover. Confirm with provider before claim submission."
  };
}

function InsuranceDialog({
  token,
  onClose,
  onCollectCopay
}: {
  token: QueueItem;
  onClose: () => void;
  onCollectCopay: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const fee = CONSULTATION_FEE;
  const provider = token.patients?.insurance_provider ?? null;
  const policy = (token.patients as { insurance_policy_number?: string | null } | null)
    ?.insurance_policy_number ?? null;
  const { coveragePct, covered, copay, authRequired, policyNote } =
    estimateCoverage(provider, fee);

  return (
    <ModalShell accent="sky" maxWidth="max-w-md" onClose={onClose}>
      <ModalHeader
        kicker="Insurance coverage"
        kickerColor="#1D4ED8"
        onClose={onClose}
        subtitle={`${token.patients?.name ?? "Patient"} · #${token.token_number}`}
        title={provider ?? "Self-pay"}
      />

      {policy ? (
        <p className="mt-2 font-mono text-[11px] text-[#8B97AD]">Policy {policy}</p>
      ) : null}

      {/* Breakdown */}
      <div className="qcare-list-item-in mt-5 overflow-hidden rounded-2xl border border-[#DBEAFE] bg-[linear-gradient(145deg,#F0F9FF_0%,#DBEAFE_100%)] p-4" style={{ ["--i" as string]: 0 } as React.CSSProperties}>
        <div className="flex items-baseline justify-between">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#1D4ED8]">
            Covered {coveragePct}%
          </p>
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#8B97AD]">
            Fee ₹{fee}
          </p>
        </div>
        <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-white/70">
          <div
            className="h-full rounded-l-full bg-[linear-gradient(90deg,#3B82F6_0%,#1D4ED8_100%)] transition-[width] duration-700 ease-out"
            style={{ width: `${coveragePct}%` }}
          />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#8B97AD]">
              Insurer pays
            </p>
            <p className="mt-0.5 text-[22px] font-extrabold tabular-nums text-[#1D4ED8]">
              ₹{covered}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#B45309]">
              Out-of-pocket
            </p>
            <p className="mt-0.5 text-[22px] font-extrabold tabular-nums text-[#B45309]">
              ₹{copay}
            </p>
          </div>
        </div>
      </div>

      {/* Policy note */}
      <div className="qcare-list-item-in mt-3 flex items-start gap-2 rounded-2xl border border-[#E2E8F0] bg-white px-3.5 py-2.5" style={{ ["--i" as string]: 1 } as React.CSSProperties}>
        <Sparkles className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[#A5B4FC]" />
        <p className="text-[12px] font-semibold leading-snug text-[#1A2550]">
          {policyNote}
        </p>
      </div>

      {/* Auth warning */}
      {authRequired ? (
        <div className="qcare-list-item-in mt-2 flex items-start gap-2 rounded-2xl border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2.5" style={{ ["--i" as string]: 2 } as React.CSSProperties}>
          <AlertTriangle className="mt-[2px] h-3.5 w-3.5 shrink-0 text-[#B45309]" />
          <p className="text-[12px] font-semibold leading-snug text-[#92400E]">
            Pre-authorization required. Confirm with insurer before consultation.
          </p>
        </div>
      ) : null}

      <div className="qcare-list-item-in mt-5 flex gap-2" style={{ ["--i" as string]: 3 } as React.CSSProperties}>
        {copay > 0 ? (
          <button
            className="group/cta relative flex-1 overflow-hidden rounded-full bg-[linear-gradient(135deg,#3B82F6_0%,#1D4ED8_55%,#1E40AF_100%)] px-5 py-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-white shadow-[0_10px_24px_-10px_rgba(29,78,216,0.7),inset_0_1px_0_rgba(255,255,255,0.22)] transition-all duration-200 hover:-translate-y-[1px] hover:shadow-[0_16px_32px_-10px_rgba(29,78,216,0.85)]"
            onClick={onCollectCopay}
            type="button"
          >
            <span
              aria-hidden
              className="pointer-events-none absolute inset-y-0 -left-full w-1/2 -skew-x-12 bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.35)_50%,transparent_100%)] transition-transform duration-700 ease-out group-hover/cta:translate-x-[300%]"
            />
            <span className="relative z-10 inline-flex items-center gap-1.5">
              Collect ₹{copay} copay
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          </button>
        ) : null}
        <button
          className="rounded-full border border-[#E2E8F0] bg-white px-4 py-2.5 text-[11px] font-bold uppercase tracking-[0.16em] text-[#1A2550] transition hover:border-[#CBD5E1]"
          onClick={onClose}
          type="button"
        >
          Done
        </button>
      </div>

      <p className="mt-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">
        Demo · estimates only
      </p>
    </ModalShell>
  );
}

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
