import { NextResponse } from "next/server";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/utils/types";

function canAccess(role: AppRole) {
  return role === "clinic_admin" || role === "receptionist" || role === "doctor";
}

export async function GET(request: Request) {
  const user = await getCurrentClinicUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canAccess(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const q = (new URL(request.url).searchParams.get("q") ?? "").trim();
  if (q.length < 2) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const supabase = getSupabaseServiceRoleClient();
  const today = new Date().toISOString().slice(0, 10);

  // phone-ish vs name-ish
  const digits = q.replace(/[^\d]/g, "");
  const isPhoney = digits.length >= 3 && digits.length / q.length >= 0.6;

  let patientsQuery = supabase
    .from("patients")
    .select(
      "id, name, phone, age, gender, pregnancy_status, language_preference, created_at, allergies"
    )
    .eq("clinic_id", user.clinicId)
    .limit(8);

  if (isPhoney) {
    patientsQuery = patientsQuery.ilike("phone", `%${digits}%`);
  } else {
    patientsQuery = patientsQuery.ilike("name", `%${q}%`);
  }

  const { data: patients, error } = await patientsQuery;
  if (error) {
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }

  const list = (patients as Array<{
    id: string;
    name: string;
    phone: string;
    age: number | null;
    gender: "male" | "female" | "other" | null;
    pregnancy_status:
      | "unknown"
      | "pregnant"
      | "not_pregnant"
      | "prefer_not_to_say";
    language_preference: string | null;
    created_at: string | null;
    allergies: string[] | null;
  }> | null) ?? [];

  if (list.length === 0) {
    return NextResponse.json({ ok: true, results: [] });
  }

  const patientIds = list.map((p) => p.id);

  // Today's tokens (for current-state actions)
  const [{ data: todayTokens }, { data: recentTokens }, { data: visitCounts }] =
    await Promise.all([
      supabase
        .from("tokens")
        .select(
          "id, patient_id, token_number, status, doctor_id, checked_in_at, doctors(name)"
        )
        .in("patient_id", patientIds)
        .eq("clinic_id", user.clinicId)
        .eq("date", today),
      supabase
        .from("tokens")
        .select(
          "id, patient_id, token_number, status, date, raw_complaint, doctor_id, doctors(name)"
        )
        .in("patient_id", patientIds)
        .eq("clinic_id", user.clinicId)
        .lt("date", today)
        .order("date", { ascending: false })
        .limit(patientIds.length * 3),
      supabase
        .from("tokens")
        .select("patient_id")
        .in("patient_id", patientIds)
        .eq("clinic_id", user.clinicId)
    ]);

  const today_by_pid = new Map<string, (typeof todayTokens extends (infer U)[] | null ? U : never) | null>();
  (((todayTokens ?? []) as unknown) as Array<{
    id: string;
    patient_id: string;
    token_number: number;
    status: string;
    doctor_id: string;
    checked_in_at: string;
    doctors: { name?: string | null } | Array<{ name?: string | null }> | null;
  }>).forEach((t) => {
    today_by_pid.set(t.patient_id, t as never);
  });

  const last_by_pid = new Map<string, {
    id: string;
    token_number: number;
    status: string;
    date: string;
    raw_complaint: string | null;
    doctor_name: string | null;
  }>();
  (((recentTokens ?? []) as unknown) as Array<{
    id: string;
    patient_id: string;
    token_number: number;
    status: string;
    date: string;
    raw_complaint: string | null;
    doctors: { name?: string | null } | Array<{ name?: string | null }> | null;
  }>).forEach((t) => {
    if (last_by_pid.has(t.patient_id)) return;
    const doctor = Array.isArray(t.doctors) ? t.doctors[0] : t.doctors;
    last_by_pid.set(t.patient_id, {
      id: t.id,
      token_number: t.token_number,
      status: t.status,
      date: t.date,
      raw_complaint: t.raw_complaint,
      doctor_name: doctor?.name ?? null
    });
  });

  const count_by_pid = new Map<string, number>();
  ((visitCounts as Array<{ patient_id: string }> | null) ?? []).forEach((v) => {
    count_by_pid.set(v.patient_id, (count_by_pid.get(v.patient_id) ?? 0) + 1);
  });

  const results = list.map((p) => {
    const today = today_by_pid.get(p.id) as
      | {
          id: string;
          token_number: number;
          status: string;
          doctor_id: string;
          checked_in_at: string;
          doctors: { name?: string | null } | Array<{ name?: string | null }> | null;
        }
      | null
      | undefined;
    const todayDoctor = today
      ? Array.isArray(today.doctors)
        ? today.doctors[0]
        : today.doctors
      : null;
    const last = last_by_pid.get(p.id) ?? null;

    return {
      id: p.id,
      name: p.name,
      phone: p.phone,
      age: p.age,
      gender: p.gender,
      pregnancy_status: p.pregnancy_status,
      language_preference: p.language_preference,
      allergies: p.allergies ?? [],
      created_at: p.created_at,
      totalVisits: count_by_pid.get(p.id) ?? 0,
      todayToken: today
        ? {
            id: today.id,
            token_number: today.token_number,
            status: today.status,
            doctor_id: today.doctor_id,
            doctor_name: todayDoctor?.name ?? null,
            checked_in_at: today.checked_in_at
          }
        : null,
      lastToken: last
    };
  });

  return NextResponse.json({ ok: true, results });
}
