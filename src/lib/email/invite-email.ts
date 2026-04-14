import { Resend } from "resend";

import { getServerEnv } from "@/lib/env/server";
import type { StaffInvite } from "@/lib/utils/types";

type SendInviteEmailParams = {
  clinicName: string;
  invite: Pick<
    StaffInvite,
    "invite_code" | "invitee_name" | "invitee_email" | "role" | "expires_at"
  >;
  inviteUrl: string;
};

type SendInviteEmailResult =
  | { status: "sent"; error: null; skipped: false }
  | { status: "pending"; error: null; skipped: true }
  | { status: "failed"; error: string; skipped: false };

function formatInviteExpiry(expiresAt: string) {
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(expiresAt));
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildInviteEmailHtml(params: SendInviteEmailParams) {
  const inviteeName = params.invite.invitee_name?.trim() || "there";
  const expiry = formatInviteExpiry(params.invite.expires_at);
  const roleLabel =
    params.invite.role === "doctor" ? "doctor" : "reception team member";

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;background:#f3f1e8;padding:24px;font-family:Arial,sans-serif;color:#17332f;">
    <div style="margin:0 auto;max-width:640px;border-radius:24px;overflow:hidden;background:#ffffff;border:1px solid rgba(23,51,47,0.12);">
      <div style="padding:32px;background:linear-gradient(160deg,#134e4a,#1b6f67);color:#f5f9f7;">
        <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.82;">QCare invite</div>
        <h1 style="margin:16px 0 8px;font-size:32px;line-height:1.15;">${escapeHtml(params.clinicName)} invited you to join.</h1>
        <p style="margin:0;font-size:16px;line-height:1.6;color:rgba(245,249,247,0.88);">
          Hi ${escapeHtml(inviteeName)}, your clinic admin created a staff invite for you as a ${escapeHtml(roleLabel)}.
        </p>
      </div>
      <div style="padding:32px;">
        <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">
          Continue with the same email address this invite was sent to. QCare will use that to attach the right clinic access automatically.
        </p>
        <div style="margin:24px 0;">
          <a href="${escapeHtml(params.inviteUrl)}" style="display:inline-block;border-radius:999px;background:#134e4a;padding:14px 24px;color:#ffffff;text-decoration:none;font-weight:700;">
            Accept invite
          </a>
        </div>
        <div style="border-radius:20px;background:#f8f7f2;padding:20px;">
          <p style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.12em;color:#4d6763;">Invite code</p>
          <p style="margin:0 0 16px;font-size:24px;font-weight:700;letter-spacing:0.2em;color:#17332f;">${escapeHtml(params.invite.invite_code)}</p>
          <p style="margin:0;font-size:14px;line-height:1.6;color:#4d6763;">Link expires on ${escapeHtml(expiry)}.</p>
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function buildInviteEmailText(params: SendInviteEmailParams) {
  const inviteeName = params.invite.invitee_name?.trim() || "there";
  const expiry = formatInviteExpiry(params.invite.expires_at);

  return [
    `Hi ${inviteeName},`,
    "",
    `${params.clinicName} invited you to join QCare as a ${params.invite.role}.`,
    "Continue with the same email address this invite was sent to.",
    "",
    `Accept invite: ${params.inviteUrl}`,
    `Invite code: ${params.invite.invite_code}`,
    `Expires: ${expiry}`
  ].join("\n");
}

export async function sendInviteEmail(
  params: SendInviteEmailParams
): Promise<SendInviteEmailResult> {
  const env = getServerEnv();

  if (!params.invite.invitee_email) {
    return {
      status: "failed",
      error: "Invitee email is required to send email.",
      skipped: false
    };
  }

  if (!env.RESEND_API_KEY || !env.QCARE_INVITE_FROM_EMAIL) {
    console.info(
      `[QCare] Invite email not sent because Resend is not configured. ${params.inviteUrl}`
    );

    return {
      status: "pending",
      error: null,
      skipped: true
    };
  }

  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const result = await resend.emails.send({
      from: env.QCARE_INVITE_FROM_EMAIL,
      to: params.invite.invitee_email,
      replyTo: env.QCARE_INVITE_REPLY_TO_EMAIL,
      subject: `${params.clinicName} invited you to join QCare`,
      html: buildInviteEmailHtml(params),
      text: buildInviteEmailText(params)
    });

    if (result.error) {
      return {
        status: "failed",
        error: result.error.message,
        skipped: false
      };
    }

    return {
      status: "sent",
      error: null,
      skipped: false
    };
  } catch (error) {
    return {
      status: "failed",
      error: error instanceof Error ? error.message : "Failed to send invite email.",
      skipped: false
    };
  }
}
