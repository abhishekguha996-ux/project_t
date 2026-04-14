import { NextResponse } from "next/server";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const user = await getCurrentClinicUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "clinic_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as { doctorId?: string };

  if (!body.doctorId) {
    return NextResponse.json({ error: "Missing doctor id." }, { status: 400 });
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data: doctor } = await supabase
    .from("doctors")
    .select("id, clerk_user_id")
    .eq("id", body.doctorId)
    .eq("clinic_id", user.clinicId)
    .maybeSingle();

  if (!doctor) {
    return NextResponse.json({ error: "Doctor not found." }, { status: 404 });
  }

  if (doctor.clerk_user_id && doctor.clerk_user_id !== user.clerkUserId) {
    return NextResponse.json(
      { error: "Doctor profile is already linked to another account." },
      { status: 409 }
    );
  }

  await supabase
    .from("doctors")
    .update({ clerk_user_id: user.clerkUserId })
    .eq("id", body.doctorId)
    .eq("clinic_id", user.clinicId);

  return NextResponse.json({ ok: true });
}
