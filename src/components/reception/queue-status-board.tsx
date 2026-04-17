"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";
import type { Doctor, TokenStatus } from "@/lib/utils/types";

type QueueItem = {
  id: string;
  token_number: number;
  status: TokenStatus;
  urgency: string;
  type: string;
  checkin_channel: string;
  checked_in_at: string;
  serving_started_at: string | null;
  raw_complaint: string | null;
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

export function QueueStatusBoard({
  doctors
}: {
  doctors: Doctor[];
}) {
  const [doctorId, setDoctorId] = useState<string>("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [summary, setSummary] = useState<QueueSummary>({
    total: 0,
    waiting: 0,
    serving: 0,
    complete: 0,
    skipped: 0,
    steppedOut: 0
  });

  const activeLabel = useMemo(() => {
    if (doctorId === "all") {
      return "All doctors";
    }

    return doctors.find((doctor) => doctor.id === doctorId)?.name ?? "Doctor";
  }, [doctorId, doctors]);

  const refreshQueue = useCallback(async () => {
    setError(null);
    const query = doctorId !== "all" ? `?doctorId=${doctorId}` : "";
    const response = await fetch(`/api/queue/status${query}`, {
      method: "GET",
      cache: "no-store"
    });
    const payload = (await response.json()) as {
      error?: string;
      queue?: QueueItem[];
      summary?: QueueSummary;
      now?: string;
    };

    if (!response.ok || !payload.queue || !payload.summary) {
      setError(payload.error ?? "Failed to load queue.");
      return;
    }

    setQueue(payload.queue);
    setSummary(payload.summary);
    setLastRefreshedAt(payload.now ?? new Date().toISOString());
  }, [doctorId]);

  useEffect(() => {
    let mounted = true;

    async function run() {
      setIsLoading(true);
      await refreshQueue();
      if (mounted) {
        setIsLoading(false);
      }
    }

    void run();
    const interval = window.setInterval(() => {
      void refreshQueue();
    }, 5000);

    const onDemandRefresh = () => {
      void refreshQueue();
    };
    window.addEventListener("qcare:queue-refresh", onDemandRefresh);

    return () => {
      mounted = false;
      window.clearInterval(interval);
      window.removeEventListener("qcare:queue-refresh", onDemandRefresh);
    };
  }, [doctorId, refreshQueue]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <CardTitle>Live queue monitor</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Showing {activeLabel}. Auto-refresh every 5 seconds.
          </p>
        </div>
        <div className="flex gap-2">
          <select
            className="h-11 min-w-44 rounded-xl border border-input bg-white px-3 text-[13px]"
            onChange={(event) => setDoctorId(event.target.value)}
            value={doctorId}
          >
            <option value="all">All doctors</option>
            {doctors.map((doctor) => (
              <option key={doctor.id} value={doctor.id}>
                {doctor.name}
              </option>
            ))}
          </select>
          <Button onClick={() => void refreshQueue()} type="button" variant="outline">
            Refresh now
          </Button>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {lastRefreshedAt ? (
          <p className="text-xs text-muted-foreground">
            Last refresh: {formatTime(lastRefreshedAt)}
          </p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatPill label="Total" value={summary.total} />
          <StatPill label="Waiting" value={summary.waiting} />
          <StatPill label="Serving" value={summary.serving} />
          <StatPill label="Complete" value={summary.complete} />
          <StatPill label="Skipped" value={summary.skipped} />
          <StatPill label="Stepped Out" value={summary.steppedOut} />
        </div>

        {error ? (
          <Card className="border-rose-300/60 bg-rose-50/85">
            <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : null}

        {!error && !isLoading && queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No tokens in queue yet for this filter.
          </p>
        ) : null}

        {!error && queue.length > 0 ? (
          <div className="overflow-x-auto rounded-2xl border border-border/70 bg-white/75">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Token</th>
                  <th className="px-4 py-3">Patient</th>
                  <th className="px-4 py-3">Doctor</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Checked in</th>
                  <th className="px-4 py-3">Complaint</th>
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
                    <td className="px-4 py-3">{item.doctors?.name ?? "Doctor"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
                          STATUS_STYLES[item.status]
                        )}
                      >
                        {item.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 uppercase">{item.checkin_channel}</td>
                    <td className="px-4 py-3">{formatTime(item.checked_in_at)}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-muted-foreground">
                      {item.raw_complaint ?? "No complaint"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
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
