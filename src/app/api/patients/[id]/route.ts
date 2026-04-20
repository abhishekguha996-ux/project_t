import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/utils/types";

const updatePatientSchema = z
  .object({
    age: z.number().int().min(0).max(130).nullable().optional(),
    gender: z.enum(["male", "female", "other"]).nullable().optional(),
    pregnancy_status: z
      .enum(["unknown", "pregnant", "not_pregnant", "prefer_not_to_say"])
      .optional(),
    allergies: z.array(z.string().trim().min(1).max(50)).optional(),
    language_preference: z.string().trim().min(2).max(20).optional()
  })
  .superRefine((value, ctx) => {
    if (Object.keys(value).length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "At least one patient field is required."
      });
    }
  });

function canUpdatePatient(role: AppRole) {
  return role === "clinic_admin" || role === "receptionist";
}

function normalizeAllergies(allergies: string[] | undefined) {
  if (!allergies) {
    return [];
  }

  return Array.from(new Set(allergies.map((item) => item.trim()).filter(Boolean)));
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentClinicUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!canUpdatePatient(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const payload = await request.json().catch(() => null);
  const parsed = updatePatientSchema.safeParse(payload);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid patient update." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if ("age" in parsed.data) {
    patch.age = parsed.data.age ?? null;
  }
  if ("gender" in parsed.data) {
    patch.gender = parsed.data.gender ?? null;
  }
  if ("pregnancy_status" in parsed.data) {
    patch.pregnancy_status = parsed.data.pregnancy_status;
  }
  if ("language_preference" in parsed.data && parsed.data.language_preference) {
    patch.language_preference = parsed.data.language_preference.trim().toLowerCase();
  }
  if ("allergies" in parsed.data) {
    patch.allergies = normalizeAllergies(parsed.data.allergies);
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("patients")
    .update(patch)
    .eq("id", id)
    .eq("clinic_id", user.clinicId)
    .select(
      "id, name, phone, age, gender, pregnancy_status, language_preference, allergies, created_at"
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Failed to update patient profile." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Patient not found." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    patient: {
      id: data.id,
      name: data.name,
      phone: data.phone,
      age: data.age,
      gender: data.gender,
      pregnancy_status: data.pregnancy_status,
      language_preference: data.language_preference,
      allergies: data.allergies ?? [],
      created_at: data.created_at
    }
  });
}
