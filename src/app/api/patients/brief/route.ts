import { NextResponse } from "next/server";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { AppRole, CheckoutStage } from "@/lib/utils/types";

function canAccess(role: AppRole) {
  return role === "clinic_admin" || role === "receptionist" || role === "doctor";
}

export async function GET(request: Request) {
  const user = await getCurrentClinicUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccess(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const patientId = new URL(request.url).searchParams.get("id")?.trim();
  if (!patientId) {
    return NextResponse.json({ error: "patient id required" }, { status: 400 });
  }

  const supabase = getSupabaseServiceRoleClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: patient } = await supabase
    .from("patients")
    .select("id, name, phone, age, gender, language_preference, allergies, created_at")
    .eq("id", patientId)
    .eq("clinic_id", user.clinicId)
    .maybeSingle();

  if (!patient) {
    return NextResponse.json({ error: "patient not found" }, { status: 404 });
  }

  const p = patient as {
    id: string;
    name: string;
    phone: string;
    age: number | null;
    gender: "male" | "female" | "other" | null;
    language_preference: string | null;
    allergies: string[] | null;
    created_at: string | null;
  };

  // Same-phone patients in clinic (household / family link)
  const { data: householdRows } = await supabase
    .from("patients")
    .select("id, name")
    .eq("clinic_id", user.clinicId)
    .eq("phone", p.phone)
    .neq("id", p.id);

  const householdIds = ((householdRows as Array<{ id: string; name: string }> | null) ?? []).map(
    (r) => r.id
  );
  const familyAllTime = householdIds.length;

  // Of those, who has a token today?
  let familyToday: Array<{ id: string; name: string; token_number: number; status: string }> = [];
  if (householdIds.length > 0) {
    const { data: familyTokens } = await supabase
      .from("tokens")
      .select("id, token_number, status, patient_id, patients(name)")
      .in("patient_id", householdIds)
      .eq("clinic_id", user.clinicId)
      .eq("date", today);

    const raw = ((familyTokens as unknown) as
      | Array<{
          id: string;
          token_number: number;
          status: string;
          patient_id: string;
          patients: { name?: string | null } | Array<{ name?: string | null }> | null;
        }>
      | null) ?? [];
    familyToday = raw.map((t) => {
      const pp = Array.isArray(t.patients) ? t.patients[0] : t.patients;
      return {
        id: t.id,
        name: pp?.name ?? "Family",
        token_number: t.token_number,
        status: t.status
      };
    });
  }

  // All-time visits (tokens) for this patient
  const { data: allTokens } = await supabase
    .from("tokens")
    .select("id, date, status, raw_complaint, doctor_id, doctors(name)")
    .eq("clinic_id", user.clinicId)
    .eq("patient_id", p.id)
    .order("date", { ascending: false });

  const tokens = ((allTokens as unknown) as
    | Array<{
        id: string;
        date: string;
        status: string;
        raw_complaint: string | null;
        doctor_id: string;
        doctors: { name?: string | null } | Array<{ name?: string | null }> | null;
      }>
    | null) ?? [];

  const totalVisits = tokens.length;
  const priorTokens = tokens.filter((t) => t.date < today);
  const lastTokenRow = priorTokens[0] ?? null;
  const lastTokenDoctor = lastTokenRow
    ? Array.isArray(lastTokenRow.doctors)
      ? lastTokenRow.doctors[0]
      : lastTokenRow.doctors
    : null;

  // Up to 3 recent prior visits for the Next-up briefing.
  const recentVisits = priorTokens.slice(0, 3).map((t) => {
    const d = Array.isArray(t.doctors) ? t.doctors[0] : t.doctors;
    return {
      id: t.id,
      date: t.date,
      doctor_name: d?.name ?? null,
      raw_complaint: t.raw_complaint
    };
  });

  // Prior visits' checkout — find last payment state + count unpaid
  let unpaidPriorVisits = 0;
  let lastCheckoutStage: CheckoutStage | null = null;
  let lastCheckoutPaymentStatus: string | null = null;
  if (priorTokens.length > 0) {
    const priorIds = priorTokens.map((t) => t.id);
    const { data: checkouts } = await supabase
      .from("token_checkout")
      .select("token_id, checkout_stage, payment_status, updated_at")
      .in("token_id", priorIds)
      .order("updated_at", { ascending: false });
    const rows = ((checkouts as Array<{
      token_id: string;
      checkout_stage: string;
      payment_status: string;
      updated_at: string | null;
    }> | null) ?? []);
    unpaidPriorVisits = rows.filter(
      (r) => r.payment_status !== "done" && r.payment_status !== "not_required"
    ).length;
    if (rows[0]) {
      lastCheckoutStage = rows[0].checkout_stage as CheckoutStage;
      lastCheckoutPaymentStatus = rows[0].payment_status;
    }
  }

  const lastToken = lastTokenRow
    ? {
        id: lastTokenRow.id,
        date: lastTokenRow.date,
        doctor_name: lastTokenDoctor?.name ?? null,
        raw_complaint: lastTokenRow.raw_complaint,
        checkout_stage: lastCheckoutStage,
        payment_status: lastCheckoutPaymentStatus
      }
    : null;

  // Hydrate insurance from the patient row.
  const { data: patientFull } = await supabase
    .from("patients")
    .select("insurance_provider, insurance_policy_number")
    .eq("id", p.id)
    .maybeSingle();

  const insurance = (patientFull as {
    insurance_provider: string | null;
    insurance_policy_number: string | null;
  } | null) ?? null;

  return NextResponse.json({
    ok: true,
    patient: {
      id: p.id,
      name: p.name,
      phone: p.phone,
      age: p.age,
      gender: p.gender,
      language_preference: p.language_preference,
      allergies: p.allergies ?? [],
      created_at: p.created_at,
      insurance_provider: insurance?.insurance_provider ?? null,
      insurance_policy_number: insurance?.insurance_policy_number ?? null
    },
    totalVisits,
    familyAllTime,
    familyToday,
    lastToken,
    recentVisits,
    unpaidPriorVisits
  });
}
