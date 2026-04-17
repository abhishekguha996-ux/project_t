import { NextResponse } from "next/server";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { sendInviteEmail } from "@/lib/email/invite-email";
import { getServerEnv } from "@/lib/env/server";
import { generateInviteCode } from "@/lib/invites";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const user = await getCurrentClinicUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "clinic_admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    role?: "doctor" | "receptionist";
    inviteeName?: string;
    inviteeEmail?: string;
    doctorId?: string;
  };

  if (!body.role || !["doctor", "receptionist"].includes(body.role)) {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }

  const inviteeEmail = body.inviteeEmail?.trim().toLowerCase();

  if (!inviteeEmail) {
    return NextResponse.json(
      { error: "Invitee email is required." },
      { status: 400 }
    );
  }

  if (body.role === "doctor" && !body.doctorId) {
    return NextResponse.json(
      { error: "Doctor invites require a doctor profile." },
      { status: 400 }
    );
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data: clinic } = await supabase
    .from("clinics")
    .select("name")
    .eq("id", user.clinicId)
    .maybeSingle();

  if (body.role === "doctor") {
    const { data: doctor } = await supabase
      .from("doctors")
      .select("id, clerk_user_id")
      .eq("id", body.doctorId)
      .eq("clinic_id", user.clinicId)
      .maybeSingle();

    if (!doctor) {
      return NextResponse.json(
        { error: "Doctor profile not found for this clinic." },
        { status: 404 }
      );
    }

    if (doctor.clerk_user_id) {
      if (doctor.clerk_user_id === user.clerkUserId) {
        return NextResponse.json(
          {
            error:
              "That doctor profile is already linked to your account. Open /doctor directly instead of creating a new invite for it."
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        {
          error:
            "That doctor profile is already linked to another Clerk account."
        },
        { status: 409 }
      );
    }
  }

  let inviteCode = "";

  for (let attempt = 0; attempt < 5; attempt += 1) {
    inviteCode = generateInviteCode();
    const { data: existing } = await supabase
      .from("staff_invites")
      .select("id")
      .eq("invite_code", inviteCode)
      .maybeSingle();

    if (!existing) {
      break;
    }
  }

  if (!inviteCode) {
    return NextResponse.json(
      { error: "Unable to generate invite code." },
      { status: 500 }
    );
  }

  const { data, error } = await supabase
    .from("staff_invites")
    .insert({
      clinic_id: user.clinicId,
      invite_code: inviteCode,
      role: body.role,
      invitee_name: body.inviteeName?.trim() || null,
      invitee_email: inviteeEmail,
      invited_by_clerk_id: user.clerkUserId,
      doctor_id: body.role === "doctor" ? body.doctorId : null,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    })
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Failed to create invite." },
      { status: 500 }
    );
  }

  const env = getServerEnv();
  const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/join/${data.invite_code}`;
  const deliveryResult = await sendInviteEmail({
    clinicName: clinic?.name ?? "QCare Clinic",
    invite: {
      invite_code: data.invite_code,
      invitee_name: data.invitee_name,
      invitee_email: data.invitee_email,
      role: data.role,
      expires_at: data.expires_at
    },
    inviteUrl
  });

  const deliveryUpdate = {
    delivery_status: deliveryResult.status,
    delivery_error: deliveryResult.error,
    sent_at: deliveryResult.status === "sent" ? new Date().toISOString() : null
  };

  await supabase.from("staff_invites").update(deliveryUpdate).eq("id", data.id);

  return NextResponse.json({
    inviteCode: data.invite_code,
    inviteUrl,
    deliveryStatus: deliveryResult.status,
    deliveryError: deliveryResult.error
  });
}
