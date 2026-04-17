import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getInviteFailureMessage, getInviteStatus } from "@/lib/invites";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function JoinInvitePage({
  params
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const inviteCode = code.toUpperCase();
  const session = await auth();
  const supabase = getSupabaseServiceRoleClient();
  const { data: invite } = await supabase
    .from("staff_invites")
    .select(
      "invite_code, role, invitee_name, invitee_email, status, expires_at, clinics(name)"
    )
    .eq("invite_code", inviteCode)
    .maybeSingle();

  if (!invite) {
    return (
      <JoinInviteError
        message={getInviteFailureMessage("invalid")}
        title="Invite unavailable"
      />
    );
  }

  const status = getInviteStatus(
    invite.status as "pending" | "accepted" | "expired" | "revoked",
    invite.expires_at
  );

  if (status !== "pending") {
    return (
      <JoinInviteError
        message={getInviteFailureMessage(status)}
        title="Invite unavailable"
      />
    );
  }

  if (session.userId) {
    redirect(`/join/${inviteCode}/accept` as never);
  }

  const redirectUrl = `/join/${inviteCode}/accept`;
  const clinicName = (invite.clinics as { name?: string } | null)?.name ?? "Clinic";

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl gap-8 px-6 py-10 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="flex flex-col justify-between gap-6">
        <Card className="qcare-hero">
          <CardHeader>
            <p className="qcare-kicker">QCare invite</p>
            <CardTitle className="text-4xl leading-tight">
              {clinicName} invited you to join QCare as a {invite.role}.
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              {invite.invitee_name
                ? `This invite was prepared for ${invite.invitee_name}.`
                : "Complete sign-up or sign-in to finish joining the clinic workspace."}
            </CardDescription>
          </CardHeader>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="qcare-panel-soft">
            <CardHeader>
            <CardTitle className="text-base">Role locked</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              The clinic admin already selected your role. This invite will
              attach the correct permissions automatically.
            </CardContent>
          </Card>
          <Card className="qcare-panel-soft">
            <CardHeader>
              <CardTitle className="text-base">Email-bound invite</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Continue with{" "}
              <span className="font-semibold text-foreground">
                {invite.invitee_email}
              </span>
              . This single-use invite only works with that same email address.
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Continue onboarding</CardTitle>
            <CardDescription>
              Create your account or sign back in with{" "}
              <span className="font-medium text-foreground">
                {invite.invitee_email}
              </span>
              , and we will send you to the right dashboard.
            </CardDescription>
          </CardHeader>
            <CardContent className="grid gap-3">
              <Button asChild>
                <Link
                  href={
                    `/sign-up?redirect_url=${encodeURIComponent(redirectUrl)}&email_address=${encodeURIComponent(
                      invite.invitee_email ?? ""
                    )}` as never
                  }
                >
                  Create staff account
                </Link>
              </Button>
              <Button asChild variant="outline">
                <Link
                  href={
                    `/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}&identifier=${encodeURIComponent(
                      invite.invitee_email ?? ""
                    )}` as never
                  }
                >
                  I already have an account
                </Link>
              </Button>
            </CardContent>
        </Card>
      </section>
    </main>
  );
}

function JoinInviteError({
  title,
  message
}: {
  title: string;
  message: string;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl items-center px-6 py-10">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/join">Try another code</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
