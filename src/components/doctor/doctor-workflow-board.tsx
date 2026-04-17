"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { Doctor, TokenStatus } from "@/lib/utils/types";

type QueueItem = {
  id: string;
  token_number: number;
  status: TokenStatus;
  checkin_channel: string;
  checked_in_at: string;
  raw_complaint: string | null;
  hold_until: string | null;
  hold_note: string | null;
  patients: { name?: string | null; phone?: string | null } | null;
};

type QueueSummary = {
  total: number;
  waiting: number;
  serving: number;
  complete: number;
  skipped: number;
  steppedOut: number;
};

const STATUS_STYLES: Record<TokenStatus, string> = {
  waiting: "bg-sky-100 text-sky-700",
  serving: "bg-emerald-100 text-emerald-700",
  complete: "bg-indigo-100 text-indigo-700",
  skipped: "bg-amber-100 text-amber-700",
  stepped_out: "bg-violet-100 text-violet-700"
};

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function statusLabel(status: TokenStatus) {
  if (status === "serving") {
    return "In consultation";
  }
  if (status === "complete") {
    return "Consultation done";
  }
  if (status === "stepped_out") {
    return "Hold slot";
  }
  if (status === "waiting") {
    return "Waiting";
  }
  return "Skipped";
}

export function DoctorWorkflowBoard({
  doctor
}: {
  doctor: Doctor;
}) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [summary, setSummary] = useState<QueueSummary>({
    total: 0,
    waiting: 0,
    serving: 0,
    complete: 0,
    skipped: 0,
    steppedOut: 0
  });
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [queuePausedUntil, setQueuePausedUntil] = useState<string | null>(null);
  const [pauseMinutes, setPauseMinutes] = useState(20);
  const [pauseReason, setPauseReason] = useState<
    "personal_emergency" | "medical_emergency" | "other"
  >("personal_emergency");
  const [pauseNote, setPauseNote] = useState("");

  const currentServing = useMemo(
    () => queue.find((item) => item.status === "serving") ?? null,
    [queue]
  );
  const nextWaiting = useMemo(
    () => queue.find((item) => item.status === "waiting") ?? null,
    [queue]
  );

  const refreshQueue = useCallback(async () => {
    try {
      const response = await fetch(`/api/queue/status?doctorId=${doctor.id}`, {
        method: "GET",
        cache: "no-store"
      });
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        queue?: QueueItem[];
        summary?: QueueSummary;
        queuePause?: { ends_at?: string | null } | null;
        now?: string;
      };

      if (!response.ok || !payload.queue || !payload.summary) {
        setError(payload.error ?? "Could not load doctor queue.");
        return;
      }

      setError(null);
      setQueue(payload.queue);
      setSummary(payload.summary);
      setQueuePausedUntil(payload.queuePause?.ends_at ?? null);
      setLastRefreshedAt(payload.now ?? new Date().toISOString());
      window.dispatchEvent(new CustomEvent("qcare:queue-refresh"));
    } catch (fetchError) {
      console.error("[QCare] doctor queue refresh failed:", fetchError);
      setError(
        "Could not reach queue service. Please confirm the app/API is running, then refresh."
      );
    }
  }, [doctor.id]);

  async function runQueueAction(
    action:
      | "start_consultation"
      | "mark_consultation_done"
      | "skip"
      | "hold_slot"
      | "return_to_waiting",
    tokenId?: string
  ) {
    setIsWorking(true);
    try {
      const response = await fetch("/api/queue/action", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action,
          doctorId: doctor.id,
          tokenId,
          holdNote:
            action === "hold_slot"
              ? "Doctor marked Hold slot."
              : undefined
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Could not update token.");
        setIsWorking(false);
        return;
      }

      await refreshQueue();
    } catch (fetchError) {
      console.error("[QCare] doctor queue action failed:", fetchError);
      setError("Network error while updating queue. Please try again.");
      setIsWorking(false);
      return;
    }
    setIsWorking(false);
  }

  async function runNextFlow() {
    setIsWorking(true);
    try {
      const response = await fetch("/api/queue/next", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ doctorId: doctor.id })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Could not advance queue.");
        setIsWorking(false);
        return;
      }

      await refreshQueue();
    } catch (fetchError) {
      console.error("[QCare] doctor queue next-flow failed:", fetchError);
      setError("Network error while advancing queue. Please try again.");
      setIsWorking(false);
      return;
    }
    setIsWorking(false);
  }

  async function pauseQueue() {
    setIsWorking(true);
    try {
      const response = await fetch("/api/queue/pause", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "pause",
          doctorId: doctor.id,
          pauseMinutes,
          reason: pauseReason,
          note: pauseNote.trim() || undefined
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Could not pause queue.");
        setIsWorking(false);
        return;
      }

      await refreshQueue();
    } catch (fetchError) {
      console.error("[QCare] doctor queue pause failed:", fetchError);
      setError("Network error while pausing queue. Please try again.");
      setIsWorking(false);
      return;
    }
    setIsWorking(false);
  }

  async function resumeQueue() {
    setIsWorking(true);
    try {
      const response = await fetch("/api/queue/pause", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "resume",
          doctorId: doctor.id
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        setError(payload.error ?? "Could not resume queue.");
        setIsWorking(false);
        return;
      }

      await refreshQueue();
    } catch (fetchError) {
      console.error("[QCare] doctor queue resume failed:", fetchError);
      setError("Network error while resuming queue. Please try again.");
      setIsWorking(false);
      return;
    }
    setIsWorking(false);
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

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Doctor queue actions</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage {doctor.name}&apos;s queue transitions. Updates sync with
              reception board and patient tracking.
            </p>
          </div>
          <Button onClick={() => void refreshQueue()} type="button" variant="outline">
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatPill label="Total" value={summary.total} />
            <StatPill label="Waiting" value={summary.waiting} />
            <StatPill label="Serving" value={summary.serving} />
          </div>

          {lastRefreshedAt ? (
            <p className="text-xs text-muted-foreground">
              Last refresh: {formatTime(lastRefreshedAt)}
            </p>
          ) : null}

          {error ? (
            <Card className="border-rose-300/60 bg-rose-50/85">
              <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
            </Card>
          ) : null}

          <Card className="qcare-panel-soft">
            <CardHeader>
              <CardTitle className="text-base">Doctor queue pause</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3">
              {queuePausedUntil ? (
                <p className="text-sm text-amber-600">
                  Queue paused until {formatTime(queuePausedUntil)}.
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">Queue is active.</p>
              )}
              <div className="grid gap-3 md:grid-cols-3">
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Pause minutes</span>
                  <input
                    className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                    min={1}
                    onChange={(event) => setPauseMinutes(Number(event.target.value))}
                    type="number"
                    value={pauseMinutes}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Reason</span>
                  <select
                    className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                    onChange={(event) =>
                      setPauseReason(
                        event.target.value as "personal_emergency" | "medical_emergency" | "other"
                      )
                    }
                    value={pauseReason}
                  >
                    <option value="personal_emergency">Personal emergency</option>
                    <option value="medical_emergency">Medical emergency</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  <span className="font-medium">Note (optional)</span>
                  <input
                    className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                    onChange={(event) => setPauseNote(event.target.value)}
                    placeholder="Optional note"
                    value={pauseNote}
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={isWorking} onClick={() => void pauseQueue()} type="button" variant="outline">
                  Pause queue
                </Button>
                <Button disabled={isWorking} onClick={() => void resumeQueue()} type="button" variant="outline">
                  Resume queue
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="qcare-panel-soft">
            <CardHeader>
              <CardTitle className="text-base">Current serving</CardTitle>
            </CardHeader>
            <CardContent>
              {!currentServing ? (
                <p className="text-sm text-muted-foreground">
                  Nobody is serving right now.
                </p>
              ) : (
                <div className="grid gap-2 text-sm">
                  <p className="font-semibold">
                    #{currentServing.token_number} ·{" "}
                    {currentServing.patients?.name ?? "Patient"}
                  </p>
                  <p className="text-muted-foreground">
                    {currentServing.raw_complaint ?? "No complaint text"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      disabled={isWorking}
                      onClick={() =>
                        void runQueueAction("mark_consultation_done", currentServing.id)
                      }
                      type="button"
                    >
                      Consultation done
                    </Button>
                    <Button
                      disabled={isWorking}
                      onClick={() => void runNextFlow()}
                      type="button"
                      variant="outline"
                    >
                      Done + call next
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="qcare-panel-soft">
            <CardHeader>
              <CardTitle className="text-base">Next waiting</CardTitle>
            </CardHeader>
            <CardContent>
              {!nextWaiting ? (
                <p className="text-sm text-muted-foreground">
                  No waiting patients in queue.
                </p>
              ) : (
                <div className="grid gap-2 text-sm">
                  <p className="font-semibold">
                    #{nextWaiting.token_number} · {nextWaiting.patients?.name ?? "Patient"}
                  </p>
                  <p className="text-muted-foreground">
                    {nextWaiting.raw_complaint ?? "No complaint text"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button
                      disabled={isWorking || Boolean(currentServing) || Boolean(queuePausedUntil)}
                      onClick={() => void runQueueAction("start_consultation", nextWaiting.id)}
                      type="button"
                    >
                      Start consultation
                    </Button>
                    <Button
                      disabled={isWorking}
                      onClick={() => void runQueueAction("skip", nextWaiting.id)}
                      type="button"
                      variant="outline"
                    >
                      Skip
                    </Button>
                    <Button
                      disabled={isWorking}
                      onClick={() => void runQueueAction("hold_slot", nextWaiting.id)}
                      type="button"
                      variant="outline"
                    >
                      Hold slot
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Today&apos;s queue</CardTitle>
        </CardHeader>
        <CardContent>
          {queue.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tokens yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-border/70 bg-white/75">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3">Token</th>
                    <th className="px-4 py-3">Patient</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Check-in</th>
                    <th className="px-4 py-3">Tracking</th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map((item) => (
                    <tr className="border-b border-border/60 last:border-0" key={item.id}>
                      <td className="px-4 py-3 font-semibold">#{item.token_number}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium">{item.patients?.name ?? "Patient"}</p>
                        <p className="text-xs text-muted-foreground">
                          {item.patients?.phone ?? "No phone"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
                            STATUS_STYLES[item.status]
                          )}
                        >
                          {statusLabel(item.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">{formatTime(item.checked_in_at)}</td>
                      <td className="px-4 py-3">
                        <Link className="text-primary hover:underline" href={`/track/${item.id}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-white/75 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
