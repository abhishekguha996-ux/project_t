"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DoctorPulse, type PulseContext } from "@/components/doctor/doctor-pulse";
import { cn } from "@/lib/utils/cn";
import type { Doctor, TokenStatus } from "@/lib/utils/types";

type QueueItem = {
  id: string;
  token_number: number;
  status: TokenStatus;
  raw_complaint: string | null;
  hold_until: string | null;
  hold_note: string | null;
  consult_duration_seconds?: number | null;
  patient_id?: string | null;
  patients: {
    name?: string | null;
    phone?: string | null;
    age?: number | null;
    gender?: "male" | "female" | "other" | null;
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

type PatientGender = NonNullable<QueueItem["patients"]>["gender"];

function getInitial(name: string | null | undefined) {
  return (name ?? "P").charAt(0).toUpperCase();
}

function formatGender(gender: PatientGender) {
  if (!gender) return null;
  if (gender === "male") return "Male";
  if (gender === "female") return "Female";
  return "Other";
}

function formatPatientProfile(item: QueueItem | null) {
  if (!item) return "Profile pending";

  const age = item.patients?.age;
  const gender = formatGender(item.patients?.gender ?? null);

  if (typeof age === "number" && gender) {
    return `${age} y/o • ${gender}`;
  }

  if (typeof age === "number") {
    return `${age} y/o`;
  }

  if (gender) {
    return gender;
  }

  if (item.patients?.phone) {
    return item.patients.phone;
  }

  return "Profile pending";
}

function formatAverageConsultTime(queue: QueueItem[]) {
  const completeDurations = queue
    .map((item) => item.consult_duration_seconds)
    .filter(
      (value): value is number => typeof value === "number" && value > 0
    );

  if (completeDurations.length === 0) {
    return "--";
  }

  const avgSeconds =
    completeDurations.reduce((sum, value) => sum + value, 0) /
    completeDurations.length;
  const avgMinutes = Math.max(1, Math.round(avgSeconds / 60));

  return `${avgMinutes}m`;
}

const heroHeadlineClass =
  "text-[72px] font-extrabold leading-[0.95] tracking-[-0.06em] text-slate-900 sm:text-[96px] md:text-[120px] lg:text-[140px]";
const heroSubcopyClass =
  "mx-auto max-w-2xl text-balance text-xl font-medium leading-relaxed text-slate-500 md:text-2xl";
const glassCardClass =
  "w-full max-w-2xl rounded-[44px] border border-white bg-white/85 p-8 shadow-2xl shadow-slate-200/50 backdrop-blur-[30px] sm:rounded-[56px] sm:p-12 lg:p-14";
const primaryActionClass =
  "w-full rounded-[28px] bg-slate-900 py-6 text-xs font-bold uppercase tracking-[0.2em] text-white shadow-xl transition-all hover:bg-black active:scale-95 disabled:opacity-60 sm:rounded-[32px] sm:py-8 sm:text-sm";

export function DoctorWorkflowBoard({
  doctor,
  allDoctors = [],
}: {
  doctor: Doctor;
  allDoctors?: Doctor[];
}) {
  const router = useRouter();
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [summary, setSummary] = useState<QueueSummary>({
    total: 0,
    waiting: 0,
    serving: 0,
    complete: 0,
    skipped: 0,
    steppedOut: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [isQueueActionWorking, setIsQueueActionWorking] = useState(false);
  const [isPauseToggleWorking, setIsPauseToggleWorking] = useState(false);
  const [queuePausedUntil, setQueuePausedUntil] = useState<string | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string>("");

  const isPaused = Boolean(queuePausedUntil);

  const currentServing = useMemo(
    () => queue.find((item) => item.status === "serving") ?? null,
    [queue]
  );
  const nextWaiting = useMemo(
    () => queue.find((item) => item.status === "waiting") ?? null,
    [queue]
  );

  const avgConsultTime = useMemo(() => formatAverageConsultTime(queue), [queue]);
  const waitingProfile = useMemo(
    () => formatPatientProfile(nextWaiting),
    [nextWaiting]
  );
  const servingProfile = useMemo(
    () => formatPatientProfile(currentServing),
    [currentServing]
  );

  const pulseContext = useMemo<PulseContext>(() => {
    const bound = currentServing ?? nextWaiting;
    if (!bound || !bound.patient_id) return null;
    return {
      patientId: bound.patient_id,
      tokenId: bound.id,
      patientName: bound.patients?.name ?? "Patient",
      phase: bound.status === "serving" ? "serving" : "waiting",
      age: bound.patients?.age ?? null,
      gender: bound.patients?.gender ?? null,
    };
  }, [currentServing, nextWaiting]);

  const refreshQueue = useCallback(async () => {
    try {
      console.log("[QCare] refreshQueue called for doctor:", doctor.id);
      const response = await fetch(`/api/queue/status?doctorId=${doctor.id}`, {
        method: "GET",
        cache: "no-store",
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        queue?: QueueItem[];
        summary?: QueueSummary;
        queuePause?: { ends_at?: string | null } | null;
      };

      console.log("[QCare] refreshQueue response:", {
        ok: response.ok,
        queueLength: payload.queue?.length,
        serving: payload.queue?.find((i) => i.status === "serving")?.id,
        waiting: payload.queue?.find((i) => i.status === "waiting")?.id,
        error: payload.error
      });

      if (!response.ok || !payload.queue || !payload.summary) {
        setError(payload.error ?? "Could not load doctor queue.");
        return;
      }

      setError(null);
      setQueue(payload.queue);
      setSummary(payload.summary);
      setQueuePausedUntil(payload.queuePause?.ends_at ?? null);
      setLastSyncTime(new Date().toLocaleTimeString());
      window.dispatchEvent(new CustomEvent("qcare:queue-refresh"));
    } catch (fetchError) {
      console.error("[QCare] doctor queue refresh failed:", fetchError);
      setError("Could not reach queue service. Please refresh.");
    }
  }, [doctor.id]);

  async function runQueueAction(
    action: "start_consultation" | "mark_consultation_done" | "hold_slot",
    tokenId: string
  ) {
    console.log("[QCare] runQueueAction called:", { action, tokenId });
    setIsQueueActionWorking(true);
    try {
      if (action === "start_consultation" && isPaused) {
        const resumeResponse = await fetch("/api/queue/pause", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "resume", doctorId: doctor.id }),
        });
        const resumePayload = (await resumeResponse.json().catch(() => ({}))) as {
          error?: string;
        };
        if (!resumeResponse.ok) {
          setError(
            resumePayload.error ??
              "Could not resume queue before calling patient."
          );
          return;
        }
      }

      const response = await fetch("/api/queue/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          doctorId: doctor.id,
          tokenId,
          holdNote:
            action === "hold_slot" ? "Doctor marked Hold slot." : undefined,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      console.log("[QCare] queue action response:", { ok: response.ok, payload });
      if (!response.ok) {
        setError(payload.error ?? "Could not update token.");
      } else {
        await refreshQueue();
      }
    } catch (fetchError) {
      console.error("[QCare] doctor queue action failed:", fetchError);
      setError("Network error while updating queue. Please try again.");
    } finally {
      setIsQueueActionWorking(false);
    }
  }

  async function pauseQueue() {
    setIsPauseToggleWorking(true);
    try {
      const response = await fetch("/api/queue/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "pause",
          doctorId: doctor.id,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "Could not pause queue.");
      } else {
        await refreshQueue();
      }
    } catch (fetchError) {
      console.error("[QCare] doctor queue pause failed:", fetchError);
      setError("Network error while pausing queue. Please try again.");
    }
    setIsPauseToggleWorking(false);
  }

  async function resumeQueue() {
    setIsPauseToggleWorking(true);
    try {
      const response = await fetch("/api/queue/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume", doctorId: doctor.id }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error ?? "Could not resume queue.");
      } else {
        await refreshQueue();
      }
    } catch (fetchError) {
      console.error("[QCare] doctor queue resume failed:", fetchError);
      setError("Network error while resuming queue. Please try again.");
    }
    setIsPauseToggleWorking(false);
  }

  useEffect(() => {
    void refreshQueue();
    const interval = window.setInterval(() => {
      void refreshQueue();
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [refreshQueue]);

  // Log state changes for debugging
  useEffect(() => {
    console.log("[QCare] State changed:", {
      currentServing: currentServing?.id,
      nextWaiting: nextWaiting?.id,
      queueLength: queue.length
    });
  }, [currentServing, nextWaiting, queue]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#FBFBFD]">
      {/* Aura */}
      <div
        className="pointer-events-none fixed -right-[10%] -top-[10%] z-0 h-[1000px] w-[1000px] rounded-full opacity-40 transition-all duration-700"
        style={{
          background: isPaused
            ? "radial-gradient(circle, rgba(245,158,11,0.2) 0%, transparent 70%)"
            : "radial-gradient(circle, rgba(16,185,129,0.15) 0%, transparent 70%)",
          filter: "blur(100px)",
        }}
      />

      <div className="relative z-10 flex min-h-screen flex-col p-12 md:p-16">
        {/* Header */}
        <header className="mx-auto mb-20 flex w-full max-w-6xl items-center justify-between">
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">
              Doctor Workspace
            </p>
            {allDoctors.length > 1 ? (
              <select
                value={doctor.id}
                onChange={(e) => router.push(`/doctor?doctorId=${e.target.value}`)}
                className="text-xl font-bold text-slate-900 bg-transparent border-none outline-none cursor-pointer appearance-none pr-5"
                style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0 center' }}
              >
                {allDoctors.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            ) : (
              <h1 className="text-xl font-bold text-slate-900">{doctor.name}</h1>
            )}
          </div>

          <button
            disabled={isPauseToggleWorking}
            onClick={() => {
              if (isPaused) void resumeQueue();
              else void pauseQueue();
            }}
            className="group flex items-center space-x-3 rounded-full border border-white/80 bg-white/70 px-8 py-3 shadow-sm backdrop-blur-[30px] transition-all active:scale-95 disabled:opacity-60"
          >
            <span
              className={cn(
                "h-2.5 w-2.5 rounded-full",
                isPaused ? "bg-amber-500" : "animate-pulse bg-emerald-500"
              )}
            />
            <span className="text-[11px] font-bold uppercase tracking-widest text-slate-700">
              {isPaused ? "Queue Paused" : "Queue Active"}
            </span>
            <div className="mx-2 h-4 w-[1px] bg-slate-200" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-indigo-600 group-hover:underline">
              {isPaused ? "Resume" : "Pause"}
            </span>
          </button>
        </header>

        {error && (
          <div className="mx-auto mb-8 w-full max-w-lg rounded-2xl border border-rose-200 bg-rose-50/80 px-6 py-4 text-sm text-rose-700 shadow-sm">
            {error}
          </div>
        )}

        <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center">

          {/* Idle / Who's Next */}
          {!currentServing && nextWaiting ? (
            <div className="flex w-full flex-col items-center space-y-12 transition-all duration-500 md:space-y-16">
              <div className="space-y-6 text-center">
                <h2 className={heroHeadlineClass}>
                  Who&apos;s next?
                </h2>
                <p className={heroSubcopyClass}>
                  There are {summary.waiting} patient
                  {summary.waiting !== 1 ? "s" : ""} waiting in your queue.
                </p>
              </div>

              <div className={glassCardClass}>
                <div className="mb-10 flex flex-col gap-8 sm:mb-14 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <span className="mb-5 inline-block rounded-full bg-indigo-50 px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-indigo-600">
                      Next In Line
                    </span>
                    <h3 className="text-[52px] font-extrabold leading-[0.95] tracking-[-0.05em] text-slate-900 sm:text-[68px] md:text-[80px]">
                      {nextWaiting?.patients?.name ?? "Patient"}
                    </h3>
                    <p className="mt-3 text-2xl font-bold text-slate-400 md:text-3xl">
                      {waitingProfile}
                    </p>
                  </div>
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-[26px] bg-slate-900 text-3xl font-black text-white shadow-[0_14px_30px_rgba(15,23,42,0.16)] sm:h-24 sm:w-24 sm:rounded-[28px] sm:text-4xl">
                    {getInitial(nextWaiting?.patients?.name)}
                  </div>
                </div>
                <button
                  disabled={isQueueActionWorking || !nextWaiting}
                  onClick={() => {
                    if (!nextWaiting) return;
                    void runQueueAction("start_consultation", nextWaiting.id);
                  }}
                  className={primaryActionClass}
                >
                  Call Patient
                </button>
              </div>

              {/* Stats pill — inline below card in idle state */}
              <div className="flex items-center space-x-12 rounded-full border border-white bg-white/85 px-10 py-5 shadow-2xl backdrop-blur-[30px]">
                <div className="text-center">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Today</p>
                  <p className="text-xl font-black text-slate-900">{summary.complete}</p>
                </div>
                <div className="h-8 w-[1px] bg-slate-100" />
                <div className="text-center">
                  <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-500">Avg Time</p>
                  <p className="text-xl font-black text-emerald-600">{avgConsultTime}</p>
                </div>
              </div>
            </div>
          ) : null}

          {/* Active / Currently Serving */}
          {currentServing && (
            <div className="w-full max-w-5xl space-y-12 pt-20 transition-all duration-500">
              <div className="space-y-3">
                <span className="text-[11px] font-bold uppercase tracking-[0.3em] text-indigo-600">
                  Currently Serving
                </span>
                <h2 className="text-9xl font-black leading-none tracking-tighter text-slate-900">
                  {currentServing?.patients?.name ?? "Patient"}
                </h2>
                <p className="text-4xl font-bold tracking-tight text-slate-400">
                  {servingProfile}
                </p>
              </div>

              <div className="overflow-hidden rounded-[54px] border border-white bg-white/80 shadow-2xl shadow-slate-200/40 backdrop-blur-[40px]">
                <div className="grid grid-cols-4 border-b border-slate-100 bg-white/50">
                  <div className="border-r border-slate-50 p-8 text-center">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Heart Rate
                    </p>
                    <p className="text-2xl font-black text-slate-900">
                      88<span className="ml-1 text-sm font-medium text-slate-300">bpm</span>
                    </p>
                  </div>
                  <div className="border-r border-slate-50 p-8 text-center">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Temp
                    </p>
                    <p className="text-2xl font-black text-slate-900">
                      99.1<span className="ml-1 text-sm font-medium text-slate-300">°F</span>
                    </p>
                  </div>
                  <div className="border-r border-slate-50 p-8 text-center">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Oxygen
                    </p>
                    <p className="text-2xl font-black text-slate-900">
                      99<span className="ml-1 text-sm font-medium text-slate-300">%</span>
                    </p>
                  </div>
                  <div className="p-8 text-center">
                    <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Weight
                    </p>
                    <p className="text-2xl font-black text-slate-900">
                      22<span className="ml-1 text-sm font-medium text-slate-300">kg</span>
                    </p>
                  </div>
                </div>
                <div className="space-y-10 p-12">
                  <div className="space-y-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">
                      Reason for Visit
                    </p>
                    <p className="text-3xl font-semibold leading-tight tracking-tight text-slate-800">
                      &ldquo;
                      {currentServing?.raw_complaint?.trim() ||
                        "No reason recorded for this visit."}
                      &rdquo;
                    </p>
                  </div>
                  <div className="flex flex-col gap-5 pt-4 sm:flex-row sm:items-center sm:gap-0 sm:space-x-5">
                    <button
                      disabled={isQueueActionWorking || !currentServing}
                      onClick={() => {
                        if (!currentServing) return;
                        void runQueueAction("mark_consultation_done", currentServing.id);
                      }}
                      className="flex-1 rounded-[32px] bg-slate-900 py-8 text-sm font-bold uppercase tracking-widest text-white shadow-2xl transition-all hover:bg-black active:scale-[0.985] disabled:opacity-60"
                    >
                      Complete Consultation
                    </button>
                    <button
                      disabled={isQueueActionWorking || !currentServing}
                      onClick={() => {
                        if (!currentServing) return;
                        void runQueueAction("hold_slot", currentServing.id);
                      }}
                      className="rounded-[30px] border border-slate-200 bg-white px-14 py-6 text-[11px] font-bold uppercase tracking-[0.2em] text-slate-900 transition-all hover:bg-slate-50 active:scale-[0.98] disabled:opacity-60"
                    >
                      Hold
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Empty queue */}
          {!currentServing && !nextWaiting && (
            <div className="flex w-full flex-col items-center space-y-12 text-center transition-all duration-500 md:space-y-16">
              <div className="space-y-6">
                <h2 className={heroHeadlineClass}>
                  Who&apos;s next?
                </h2>
                <p className={heroSubcopyClass}>
                  No patients are waiting in your queue.
                </p>
              </div>

              <div className={glassCardClass}>
                <div className="mx-auto mb-10 flex h-28 w-28 items-center justify-center rounded-[36px] bg-slate-900 shadow-[0_22px_44px_rgba(15,23,42,0.16)] sm:h-32 sm:w-32 sm:rounded-[40px]">
                  <div className="relative h-12 w-12 rounded-full border-[6px] border-white/95">
                    <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-emerald-300" />
                    <span className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
                  </div>
                </div>
                <div className="mx-auto mb-10 max-w-xl space-y-3">
                  <span className="inline-block rounded-full bg-emerald-50 px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-emerald-600">
                    Queue Clear
                  </span>
                  <h3 className="text-4xl font-extrabold tracking-[-0.05em] text-slate-900 sm:text-5xl">
                    You&apos;re all caught up.
                  </h3>
                  <p className="text-lg font-semibold leading-relaxed text-slate-400 sm:text-xl">
                    We&apos;ll keep listening for the next check-in and refresh
                    this console automatically.
                  </p>
                </div>
                <button
                  onClick={() => void refreshQueue()}
                  className={primaryActionClass}
                >
                  Refresh Queue
                </button>
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Live sync footer */}
      <div className="fixed bottom-4 left-0 right-0 z-30 flex justify-center">
        <span className="text-[9px] font-bold uppercase tracking-[0.4em] text-slate-900/30">
          Live Update • Last Sync {lastSyncTime || "--:--:--"}
        </span>
      </div>

      <DoctorPulse context={pulseContext} />
    </div>
  );
}
