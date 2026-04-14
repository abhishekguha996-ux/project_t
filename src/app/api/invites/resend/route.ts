import { NextResponse } from "next/server";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { sendInviteEmail } from "@/lib/email/invite-email";
import { getServerEnv } from "@/lib/env/server";
import { getInviteStatus } from "@/lib/invites";
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
  const [{ data: invite }, { data: clinic }] = await Promise.all([
    supabase
      .from("staff_invites")
      .select("*")
      .eq("id", body.inviteId)
      .eq("clinic_id", user.clinicId)
      .maybeSingle(),
    supabase.from("clinics").select("name").eq("id", user.clinicId).maybeSingle()
  ]);

  if (!invite) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }

  const status = getInviteStatus(invite.status, invite.expires_at);

  if (status !== "pending") {
    return NextResponse.json(
      { error: "Only pending invites can be emailed again." },
      { status: 409 }
    );
  }

  const env = getServerEnv();
  const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/join/${invite.invite_code}`;
  const deliveryResult = await sendInviteEmail({
    clinicName: clinic?.name ?? "QCare Clinic",
    invite: {
      invite_code: invite.invite_code,
      invitee_name: invite.invitee_name,
      invitee_email: invite.invitee_email,
      role: invite.role,
      expires_at: invite.expires_at
    },
    inviteUrl
  });

  const { error } = await supabase
    .from("staff_invites")
    .update({
      delivery_status: deliveryResult.status,
      delivery_error: deliveryResult.error,
      sent_at: deliveryResult.status === "sent" ? new Date().toISOString() : null
    })
    .eq("id", invite.id)
    .eq("clinic_id", user.clinicId);

  if (error) {
    return NextResponse.json(
      { error: "Failed to record resend status." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    deliveryStatus: deliveryResult.status,
    deliveryError: deliveryResult.error,
    inviteUrl
  });
}
