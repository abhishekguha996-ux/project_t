"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatQueuePauseReason } from "@/lib/queue/labels";
import { cn } from "@/lib/utils/cn";
import type {
  AppRole,
  CheckoutStage,
  Doctor,
  QueuePauseReason,
  TokenStatus
} from "@/lib/utils/types";

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
  doctors: { name?: string | null; status?: string | null } | null;
  checkout: {
    checkout_stage: CheckoutStage;
    payment_status: string;
    pharmacy_status: string;
    lab_status: string;
    closed_at: string | null;
  } | null;
};

type QueuePause = {
  id: string;
  reason: QueuePauseReason;
  note: string | null;
  ends_at: string;
};

type QueueSummary = {
  total: number;
  waiting: number;
  serving: number;
  complete: number;
  skipped: number;
  steppedOut: number;
};

const CONSULTATION_LANES: Array<{ status: TokenStatus; title: string }> = [
  { status: "waiting", title: "Waiting" },
  { status: "serving", title: "In consultation" },
  { status: "stepped_out", title: "Hold slot" },
  { status: "complete", title: "Consultation done" },
  { status: "skipped", title: "Skipped" }
];

const CHECKOUT_LANES: Array<{ stage: CheckoutStage; title: string }> = [
  { stage: "awaiting_payment", title: "Awaiting payment" },
  { stage: "payment_done", title: "Payment done" },
  { stage: "pharmacy_pickup", title: "Pharmacy pickup" },
  { stage: "referred_for_lab", title: "Referred for lab" },
  { stage: "visit_closed", title: "Visit closed" }
];

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatCountdown(value: string) {
  const delta = new Date(value).getTime() - Date.now();
  if (delta <= 0) {
    return "expired";
  }
  const minutes = Math.ceil(delta / 60_000);
  return `${minutes}m left`;
}

export function ReceptionQueueBoard({
  doctors,
  actorRole
}: {
  doctors: Doctor[];
  actorRole: AppRole;
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
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [dragTokenId, setDragTokenId] = useState<string | null>(null);
  const [holdToken, setHoldToken] = useState<QueueItem | null>(null);
  const [holdMinutes, setHoldMinutes] = useState(5);
  const [holdNote, setHoldNote] = useState("");
  const [pauseMinutes, setPauseMinutes] = useState(20);
  const [pauseReason, setPauseReason] = useState<QueuePauseReason>("personal_emergency");
  const [pauseNote, setPauseNote] = useState("");
  const [activePause, setActivePause] = useState<QueuePause | null>(null);

  const hasDoctorSelected = Boolean(doctorId);
  const selectedDoctorName = useMemo(
    () => doctors.find((doctor) => doctor.id === doctorId)?.name ?? "Doctor",
    [doctorId, doctors]
  );

  const consultationByStatus = useMemo(() => {
    return CONSULTATION_LANES.reduce(
      (accumulator, lane) => {
        accumulator[lane.status] = queue.filter((item) => item.status === lane.status);
        return accumulator;
      },
      {
        waiting: [] as QueueItem[],
        serving: [] as QueueItem[],
        stepped_out: [] as QueueItem[],
        complete: [] as QueueItem[],
        skipped: [] as QueueItem[]
      }
    );
  }, [queue]);

  const checkoutByStage = useMemo(() => {
    return CHECKOUT_LANES.reduce(
      (accumulator, lane) => {
        accumulator[lane.stage] = queue.filter(
          (item) => item.status === "complete" && (item.checkout?.checkout_stage ?? "awaiting_payment") === lane.stage
        );
        return accumulator;
      },
      {
        awaiting_payment: [] as QueueItem[],
        payment_done: [] as QueueItem[],
        pharmacy_pickup: [] as QueueItem[],
        referred_for_lab: [] as QueueItem[],
        visit_closed: [] as QueueItem[]
      }
    );
  }, [queue]);

  const refreshQueue = useCallback(async () => {
    if (!hasDoctorSelected) {
      setQueue([]);
      return;
    }

    const response = await fetch(`/api/queue/status?doctorId=${doctorId}`, {
      method: "GET",
      cache: "no-store"
    });
    const payload = (await response.json()) as {
      error?: string;
      queue?: QueueItem[];
      summary?: QueueSummary;
      queuePause?: QueuePause | null;
      now?: string;
    };

    if (!response.ok || !payload.queue || !payload.summary) {
      setError(payload.error ?? "Could not load queue board.");
      return;
    }

    setError(null);
    setQueue(payload.queue);
    setSummary(payload.summary);
    setActivePause(payload.queuePause ?? null);
    setLastRefreshedAt(payload.now ?? new Date().toISOString());
  }, [doctorId, hasDoctorSelected]);

  useEffect(() => {
    void refreshQueue();
    const interval = window.setInterval(() => {
      void refreshQueue();
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [refreshQueue]);

  async function runQueueAction(payload: {
    action:
      | "start_consultation"
      | "mark_consultation_done"
      | "skip"
      | "hold_slot"
      | "return_to_waiting";
    tokenId: string;
    holdMinutes?: number;
    holdNote?: string;
  }) {
    if (!hasDoctorSelected) {
      setError("Select doctor before changing queue state.");
      return false;
    }

    setIsWorking(true);
    const response = await fetch("/api/queue/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        ...payload,
        doctorId
      })
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "Could not update queue status.");
      setIsWorking(false);
      return false;
    }

    setIsWorking(false);
    setError(null);
    await refreshQueue();
    return true;
  }

  async function runCheckoutAction(tokenId: string, stage: CheckoutStage) {
    setIsWorking(true);
    const response = await fetch("/api/checkout/action", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        tokenId,
        action: stage
      })
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "Could not update checkout stage.");
      setIsWorking(false);
      return;
    }

    setIsWorking(false);
    setError(null);
    await refreshQueue();
  }

  async function pauseQueue() {
    if (!doctorId) {
      setError("Select doctor before pausing queue.");
      return;
    }

    setIsWorking(true);
    const response = await fetch("/api/queue/pause", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "pause",
        doctorId,
        pauseMinutes,
        reason: pauseReason,
        note: pauseNote.trim() || undefined
      })
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "Could not pause queue.");
      setIsWorking(false);
      return;
    }

    setIsWorking(false);
    setError(null);
    await refreshQueue();
  }

  async function resumeQueue() {
    if (!doctorId) {
      setError("Select doctor before resuming queue.");
      return;
    }

    setIsWorking(true);
    const response = await fetch("/api/queue/pause", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        action: "resume",
        doctorId
      })
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "Could not resume queue.");
      setIsWorking(false);
      return;
    }

    setIsWorking(false);
    setError(null);
    await refreshQueue();
  }

  function resolveDropToConsultation(targetStatus: TokenStatus, item: QueueItem) {
    if (targetStatus === item.status) {
      return;
    }

    if (targetStatus === "serving" && item.status === "waiting") {
      void runQueueAction({ action: "start_consultation", tokenId: item.id });
      return;
    }

    if (targetStatus === "complete" && item.status === "serving") {
      void runQueueAction({ action: "mark_consultation_done", tokenId: item.id });
      return;
    }

    if (targetStatus === "skipped" && (item.status === "waiting" || item.status === "serving" || item.status === "stepped_out")) {
      void runQueueAction({ action: "skip", tokenId: item.id });
      return;
    }

    if (targetStatus === "stepped_out" && (item.status === "waiting" || item.status === "serving")) {
      setHoldToken(item);
      setHoldNote("");
      return;
    }

    if (targetStatus === "waiting" && (item.status === "stepped_out" || item.status === "skipped")) {
      void runQueueAction({ action: "return_to_waiting", tokenId: item.id });
      return;
    }

    setError(`Cannot move from ${item.status} to ${targetStatus} with drag action.`);
  }

  function renderTokenCard(item: QueueItem) {
    return (
      <div
        className="rounded-xl border border-border/70 bg-white p-3"
        draggable={!isWorking}
        key={item.id}
        onDragStart={() => setDragTokenId(item.id)}
        onDragEnd={() => setDragTokenId(null)}
      >
        <p className="text-sm font-semibold">
          #{item.token_number} · {item.patients?.name ?? "Patient"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {item.patients?.phone ?? "No phone"} · {formatTime(item.checked_in_at)}
        </p>
        {item.raw_complaint ? (
          <p className="mt-1 text-xs text-muted-foreground">{item.raw_complaint}</p>
        ) : null}
        {item.hold_until ? (
          <p className="mt-1 text-xs text-amber-600">
            Hold window: {formatCountdown(item.hold_until)}
          </p>
        ) : null}
        {item.hold_note ? (
          <p className="mt-1 text-xs text-muted-foreground">Note: {item.hold_note}</p>
        ) : null}
        <div className="mt-2 flex flex-wrap gap-2">
          {item.status === "waiting" ? (
            <Button
              disabled={isWorking || Boolean(activePause)}
              onClick={() => void runQueueAction({ action: "start_consultation", tokenId: item.id })}
              size="sm"
              type="button"
              variant="outline"
            >
              Start consultation
            </Button>
          ) : null}
          {item.status === "serving" ? (
            <Button
              disabled={isWorking}
              onClick={() => void runQueueAction({ action: "mark_consultation_done", tokenId: item.id })}
              size="sm"
              type="button"
              variant="outline"
            >
              Consultation done
            </Button>
          ) : null}
          {(item.status === "waiting" || item.status === "serving") ? (
            <Button
              disabled={isWorking}
              onClick={() => setHoldToken(item)}
              size="sm"
              type="button"
              variant="outline"
            >
              Hold slot
            </Button>
          ) : null}
          {item.status === "stepped_out" || item.status === "skipped" ? (
            <Button
              disabled={isWorking}
              onClick={() => void runQueueAction({ action: "return_to_waiting", tokenId: item.id })}
              size="sm"
              type="button"
              variant="outline"
            >
              Move to waiting
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <CardTitle>Reception queue board</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Full-screen operational lanes for consultation and checkout transitions.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
              onChange={(event) => setDoctorId(event.target.value)}
              value={doctorId}
            >
              <option value="">Select doctor</option>
              {doctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
            <Button onClick={() => void refreshQueue()} type="button" variant="outline">
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Metric label="Total" value={summary.total} />
            <Metric label="Waiting" value={summary.waiting} />
            <Metric label="In consult" value={summary.serving} />
            <Metric label="Hold slot" value={summary.steppedOut} />
            <Metric label="Consultation done" value={summary.complete} />
            <Metric label="Skipped" value={summary.skipped} />
          </div>
          {lastRefreshedAt ? (
            <p className="text-xs text-muted-foreground">
              Last refresh: {formatTime(lastRefreshedAt)} · Doctor {selectedDoctorName}
            </p>
          ) : null}
          {error ? (
            <Card className="border-rose-300/60 bg-rose-50/85">
              <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
            </Card>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Doctor pause (queue hold)</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {activePause ? (
            <p className="rounded-2xl border border-amber-300/60 bg-amber-50/90 p-3 text-sm text-amber-800">
              Queue paused for {selectedDoctorName} until {formatTime(activePause.ends_at)} · Reason:{" "}
              {formatQueuePauseReason(activePause.reason)}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Queue is active.</p>
          )}
          <div className="grid gap-3 md:grid-cols-4">
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
                onChange={(event) => setPauseReason(event.target.value as QueuePauseReason)}
                value={pauseReason}
              >
                <option value="personal_emergency">Personal emergency</option>
                <option value="medical_emergency">Medical emergency</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label className="grid gap-1 text-sm md:col-span-2">
              <span className="font-medium">Note (optional)</span>
              <input
                className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                onChange={(event) => setPauseNote(event.target.value)}
                placeholder="Reason details"
                value={pauseNote}
              />
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={isWorking || !hasDoctorSelected} onClick={() => void pauseQueue()} type="button">
              Pause queue
            </Button>
            <Button
              disabled={isWorking || !hasDoctorSelected}
              onClick={() => void resumeQueue()}
              type="button"
              variant="outline"
            >
              Resume queue
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Consultation lanes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-5">
            {CONSULTATION_LANES.map((lane) => (
              <div
                className="rounded-2xl border border-border/70 bg-white/75 p-3"
                key={lane.status}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!dragTokenId) {
                    return;
                  }
                  const item = queue.find((token) => token.id === dragTokenId);
                  if (!item) {
                    return;
                  }
                  resolveDropToConsultation(lane.status, item);
                  setDragTokenId(null);
                }}
              >
                <p className="mb-2 text-sm font-semibold">{lane.title}</p>
                <div className="grid gap-2">
                  {consultationByStatus[lane.status].length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tokens</p>
                  ) : (
                    consultationByStatus[lane.status].map((item) => renderTokenCard(item))
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Checkout lanes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 lg:grid-cols-5">
            {CHECKOUT_LANES.map((lane) => (
              <div
                className="rounded-2xl border border-border/70 bg-white/75 p-3"
                key={lane.stage}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (!dragTokenId) {
                    return;
                  }
                  const item = queue.find((token) => token.id === dragTokenId);
                  if (!item || item.status !== "complete") {
                    return;
                  }
                  void runCheckoutAction(item.id, lane.stage);
                  setDragTokenId(null);
                }}
              >
                <p className="mb-2 text-sm font-semibold">{lane.title}</p>
                <div className="grid gap-2">
                  {checkoutByStage[lane.stage].length === 0 ? (
                    <p className="text-xs text-muted-foreground">No tokens</p>
                  ) : (
                    checkoutByStage[lane.stage].map((item) => (
                      <div
                        className={cn(
                          "rounded-xl border border-border/70 bg-white p-3",
                          lane.stage === "visit_closed" && "opacity-80"
                        )}
                        draggable={!isWorking}
                        key={`${lane.stage}-${item.id}`}
                        onDragStart={() => setDragTokenId(item.id)}
                        onDragEnd={() => setDragTokenId(null)}
                      >
                        <p className="text-sm font-semibold">
                          #{item.token_number} · {item.patients?.name ?? "Patient"}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {item.checkout?.checkout_stage ?? "awaiting_payment"}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {holdToken ? (
        <Card className="border-primary/25 bg-indigo-50/70">
          <CardHeader>
            <CardTitle>Hold slot for token #{holdToken.token_number}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            <p className="text-sm text-muted-foreground">
              Hold slot keeps this patient&apos;s place temporarily. Receptionist note is mandatory.
            </p>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Hold minutes</span>
              <input
                className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                min={1}
                onChange={(event) => setHoldMinutes(Number(event.target.value))}
                type="number"
                value={holdMinutes}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span className="font-medium">Note</span>
              <textarea
                className="min-h-24 rounded-2xl border border-input bg-white px-3 py-2 text-[13px]"
                onChange={(event) => setHoldNote(event.target.value)}
                placeholder="Why is Hold slot needed?"
                required
                value={holdNote}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  isWorking ||
                  holdNote.trim().length < (actorRole === "receptionist" ? 8 : 1)
                }
                onClick={() => {
                  void runQueueAction({
                    action: "hold_slot",
                    tokenId: holdToken.id,
                    holdMinutes,
                    holdNote: holdNote.trim()
                  }).then((ok) => {
                    if (ok) {
                      setHoldToken(null);
                      setHoldNote("");
                    }
                  });
                }}
                type="button"
              >
                Confirm hold slot
              </Button>
              <Button
                onClick={() => {
                  setHoldToken(null);
                  setHoldNote("");
                }}
                type="button"
                variant="outline"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-white/75 p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </div>
  );
}
