import { auth, currentUser } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

import { isAppRole } from "@/lib/auth/roles";
import { syncUserRoleMetadata } from "@/lib/auth/current-user";
import { getInviteDestination } from "@/lib/invites";
import type { AppRole } from "@/lib/utils/types";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

type ClerkMetadata = {
  clinic_id?: string;
  role?: string;
};

export async function POST(request: Request) {
  const session = await auth();

  if (!session.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { code?: string };
  const inviteCode = body.code?.trim().toUpperCase();
  const user = await currentUser();

  if (!user?.primaryEmailAddress?.emailAddress) {
    return NextResponse.json(
      { error: "Your account needs a primary email address before it can accept an invite." },
      { status: 400 }
    );
  }

  const signedInEmail = user.primaryEmailAddress.emailAddress.toLowerCase();
  const publicMetadata = user.publicMetadata as ClerkMetadata;
  const privateMetadata = user.privateMetadata as ClerkMetadata;
  const currentRoleValue = publicMetadata.role ?? privateMetadata.role;
  const currentRole: AppRole | null =
    currentRoleValue && isAppRole(currentRoleValue) ? currentRoleValue : null;
  const currentClinicId =
    publicMetadata.clinic_id ?? privateMetadata.clinic_id ?? null;

  if (!inviteCode) {
    return NextResponse.json({ error: "Missing invite code." }, { status: 400 });
  }

  const supabase = getSupabaseServiceRoleClient();

  const { data: existing } = await supabase
    .from("staff_invites")
    .select("*")
    .eq("invite_code", inviteCode)
    .maybeSingle();

  if (!existing) {
    return NextResponse.json({ error: "Invite not found." }, { status: 404 });
  }

  if (
    !existing.invitee_email ||
    existing.invitee_email.toLowerCase() !== signedInEmail
  ) {
    return NextResponse.json(
      {
        error:
          "This invite is tied to a different email address. Please sign in with the email that received the invite."
      },
      { status: 409 }
    );
  }

  if (
    currentRole === "clinic_admin" &&
    currentClinicId &&
    currentClinicId !== existing.clinic_id
  ) {
    return NextResponse.json(
      {
        error:
          "This account is already a clinic admin for a different clinic and cannot accept this invite."
      },
      { status: 409 }
    );
  }

  const expiresAt = new Date(existing.expires_at);

  if (
    existing.status === "accepted" &&
    existing.accepted_by_clerk_id !== session.userId
  ) {
    return NextResponse.json(
      { error: "This invite has already been used." },
      { status: 409 }
    );
  }

  if (existing.status === "revoked") {
    return NextResponse.json(
      { error: "This invite was revoked." },
      { status: 409 }
    );
  }

  if (expiresAt.getTime() <= Date.now()) {
    if (existing.status === "pending") {
      await supabase
        .from("staff_invites")
        .update({ status: "expired" })
        .eq("id", existing.id);
    }

    return NextResponse.json(
      { error: "This invite has expired." },
      { status: 409 }
    );
  }

  let invite = existing;

  if (existing.status === "pending") {
    const { data: consumed, error } = await supabase
      .from("staff_invites")
      .update({
        status: "accepted",
        accepted_by_clerk_id: session.userId,
        accepted_at: new Date().toISOString()
      })
      .eq("id", existing.id)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: "Failed to accept invite." },
        { status: 500 }
      );
    }

    if (!consumed) {
      return NextResponse.json(
        { error: "This invite is no longer available." },
        { status: 409 }
      );
    }

    invite = consumed;
  }

  if (invite.role === "doctor" && invite.doctor_id) {
    const { data: linkedDoctor, error: doctorLinkError } = await supabase
      .from("doctors")
      .update({ clerk_user_id: session.userId })
      .eq("id", invite.doctor_id)
      .eq("clinic_id", invite.clinic_id)
      .or(`clerk_user_id.is.null,clerk_user_id.eq.${session.userId}`)
      .select("id")
      .maybeSingle();

    if (doctorLinkError) {
      return NextResponse.json(
        { error: "Could not link your doctor profile. Please try again." },
        { status: 500 }
      );
    }

    if (!linkedDoctor) {
      return NextResponse.json(
        {
          error:
            "Doctor profile linking failed. Please ask the clinic admin to link your account in admin onboarding."
        },
        { status: 409 }
      );
    }
  }

  const roleToPersist: AppRole =
    currentRole === "clinic_admin" ? "clinic_admin" : invite.role;

  try {
    await syncUserRoleMetadata({
      userId: session.userId,
      clinicId: invite.clinic_id,
      role: roleToPersist
    });
  } catch {
    return NextResponse.json(
      {
        error:
          "Invite was accepted, but account metadata sync is still pending. Please refresh and try again."
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    role: roleToPersist,
    destination: getInviteDestination(invite.role)
  });
}
