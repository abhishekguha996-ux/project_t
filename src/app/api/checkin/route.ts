import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { notifyPatientStatusUpdate } from "@/lib/notifications/patient-updates";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { AppRole, Patient, Token } from "@/lib/utils/types";

const checkinSchema = z.object({
  clinicId: z.string().uuid().optional(),
  doctorId: z.string().uuid(),
  patientName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(20),
  complaint: z.string().trim().min(2).max(500),
  checkinChannel: z.enum(["qr", "reception"]),
  age: z.number().int().min(0).max(130).optional(),
  gender: z.enum(["male", "female", "other"]).optional(),
  allergies: z.array(z.string().trim().min(1).max(50)).optional(),
  languagePreference: z.string().trim().min(2).max(20).optional()
});

function isReceptionRole(role: AppRole) {
  return role === "clinic_admin" || role === "receptionist";
}

function normalizeAllergies(allergies: string[] | undefined) {
  if (!allergies) {
    return undefined;
  }

  const unique = Array.from(
    new Set(allergies.map((item) => item.trim()).filter(Boolean))
  );
  return unique.length > 0 ? unique : undefined;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = checkinSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid check-in payload." }, { status: 400 });
  }

  const payload = parsed.data;
  const user = await getCurrentClinicUser();
  const clinicId = user && isReceptionRole(user.role) ? user.clinicId : payload.clinicId;

  if (!clinicId) {
    return NextResponse.json(
      { error: "Clinic context is required." },
      { status: 400 }
    );
  }

  if (payload.checkinChannel === "reception" && (!user || !isReceptionRole(user.role))) {
    return NextResponse.json(
      { error: "Reception check-in requires clinic staff access." },
      { status: 401 }
    );
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data: doctor, error: doctorError } = await supabase
    .from("doctors")
    .select("id, clinic_id, status, name")
    .eq("id", payload.doctorId)
    .eq("clinic_id", clinicId)
    .maybeSingle();

  if (doctorError) {
    return NextResponse.json(
      { error: "Failed to validate doctor profile." },
      { status: 500 }
    );
  }

  if (!doctor) {
    return NextResponse.json(
      { error: "Doctor profile not found for this clinic." },
      { status: 404 }
    );
  }

  if (doctor.status === "offline") {
    return NextResponse.json(
      { error: "This doctor is currently offline for check-ins." },
      { status: 409 }
    );
  }

  const patientName = payload.patientName.trim();
  const normalizedPhone = payload.phone.trim();
  let patient: Patient | null = null;
  const { data: existingPatient, error: patientFetchError } = await supabase
    .from("patients")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("phone", normalizedPhone)
    .eq("name", patientName)
    .maybeSingle();

  if (patientFetchError) {
    return NextResponse.json(
      { error: "Failed to load patient profile." },
      { status: 500 }
    );
  }

  if (!existingPatient) {
    const { data: insertedPatient, error: patientInsertError } = await supabase
      .from("patients")
      .insert({
        clinic_id: clinicId,
        phone: normalizedPhone,
        name: patientName,
        age: payload.age ?? null,
        gender: payload.gender ?? null,
        allergies: normalizeAllergies(payload.allergies) ?? null,
        language_preference: payload.languagePreference?.trim() || "en"
      })
      .select("*")
      .single();

    if (patientInsertError || !insertedPatient) {
      return NextResponse.json(
        { error: "Failed to create patient profile." },
        { status: 500 }
      );
    }

    patient = insertedPatient as Patient;
  } else {
    patient = existingPatient as Patient;
    const patch: Record<string, unknown> = {};

    if (payload.age !== undefined && payload.age !== patient.age) {
      patch.age = payload.age;
    }

    if (payload.gender !== undefined && payload.gender !== patient.gender) {
      patch.gender = payload.gender;
    }

    if (payload.languagePreference) {
      const languagePreference = payload.languagePreference.trim();
      if (languagePreference && languagePreference !== patient.language_preference) {
        patch.language_preference = languagePreference;
      }
    }

    const normalizedAllergies = normalizeAllergies(payload.allergies);
    if (
      normalizedAllergies &&
      JSON.stringify(normalizedAllergies) !== JSON.stringify(patient.allergies ?? [])
    ) {
      patch.allergies = normalizedAllergies;
    }

    if (Object.keys(patch).length > 0) {
      const { data: updatedPatient, error: updateError } = await supabase
        .from("patients")
        .update(patch)
        .eq("id", patient.id)
        .eq("clinic_id", clinicId)
        .select("*")
        .single();

      if (updateError || !updatedPatient) {
        return NextResponse.json(
          { error: "Failed to update patient profile." },
          { status: 500 }
        );
      }

      patient = updatedPatient as Patient;
    }
  }

  const { data: token, error: tokenError } = await supabase.rpc(
    "assign_next_token",
    {
      p_clinic_id: clinicId,
      p_doctor_id: payload.doctorId,
      p_patient_id: patient.id,
      p_raw_complaint: payload.complaint.trim(),
      p_ai_summary: null,
      p_checkin_channel: payload.checkinChannel
    }
  );

  if (tokenError || !token) {
    return NextResponse.json(
      { error: "Failed to assign queue token." },
      { status: 500 }
    );
  }

  const { data: household, error: householdError } = await supabase
    .from("patients")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("phone", normalizedPhone)
    .order("name", { ascending: true });

  if (householdError) {
    return NextResponse.json(
      { error: "Check-in succeeded, but household lookup failed." },
      { status: 500 }
    );
  }

  const assignedToken = token as Token;
  try {
    await notifyPatientStatusUpdate({
      tokenId: assignedToken.id,
      event: "checkin_confirm",
      supabase
    });
  } catch (error) {
    console.error(
      "[QCare] check-in notification failed:",
      error instanceof Error ? error.message : error
    );
  }

  return NextResponse.json({
    ok: true,
    clinicId,
    patient,
    household: (household as Patient[] | null) ?? [],
    token: assignedToken,
    doctor: {
      id: doctor.id,
      name: doctor.name
    },
    aiSummaryStatus: "pending_manual_fallback"
  });
}
