"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Doctor } from "@/lib/utils/types";

export function DoctorAccessSetup({
  doctors,
  linkedDoctorId
}: {
  doctors: Doctor[];
  linkedDoctorId: string | null;
}) {
  const router = useRouter();
  const [selectedDoctorId, setSelectedDoctorId] = useState(linkedDoctorId ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const linkableDoctors = useMemo(
    () =>
      doctors.filter(
        (doctor) =>
          !doctor.clerk_user_id ||
          (linkedDoctorId !== null && doctor.id === linkedDoctorId)
      ),
    [doctors, linkedDoctorId]
  );

  function handleLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    startTransition(async () => {
      const response = await fetch("/api/account/link-doctor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ doctorId: selectedDoctorId })
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setMessage(payload.error ?? "Failed to link doctor profile.");
        return;
      }

      setMessage("Doctor access is ready. Reloading workspace...");
      router.refresh();
    });
  }

  function handleUnlink() {
    setMessage(null);

    startTransition(async () => {
      const response = await fetch("/api/account/unlink-doctor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ doctorId: linkedDoctorId ?? undefined })
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setMessage(payload.error ?? "Failed to unlink doctor profile.");
        return;
      }

      setSelectedDoctorId("");
      setMessage("Doctor profile unlinked. Select one to link again.");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Doctor access setup</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          This account can access doctor workflow once linked to one doctor profile.
        </p>

        <form className="grid gap-4" onSubmit={handleLink}>
          <label className="grid gap-2 text-sm">
            <span className="font-medium">Select doctor profile</span>
            <select
              className="h-11 rounded-2xl border border-input bg-white px-4"
              onChange={(event) => setSelectedDoctorId(event.target.value)}
              value={selectedDoctorId}
            >
              <option value="">Select doctor profile</option>
              {linkableDoctors.map((doctor) => (
                <option key={doctor.id} value={doctor.id}>
                  {doctor.name}
                </option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap gap-2">
            <Button disabled={isPending || !selectedDoctorId} type="submit">
              {isPending ? "Working..." : "Link doctor profile"}
            </Button>
            {linkedDoctorId ? (
              <Button
                disabled={isPending}
                onClick={handleUnlink}
                type="button"
                variant="outline"
              >
                Unlink current profile
              </Button>
            ) : null}
            <Button asChild type="button" variant="ghost">
              <Link href="/admin">Open admin onboarding</Link>
            </Button>
          </div>
        </form>

        {message ? (
          <p className="rounded-2xl border border-border/70 bg-white/75 p-3 text-sm">
            {message}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
