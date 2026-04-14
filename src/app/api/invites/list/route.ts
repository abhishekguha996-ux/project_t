import { NextResponse } from "next/server";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export async function GET() {
  const user = await getCurrentClinicUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "clinic_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("staff_invites")
    .select("*, doctors(id, name)")
    .eq("clinic_id", user.clinicId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Failed to load invites." },
      { status: 500 }
    );
  }

  return NextResponse.json({ invites: data ?? [] });
}
