"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { AppRole, Doctor, TokenStatus } from "@/lib/utils/types";

type QueueItem = {
  id: string;
  token_number: number;
  status: TokenStatus;
  checkin_channel: string;
  checked_in_at: string;
  serving_started_at?: string | null;
  raw_complaint: string | null;
  hold_until: string | null;
  hold_note: string | null;
  patients: { name?: string | null; phone?: string | null } | null;
  doctors: { name?: string | null; status?: string | null } | null;
};

type QueueSummary = {
  total: number;
  waiting: number;
  serving: number;
  complete: number;
  skipped: number;
  steppedOut: number;
};

type QueuePause = {
  id: string;
  reason: string;
  ends_at: string;
  note: string | null;
};

type NeedsYouItem = {
  id: string;
  severity: "red" | "amber" | "info";
  title: string;
  detail: string;
  primary?: { label: string; run: () => Promise<void> | void };
  secondary?: { label: string; run: () => Promise<void> | void };
};

const RED_FLAG_RE = /chest pain|breathless|breathing|unconscious|bleeding|stroke|seizure|saans|chhati|chaati|dum ghut|dum|paralysis|numb/i;
const AVG_CONSULT_MIN = 8;

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

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function NowConsole({
  doctors,
  clinicId,
  actorRole,
  userLabel
}: {
  doctors: Doctor[];
  clinicId: string;
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
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [lastPulse, setLastPulse] = useState<Date>(new Date());
  const [clock, setClock] = useState<Date>(new Date());
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [copilot, setCopilot] = useState("");
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const copilotRef = useRef<HTMLInputElement | null>(null);
  const paletteRef = useRef<HTMLInputElement | null>(null);

  const selectedDoctor = useMemo(
    () => doctors.find((d) => d.id === doctorId) ?? doctors[0] ?? null,
    [doctorId, doctors]
  );
  const doctorName = selectedDoctor?.name ?? "Doctor";

  const refresh = useCallback(async () => {
    if (!doctorId) return;
    const res = await fetch(`/api/queue/status?doctorId=${doctorId}`, { cache: "no-store" });
    const body = await readJson<{
      queue?: QueueItem[];
      summary?: QueueSummary;
      queuePause?: QueuePause | null;
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
    setLastPulse(new Date());
  }, [doctorId]);

  useEffect(() => {
    void refresh();
    const i = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(i);
  }, [refresh]);

  useEffect(() => {
    const i = window.setInterval(() => setClock(new Date()), 30_000);
    return () => window.clearInterval(i);
  }, []);

  const currentServing = useMemo(() => queue.find((q) => q.status === "serving") ?? null, [queue]);
  const nextWaiting = useMemo(() => queue.find((q) => q.status === "waiting") ?? null, [queue]);
  const waitingList = useMemo(() => queue.filter((q) => q.status === "waiting"), [queue]);
  const heldList = useMemo(() => queue.filter((q) => q.status === "stepped_out"), [queue]);
  const doneList = useMemo(() => queue.filter((q) => q.status === "complete"), [queue]);
  const skippedList = useMemo(() => queue.filter((q) => q.status === "skipped"), [queue]);

  async function runAction(
    action:
      | "start_consultation"
      | "mark_consultation_done"
      | "skip"
      | "hold_slot"
      | "return_to_waiting",
    tokenId: string,
    extra?: { holdMinutes?: number; holdNote?: string }
  ) {
    if (!doctorId) return;
    setIsWorking(true);
    const res = await fetch("/api/queue/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, tokenId, doctorId, ...extra })
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

    // 1. Red-flag complaints in waiting / serving queue (not yet first in line)
    queue.forEach((t) => {
      if (t.status !== "waiting") return;
      const c = t.raw_complaint ?? "";
      if (c && RED_FLAG_RE.test(c)) {
        items.push({
          id: `red-${t.id}`,
          severity: "red",
          title: `#${t.token_number} ${t.patients?.name ?? "Patient"} — possible red flag`,
          detail: `Complaint mentions: "${c.slice(0, 80)}". Move ahead of queue?`,
          primary: {
            label: "Start now",
            run: () => runAction("start_consultation", t.id)
          }
        });
      }
    });

    // 2. Current consultation running long (doctor behind)
    if (currentServing) {
      const elapsed = minutesSince(currentServing.serving_started_at ?? currentServing.checked_in_at);
      if (elapsed > AVG_CONSULT_MIN * 2) {
        const nextFive = waitingList.slice(0, 5).map((t) => t.token_number);
        items.push({
          id: `behind-${currentServing.id}`,
          severity: "amber",
          title: `Dr. ${doctorName} is ${elapsed}m into #${currentServing.token_number} (avg ${AVG_CONSULT_MIN}m)`,
          detail:
            nextFive.length > 0
              ? `Notify next ${nextFive.length} patients (#${nextFive.join(", #")}) with updated ETA.`
              : "No one waiting to notify.",
          primary:
            nextFive.length > 0
              ? {
                  label: `Text next ${nextFive.length}`,
                  run: () => {
                    // Prototype: no bulk-SMS API yet. Mark as acknowledged.
                    setDismissed((d) => new Set(d).add(`behind-${currentServing.id}`));
                  }
                }
              : undefined
        });
      }
    }

    // 3. Stepped-out holds expired
    heldList.forEach((t) => {
      const remaining = minutesUntil(t.hold_until);
      if (remaining <= 0) {
        items.push({
          id: `held-${t.id}`,
          severity: "amber",
          title: `#${t.token_number} ${t.patients?.name ?? "Patient"} hold expired`,
          detail: t.hold_note ? `Note: ${t.hold_note}` : "Hold window ended.",
          primary: { label: "Skip", run: () => runAction("skip", t.id) },
          secondary: {
            label: "Return to waiting",
            run: () => runAction("return_to_waiting", t.id)
          }
        });
      }
    });

    // 4. Long-waiters (>60m) — suggest reassurance SMS
    waitingList.forEach((t) => {
      const waited = minutesSince(t.checked_in_at);
      if (waited > 60) {
        items.push({
          id: `wait-${t.id}`,
          severity: "info",
          title: `#${t.token_number} ${t.patients?.name ?? "Patient"} waited ${waited}m`,
          detail: "Longer than 1 hour — send a reassurance update?",
          primary: {
            label: "Acknowledge",
            run: () => setDismissed((d) => new Set(d).add(`wait-${t.id}`))
          }
        });
      }
    });

    // 5. Paused queue
    if (activePause) {
      items.unshift({
        id: `pause-${activePause.id}`,
        severity: "amber",
        title: `Queue paused — ends ${formatClock(new Date(activePause.ends_at))}`,
        detail: activePause.note ?? activePause.reason
      });
    }

    return items.filter((i) => !dismissed.has(i.id));
  }, [queue, currentServing, waitingList, heldList, activePause, dismissed, doctorName]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
        setTimeout(() => paletteRef.current?.focus(), 30);
        return;
      }
      if (e.key === "Escape") {
        if (paletteOpen) {
          setPaletteOpen(false);
          setPaletteQuery("");
        }
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
        void runAction("hold_slot", currentServing.id, {
          holdMinutes: 5,
          holdNote: "Held via keyboard (prototype)"
        });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, nextWaiting, currentServing]);

  function submitCopilot() {
    const q = copilot.trim();
    if (!q) return;
    const phone = q.replace(/[^\d+]/g, "");
    if (phone.length >= 7) {
      window.location.href = `/reception/checkin?phone=${encodeURIComponent(phone)}`;
      return;
    }
    if (/^(new|add|walk)/i.test(q)) {
      window.location.href = "/reception/checkin";
      return;
    }
    setError(`Didn't recognise "${q}". Try a phone number or "new patient".`);
  }

  const paletteItems: Array<{ label: string; hint: string; action: () => void }> = [
    {
      label: "Start next patient",
      hint: "N",
      action: () => {
        if (nextWaiting && !currentServing) void runAction("start_consultation", nextWaiting.id);
        setPaletteOpen(false);
      }
    },
    {
      label: "Mark consultation done",
      hint: "D",
      action: () => {
        if (currentServing) void runAction("mark_consultation_done", currentServing.id);
        setPaletteOpen(false);
      }
    },
    {
      label: "Hold current (5 min)",
      hint: "H",
      action: () => {
        if (currentServing)
          void runAction("hold_slot", currentServing.id, {
            holdMinutes: 5,
            holdNote: "Hold via palette (prototype)"
          });
        setPaletteOpen(false);
      }
    },
    {
      label: "Skip current",
      hint: "S",
      action: () => {
        if (currentServing) void runAction("skip", currentServing.id);
        setPaletteOpen(false);
      }
    },
    {
      label: "Quick add walk-in",
      hint: "go to /reception/checkin",
      action: () => {
        window.location.href = "/reception/checkin";
      }
    },
    {
      label: "Open classic queue board",
      hint: "compare layouts",
      action: () => {
        window.location.href = "/reception/board";
      }
    },
    {
      label: "Open control center",
      hint: "pauses, hold slots, log",
      action: () => {
        window.location.href = "/reception/control";
      }
    }
  ];

  const filteredPalette = paletteQuery.trim()
    ? paletteItems.filter((i) => i.label.toLowerCase().includes(paletteQuery.toLowerCase()))
    : paletteItems;

  if (!doctorId) {
    return (
      <div className="rounded-3xl border border-amber-300/60 bg-amber-50/80 p-6 text-sm">
        No active doctors for this clinic. Add a doctor in admin onboarding first.
      </div>
    );
  }

  return (
    <div className="relative grid gap-5">
      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-border/70 bg-white/80 px-5 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <span className="qcare-kicker">Now · Preview</span>
          <span className="text-sm font-semibold text-foreground">{userLabel}</span>
          <span className="text-sm text-muted-foreground">
            · {doctorName} · {formatClock(clock)} · {summary.complete}/{summary.total} seen
          </span>
          <span
            className={cn(
              "ml-2 h-2 w-2 rounded-full",
              Date.now() - lastPulse.getTime() < 6000 ? "bg-emerald-500" : "bg-amber-500"
            )}
            title="live pulse"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-10 rounded-xl border border-input bg-white px-3 text-sm"
            onChange={(e) => setDoctorId(e.target.value)}
            value={doctorId}
          >
            {doctors.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Button
            onClick={() => {
              setPaletteOpen(true);
              setTimeout(() => paletteRef.current?.focus(), 30);
            }}
            size="sm"
            type="button"
            variant="outline"
          >
            ⌘K
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-300/60 bg-rose-50/85 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {/* Main three-zone grid */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* LEFT: NOW + NEXT */}
        <div className="grid gap-5">
          <ZoneCard label="With doctor" tint="emerald">
            {currentServing ? (
              <PatientHero
                token={currentServing}
                footer={`In consult · ${minutesSince(
                  currentServing.serving_started_at ?? currentServing.checked_in_at
                )}m elapsed`}
                actions={
                  <>
                    <Button
                      disabled={isWorking}
                      onClick={() => void runAction("mark_consultation_done", currentServing.id)}
                      type="button"
                    >
                      Done (D)
                    </Button>
                    <Button
                      disabled={isWorking}
                      onClick={() =>
                        void runAction("hold_slot", currentServing.id, {
                          holdMinutes: 5,
                          holdNote: "Held via Now console (prototype)"
                        })
                      }
                      type="button"
                      variant="outline"
                    >
                      Hold (H)
                    </Button>
                    <Button
                      disabled={isWorking}
                      onClick={() => void runAction("skip", currentServing.id)}
                      type="button"
                      variant="outline"
                    >
                      Skip (S)
                    </Button>
                  </>
                }
              />
            ) : (
              <EmptyHero text="No one with the doctor right now." />
            )}
          </ZoneCard>

          <ZoneCard label="Next up" tint="sky">
            {nextWaiting ? (
              <PatientHero
                token={nextWaiting}
                footer={`Waiting ${minutesSince(nextWaiting.checked_in_at)}m · ${
                  waitingList.length - 1
                } more behind`}
                actions={
                  <Button
                    disabled={isWorking || Boolean(currentServing)}
                    onClick={() => void runAction("start_consultation", nextWaiting.id)}
                    type="button"
                  >
                    Start consultation (N)
                  </Button>
                }
              />
            ) : (
              <EmptyHero text="Queue is empty. Put the kettle on." />
            )}
          </ZoneCard>

          <QueueStrip
            waiting={summary.waiting}
            serving={summary.serving}
            held={summary.steppedOut}
            done={summary.complete}
            skipped={summary.skipped}
            total={summary.total}
          />
        </div>

        {/* RIGHT: NEEDS YOU */}
        <ZoneCard label={`Needs you (${needsYou.length})`} tint="rose">
          {needsYou.length === 0 ? (
            <EmptyHero text="Nothing urgent. Co-pilot is watching." />
          ) : (
            <ul className="grid gap-3">
              {needsYou.map((item) => (
                <li
                  className={cn(
                    "rounded-2xl border p-4",
                    item.severity === "red" && "border-rose-300/70 bg-rose-50/85",
                    item.severity === "amber" && "border-amber-300/70 bg-amber-50/85",
                    item.severity === "info" && "border-sky-300/60 bg-sky-50/75"
                  )}
                  key={item.id}
                >
                  <p className="text-base font-semibold">{item.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{item.detail}</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {item.primary ? (
                      <Button
                        disabled={isWorking}
                        onClick={() => void item.primary?.run()}
                        size="sm"
                        type="button"
                      >
                        {item.primary.label}
                      </Button>
                    ) : null}
                    {item.secondary ? (
                      <Button
                        disabled={isWorking}
                        onClick={() => void item.secondary?.run()}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {item.secondary.label}
                      </Button>
                    ) : null}
                    <Button
                      onClick={() =>
                        setDismissed((d) => {
                          const next = new Set(d);
                          next.add(item.id);
                          return next;
                        })
                      }
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
                      Dismiss
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ZoneCard>
      </div>

      {/* Co-pilot bar */}
      <div className="sticky bottom-3 z-10 rounded-3xl border border-primary/25 bg-white/95 p-3 shadow-[0_20px_40px_-24px_rgba(79,70,229,0.45)] backdrop-blur">
        <div className="flex flex-wrap items-center gap-3">
          <span className="qcare-kicker">Co-pilot</span>
          <input
            className="h-11 flex-1 rounded-xl border border-input bg-white px-3 text-sm"
            onChange={(e) => setCopilot(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitCopilot();
            }}
            placeholder={`Type a phone, or "new patient"…  (press / to focus)`}
            ref={copilotRef}
            value={copilot}
          />
          <Button onClick={submitCopilot} type="button">
            Go
          </Button>
          <span className="hidden text-xs text-muted-foreground md:inline">
            Shortcuts: <kbd>N</kbd> next · <kbd>D</kbd> done · <kbd>H</kbd> hold · <kbd>S</kbd> skip · <kbd>/</kbd>{" "}
            co-pilot · <kbd>⌘K</kbd> palette
          </span>
        </div>
      </div>

      {/* Command palette */}
      {paletteOpen ? (
        <div
          className="fixed inset-0 z-40 flex items-start justify-center bg-black/35 px-4 pt-24"
          onClick={() => {
            setPaletteOpen(false);
            setPaletteQuery("");
          }}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-border bg-white p-3 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              className="h-12 w-full rounded-xl border border-input bg-white px-3 text-base"
              onChange={(e) => setPaletteQuery(e.target.value)}
              placeholder="Type a command…"
              ref={paletteRef}
              value={paletteQuery}
            />
            <ul className="mt-2 max-h-80 overflow-auto">
              {filteredPalette.map((item) => (
                <li key={item.label}>
                  <button
                    className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-secondary"
                    onClick={item.action}
                    type="button"
                  >
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.hint}</span>
                  </button>
                </li>
              ))}
              {filteredPalette.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">No matches.</li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}

      <p className="text-xs text-muted-foreground">
        Prototype · real data · actor <strong>{actorRole}</strong> · clinic {clinicId.slice(0, 8)}… · last pulse{" "}
        {formatClock(lastPulse)}. Compare with{" "}
        <Link className="underline" href="/reception/board">
          classic board
        </Link>
        .
      </p>
    </div>
  );
}

function ZoneCard({
  label,
  tint,
  children
}: {
  label: string;
  tint: "emerald" | "sky" | "rose" | "violet";
  children: React.ReactNode;
}) {
  const ring =
    tint === "emerald"
      ? "before:bg-emerald-400/80"
      : tint === "sky"
        ? "before:bg-sky-400/80"
        : tint === "rose"
          ? "before:bg-rose-400/80"
          : "before:bg-violet-400/80";
  return (
    <section
      className={cn(
        "relative rounded-3xl border border-border/70 bg-white/85 p-5 before:absolute before:left-5 before:top-0 before:h-1 before:w-14 before:-translate-y-1/2 before:rounded-full",
        ring
      )}
    >
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </h2>
      </header>
      {children}
    </section>
  );
}

function PatientHero({
  token,
  footer,
  actions
}: {
  token: QueueItem;
  footer: string;
  actions: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[42px] font-semibold leading-none tracking-tight">
        #{token.token_number}{" "}
        <span className="text-[26px] font-medium text-muted-foreground">
          · {token.patients?.name ?? "Patient"}
        </span>
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        {token.patients?.phone ?? "No phone"} · checked in{" "}
        {new Intl.DateTimeFormat("en-IN", { hour: "2-digit", minute: "2-digit" }).format(
          new Date(token.checked_in_at)
        )}
      </p>
      {token.raw_complaint ? (
        <p className="mt-3 rounded-2xl border border-border/60 bg-secondary/60 p-3 text-sm">
          {token.raw_complaint}
        </p>
      ) : (
        <p className="mt-3 text-xs italic text-muted-foreground">No complaint recorded.</p>
      )}
      <p className="mt-3 text-xs uppercase tracking-wide text-muted-foreground">{footer}</p>
      <div className="mt-4 flex flex-wrap gap-2">{actions}</div>
    </div>
  );
}

function EmptyHero({ text }: { text: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{text}</p>;
}

function QueueStrip({
  waiting,
  serving,
  held,
  done,
  skipped,
  total
}: {
  waiting: number;
  serving: number;
  held: number;
  done: number;
  skipped: number;
  total: number;
}) {
  const pct = (n: number) => (total === 0 ? 0 : Math.round((n / total) * 100));
  return (
    <div className="rounded-3xl border border-border/70 bg-white/85 p-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Queue snapshot
      </p>
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-secondary">
        <span className="bg-sky-400" style={{ width: `${pct(waiting)}%` }} />
        <span className="bg-emerald-500" style={{ width: `${pct(serving)}%` }} />
        <span className="bg-violet-400" style={{ width: `${pct(held)}%` }} />
        <span className="bg-indigo-400" style={{ width: `${pct(done)}%` }} />
        <span className="bg-amber-400" style={{ width: `${pct(skipped)}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
        <Legend color="bg-sky-400" label={`${waiting} waiting`} />
        <Legend color="bg-emerald-500" label={`${serving} in consult`} />
        <Legend color="bg-violet-400" label={`${held} held`} />
        <Legend color="bg-indigo-400" label={`${done} done`} />
        <Legend color="bg-amber-400" label={`${skipped} skipped`} />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-2 text-muted-foreground">
      <span className={cn("h-2.5 w-2.5 rounded-full", color)} />
      {label}
    </span>
  );
}
