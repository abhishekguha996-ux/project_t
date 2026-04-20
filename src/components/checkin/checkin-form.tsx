"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { saveLastTokenSnapshot } from "@/lib/patient/last-token-storage";
import type { PatientPregnancyStatus } from "@/lib/utils/types";

type CheckinDoctor = {
  id: string;
  name: string;
  specialty: string | null;
  status: string;
};

type CheckinFormMode = "reception" | "qr";

type CheckinPayload = {
  clinicId?: string;
  doctorId: string;
  patientName: string;
  phone: string;
  complaint: string;
  checkinChannel: CheckinFormMode;
  age?: number;
  gender?: "male" | "female" | "other";
  pregnancyStatus?: PatientPregnancyStatus;
  allergies?: string[];
  languagePreference?: string;
};

type CheckinResult = {
  token: {
    id: string;
    token_number: number;
    date: string;
    status: string;
  };
  patient: {
    id: string;
    name: string;
    phone: string;
  };
  doctor: {
    id: string;
    name: string;
  };
  household: Array<{
    id: string;
    name: string;
  }>;
};

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "").trim();
}

export function CheckinForm({
  mode,
  clinicId,
  doctors,
  title,
  description
}: {
  mode: CheckinFormMode;
  clinicId?: string;
  doctors: CheckinDoctor[];
  title: string;
  description: string;
}) {
  const [doctorId, setDoctorId] = useState(doctors[0]?.id ?? "");
  const [phone, setPhone] = useState("");
  const [patientName, setPatientName] = useState("");
  const [complaint, setComplaint] = useState("");
  const [age, setAge] = useState("");
  const [gender, setGender] = useState<"" | "male" | "female" | "other">("");
  const [pregnancyStatus, setPregnancyStatus] =
    useState<PatientPregnancyStatus>("unknown");
  const [allergies, setAllergies] = useState("");
  const [languagePreference, setLanguagePreference] = useState("en");
  const [household, setHousehold] = useState<Array<{ id: string; name: string }>>(
    []
  );
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasDoctors = doctors.length > 0;
  const selectedDoctor = useMemo(
    () => doctors.find((doctor) => doctor.id === doctorId) ?? null,
    [doctors, doctorId]
  );

  function runHouseholdLookup(phoneValue: string) {
    const normalized = normalizePhone(phoneValue);
    if (normalized.length < 7) {
      setHousehold([]);
      return;
    }

    startTransition(async () => {
      const response = await fetch("/api/checkin/lookup", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          phone: normalized,
          clinicId
        })
      });

      const payload = (await response.json()) as {
        household?: Array<{ id: string; name: string }>;
      };

      if (response.ok && payload.household) {
        setHousehold(payload.household);
      } else {
        setHousehold([]);
      }
    });
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);

    if (!doctorId) {
      setError("Please choose a doctor.");
      return;
    }

    const payload: CheckinPayload = {
      doctorId,
      patientName: patientName.trim(),
      phone: normalizePhone(phone),
      complaint: complaint.trim(),
      checkinChannel: mode
    };

    if (mode === "qr" && clinicId) {
      payload.clinicId = clinicId;
    }

    if (age.trim()) {
      payload.age = Number(age);
    }

    if (gender) {
      payload.gender = gender;
    }

    if (mode === "reception") {
      payload.pregnancyStatus = pregnancyStatus;
    }

    if (languagePreference.trim()) {
      payload.languagePreference = languagePreference.trim().toLowerCase();
    }

    const allergyItems = allergies
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (allergyItems.length > 0) {
      payload.allergies = allergyItems;
    }

    startTransition(async () => {
      const response = await fetch("/api/checkin", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const body = (await response.json()) as {
        error?: string;
        clinicId?: string;
        token?: CheckinResult["token"];
        patient?: CheckinResult["patient"];
        household?: CheckinResult["household"];
        doctor?: CheckinResult["doctor"];
      };

      if (!response.ok || !body.token || !body.patient || !body.doctor) {
        setError(body.error ?? "Could not complete check-in.");
        return;
      }

      setResult({
        token: body.token,
        patient: body.patient,
        household: body.household ?? [],
        doctor: body.doctor
      });

      const resolvedClinicId = body.clinicId ?? clinicId;
      if (resolvedClinicId && mode === "qr") {
        saveLastTokenSnapshot({
          tokenId: body.token.id,
          tokenNumber: body.token.token_number,
          clinicId: resolvedClinicId,
          patientName: body.patient.name,
          doctorName: body.doctor.name,
          phone: payload.phone,
          checkedInAt: new Date().toISOString()
        });
      }
      window.dispatchEvent(new CustomEvent("qcare:queue-refresh"));

      setComplaint("");
      runHouseholdLookup(payload.phone);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {!hasDoctors ? (
          <p className="text-sm text-muted-foreground">
            No doctor profiles are available for check-in yet.
          </p>
        ) : (
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-2 text-sm">
              <span className="font-medium">Doctor</span>
              <select
                className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                value={doctorId}
                onChange={(event) => setDoctorId(event.target.value)}
                required
              >
                {doctors.map((doctor) => (
                  <option key={doctor.id} value={doctor.id}>
                    {doctor.name}
                    {doctor.specialty ? ` (${doctor.specialty})` : ""}
                  </option>
                ))}
              </select>
              {selectedDoctor?.status !== "active" ? (
                <span className="text-xs text-amber-600">
                  Selected doctor is currently {selectedDoctor?.status}. Check-ins may
                  be restricted by queue policy.
                </span>
              ) : null}
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Patient phone</span>
              <input
                className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                onBlur={() => runHouseholdLookup(phone)}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="9876543210"
                required
                value={phone}
              />
            </label>

            {household.length > 0 ? (
              <div className="rounded-2xl border border-border/70 bg-white/75 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Existing household members
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {household.map((member) => (
                    <button
                      className="rounded-xl border border-border bg-white px-2.5 py-1 text-[13px] hover:bg-secondary"
                      key={member.id}
                      onClick={() => setPatientName(member.name)}
                      type="button"
                    >
                      {member.name}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Patient name</span>
              <input
                className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                onChange={(event) => setPatientName(event.target.value)}
                placeholder="Ravi Kumar"
                required
                value={patientName}
              />
            </label>

            <div className="grid gap-4 md:grid-cols-2">
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Age (optional)</span>
                <input
                  className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                  inputMode="numeric"
                  onChange={(event) => setAge(event.target.value)}
                  placeholder="35"
                  value={age}
                />
              </label>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Gender (optional)</span>
                <select
                  className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                  onChange={(event) =>
                    setGender(event.target.value as "" | "male" | "female" | "other")
                  }
                  value={gender}
                >
                  <option value="">Select</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </label>
            </div>

            {mode === "reception" ? (
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Pregnancy status</span>
                <select
                  className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                  onChange={(event) =>
                    setPregnancyStatus(event.target.value as PatientPregnancyStatus)
                  }
                  value={pregnancyStatus}
                >
                  <option value="unknown">Unknown</option>
                  <option value="pregnant">Pregnant</option>
                  <option value="not_pregnant">Not pregnant</option>
                  <option value="prefer_not_to_say">Prefer not to say</option>
                </select>
              </label>
            ) : null}

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Allergies (optional)</span>
              <input
                className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                onChange={(event) => setAllergies(event.target.value)}
                placeholder="Penicillin, dust"
                value={allergies}
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Language preference</span>
              <input
                className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                onChange={(event) => setLanguagePreference(event.target.value)}
                placeholder="en"
                value={languagePreference}
              />
            </label>

            <label className="grid gap-2 text-sm">
              <span className="font-medium">Complaint</span>
              <textarea
                className="min-h-24 rounded-2xl border border-input bg-white px-3 py-2 text-[13px]"
                onChange={(event) => setComplaint(event.target.value)}
                placeholder="Fever and body ache since last night"
                required
                value={complaint}
              />
            </label>

            <Button disabled={isPending} type="submit">
              {isPending ? "Submitting..." : "Check in patient"}
            </Button>
          </form>
        )}

        {error ? (
          <Card className="border-rose-300/60 bg-rose-50/85">
            <CardContent className="pt-6 text-sm text-destructive">{error}</CardContent>
          </Card>
        ) : null}

        {result ? (
          <Card className="border-emerald-300/60 bg-emerald-50/90">
            <CardContent className="pt-6 text-sm text-foreground">
              <p className="font-semibold">
                Token #{result.token.token_number} assigned for {result.patient.name}
              </p>
              <p className="mt-1 text-muted-foreground">
                Doctor: {result.doctor.name} · Status: {result.token.status}
              </p>
              <p className="mt-1 text-muted-foreground">
                Date: {result.token.date}
              </p>
              <p className="mt-2">
                <Link
                  className="text-primary underline-offset-4 hover:underline"
                  href={`/track/${result.token.id}`}
                >
                  Open patient tracking page
                </Link>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                This token is also saved on this device under &quot;Already checked in?
                Track status&quot;.
              </p>
            </CardContent>
          </Card>
        ) : null}
      </CardContent>
    </Card>
  );
}
