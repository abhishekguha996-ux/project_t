"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getLastTokenSnapshot,
  type LastTokenSnapshot,
  saveLastTokenSnapshot
} from "@/lib/patient/last-token-storage";

type LookupResponse = {
  tokenId: string;
  tokenNumber: number;
  patientName: string;
  doctorName: string;
  checkedInAt: string;
  trackUrl: string;
};

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "").trim();
}

export function TrackStatusEntry({ clinicId }: { clinicId: string }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<LastTokenSnapshot | null>(null);
  const [phone, setPhone] = useState("");
  const [tokenCode, setTokenCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setSnapshot(getLastTokenSnapshot(clinicId));
  }, [clinicId]);

  function handleLookup(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    startTransition(async () => {
      const response = await fetch("/api/track/lookup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          clinicId,
          phone: normalizePhone(phone),
          tokenCode: tokenCode.trim()
        })
      });
      const payload = (await response.json()) as { error?: string } & Partial<LookupResponse>;

      if (!response.ok || !payload.tokenId || !payload.trackUrl) {
        setError(payload.error ?? "Could not find that token. Please re-check details.");
        return;
      }

      saveLastTokenSnapshot({
        tokenId: payload.tokenId,
        tokenNumber: payload.tokenNumber ?? 0,
        clinicId,
        patientName: payload.patientName ?? "Patient",
        doctorName: payload.doctorName ?? "Doctor",
        phone: normalizePhone(phone),
        checkedInAt: payload.checkedInAt ?? new Date().toISOString()
      });

      router.push(`/track/${payload.tokenId}` as never);
    });
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle>Already checked in? Track status</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        {snapshot ? (
          <div className="rounded-2xl border border-border/70 bg-white/75 p-4 text-sm">
            <p className="font-medium">
              Resume on this device: token #{snapshot.tokenNumber} for{" "}
              {snapshot.patientName}
            </p>
            <p className="mt-1 text-muted-foreground">
              Last doctor: {snapshot.doctorName}
            </p>
            <div className="mt-3">
              <Button onClick={() => router.push(`/track/${snapshot.tokenId}`)} type="button">
                Resume live status
              </Button>
            </div>
          </div>
        ) : null}

        <form className="grid gap-4 rounded-2xl border border-border/70 bg-white/75 p-4" onSubmit={handleLookup}>
          <p className="text-sm text-muted-foreground">
            Find your token with phone number and token code from check-in.
          </p>

          <label className="grid gap-2 text-sm">
              <span className="font-medium">Phone number</span>
              <input
                className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                onChange={(event) => setPhone(event.target.value)}
                placeholder="9876543210"
                required
              value={phone}
            />
          </label>

          <label className="grid gap-2 text-sm">
              <span className="font-medium">Token code</span>
              <input
                className="h-11 rounded-xl border border-input bg-white px-3 text-[13px] uppercase"
                onChange={(event) => setTokenCode(event.target.value)}
                placeholder="12"
                required
              value={tokenCode}
            />
          </label>

          <Button disabled={isPending} type="submit" variant="outline">
            {isPending ? "Checking..." : "Find my status"}
          </Button>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </form>
      </CardContent>
    </Card>
  );
}
