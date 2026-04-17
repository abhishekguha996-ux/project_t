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

  const body = (await request.json().catch(() => ({}))) as { doctorId?: string };
  const supabase = getSupabaseServiceRoleClient();

  let query = supabase
    .from("doctors")
    .update({ clerk_user_id: null })
    .eq("clinic_id", user.clinicId)
    .eq("clerk_user_id", user.clerkUserId);

  if (body.doctorId) {
    query = query.eq("id", body.doctorId);
  }

  const { data, error } = await query.select("id");

  if (error) {
    return NextResponse.json(
      { error: "Failed to unlink doctor profile." },
      { status: 500 }
    );
  }

  if (!data || data.length === 0) {
    return NextResponse.json(
      { error: "No linked doctor profile found for this account." },
      { status: 409 }
    );
  }

  return NextResponse.json({
    ok: true,
    doctorIds: data.map((doctor) => doctor.id)
  });
}
