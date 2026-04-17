import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { AppRole, Patient } from "@/lib/utils/types";

const lookupSchema = z.object({
  phone: z.string().trim().min(7).max(20),
  clinicId: z.string().uuid().optional()
});

function isReceptionRole(role: AppRole) {
  return role === "clinic_admin" || role === "receptionist";
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = lookupSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid lookup payload." },
      { status: 400 }
    );
  }

  const user = await getCurrentClinicUser();
  const clinicId = user && isReceptionRole(user.role) ? user.clinicId : parsed.data.clinicId;

  if (!clinicId) {
    return NextResponse.json(
      { error: "Clinic context is required." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("patients")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("phone", parsed.data.phone)
    .order("name", { ascending: true });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load household members." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    clinicId,
    phone: parsed.data.phone,
    household: (data as Patient[] | null) ?? []
  });
}
