import { NextResponse } from "next/server";

import { getInviteFailureMessage, getInviteStatus } from "@/lib/invites";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const body = (await request.json()) as { code?: string };
  const inviteCode = body.code?.trim().toUpperCase();

  if (!inviteCode) {
    return NextResponse.json(
      { valid: false, reason: "invalid", message: getInviteFailureMessage("invalid") },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data } = await supabase
    .from("staff_invites")
    .select("invite_code, role, invitee_name, status, expires_at, clinics(name)")
    .eq("invite_code", inviteCode)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({
      valid: false,
      reason: "invalid",
      message: getInviteFailureMessage("invalid")
    });
  }

  const status = getInviteStatus(
    data.status as "pending" | "accepted" | "expired" | "revoked",
    data.expires_at
  );

  if (status !== "pending") {
    return NextResponse.json({
      valid: false,
      reason: status,
      message: getInviteFailureMessage(status)
    });
  }

  return NextResponse.json({
    valid: true,
    clinicName: (data.clinics as { name?: string } | null)?.name ?? "Clinic",
    role: data.role,
    inviteeName: data.invitee_name
  });
}
