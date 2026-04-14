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

  const body = (await request.json()) as { inviteId?: string };

  if (!body.inviteId) {
    return NextResponse.json({ error: "Missing invite id." }, { status: 400 });
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("staff_invites")
    .update({ status: "revoked" })
    .eq("id", body.inviteId)
    .eq("clinic_id", user.clinicId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to revoke invite." },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "Invite cannot be revoked." },
      { status: 409 }
    );
  }

  return NextResponse.json({ ok: true });
}
