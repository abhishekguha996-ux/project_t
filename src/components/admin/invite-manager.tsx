"use client";

import { useMemo, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { getInviteFailureMessage, getInviteStatus } from "@/lib/invites";
import type { Doctor, StaffInvite } from "@/lib/utils/types";

type InviteWithDoctor = StaffInvite & {
  doctors?: { id: string; name: string } | null;
};

export function InviteManager({
  appUrl,
  doctors,
  initialInvites,
  linkedDoctorId
}: {
  appUrl: string;
  doctors: Doctor[];
  initialInvites: InviteWithDoctor[];
  linkedDoctorId: string | null;
}) {
  const [role, setRole] = useState<"doctor" | "receptionist">("receptionist");
  const [inviteeName, setInviteeName] = useState("");
  const [inviteeEmail, setInviteeEmail] = useState("");
  const [doctorId, setDoctorId] = useState("");
  const [linkDoctorId, setLinkDoctorId] = useState(linkedDoctorId ?? "");
  const [invites, setInvites] = useState(initialInvites);
  const [createdInvite, setCreatedInvite] = useState<{
    inviteCode: string;
    inviteUrl: string;
    deliveryStatus: "pending" | "sent" | "failed";
    deliveryError?: string | null;
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const availableDoctors = useMemo(
    () =>
      doctors.filter(
        (doctor) =>
          !doctor.clerk_user_id || doctor.clerk_user_id === linkedDoctorId
      ),
    [doctors, linkedDoctorId]
  );

  async function refreshInvites() {
    const response = await fetch("/api/invites/list");
    const payload = (await response.json()) as { invites?: InviteWithDoctor[] };

    if (response.ok && payload.invites) {
      setInvites(payload.invites);
    }
  }

  function handleCreateInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    startTransition(async () => {
      const response = await fetch("/api/invites/create", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          role,
          inviteeName,
          inviteeEmail,
          doctorId: role === "doctor" ? doctorId : undefined
        })
      });

      const payload = (await response.json()) as {
        error?: string;
        inviteCode?: string;
        inviteUrl?: string;
        deliveryStatus?: "pending" | "sent" | "failed";
        deliveryError?: string | null;
      };

      if (
        !response.ok ||
        !payload.inviteCode ||
        !payload.inviteUrl ||
        !payload.deliveryStatus
      ) {
        setMessage(payload.error ?? "Failed to create invite.");
        return;
      }

      setCreatedInvite({
        inviteCode: payload.inviteCode,
        inviteUrl: payload.inviteUrl,
        deliveryStatus: payload.deliveryStatus,
        deliveryError: payload.deliveryError
      });
      setInviteeName("");
      setInviteeEmail("");
      setDoctorId("");
      setMessage(
        payload.deliveryStatus === "sent"
          ? `Invite emailed to ${payload.deliveryStatus === "sent" ? inviteeEmail : "staff member"}.`
          : payload.deliveryStatus === "pending"
            ? "Invite created. Resend is not configured yet, so use the copied link for now."
            : payload.deliveryError ?? "Invite created, but email delivery failed."
      );
      await refreshInvites();
    });
  }

  function handleRevoke(inviteId: string) {
    setMessage(null);

    startTransition(async () => {
      const response = await fetch("/api/invites/revoke", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ inviteId })
      });

      if (!response.ok) {
        const payload = (await response.json()) as { error?: string };
        setMessage(payload.error ?? "Failed to revoke invite.");
        return;
      }

      await refreshInvites();
    });
  }

  function handleResend(inviteId: string) {
    setMessage(null);

    startTransition(async () => {
      const response = await fetch("/api/invites/resend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ inviteId })
      });

      const payload = (await response.json()) as {
        error?: string;
        deliveryStatus?: "pending" | "sent" | "failed";
        deliveryError?: string | null;
      };

      if (!response.ok) {
        setMessage(payload.error ?? "Failed to resend invite email.");
        return;
      }

      setMessage(
        payload.deliveryStatus === "sent"
          ? "Invite email sent."
          : payload.deliveryStatus === "pending"
            ? "Invite is still pending because Resend is not configured locally."
            : payload.deliveryError ?? "Invite resend failed."
      );
      await refreshInvites();
    });
  }

  function handleLinkDoctor(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    startTransition(async () => {
      const response = await fetch("/api/account/link-doctor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ doctorId: linkDoctorId })
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        setMessage(payload.error ?? "Failed to link doctor profile.");
        return;
      }

      setMessage("Your account is now linked to that doctor profile.");
    });
  }

  async function copyInvite(inviteUrl: string) {
    await navigator.clipboard.writeText(inviteUrl);
    setMessage("Invite link copied.");
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="bg-card/85">
          <CardHeader>
            <CardTitle>Create staff invite</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={handleCreateInvite}>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Role</span>
                <select
                  className="h-11 rounded-2xl border border-input bg-card px-4"
                  value={role}
                  onChange={(event) =>
                    setRole(event.target.value as "doctor" | "receptionist")
                  }
                >
                  <option value="receptionist">Receptionist</option>
                  <option value="doctor">Doctor</option>
                </select>
              </label>

              {role === "doctor" ? (
                <label className="grid gap-2 text-sm">
                  <span className="font-medium">Doctor profile</span>
                  <select
                    className="h-11 rounded-2xl border border-input bg-card px-4"
                    value={doctorId}
                    onChange={(event) => setDoctorId(event.target.value)}
                    required
                  >
                    <option value="">Select doctor</option>
                    {availableDoctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="grid gap-2 text-sm">
                <span className="font-medium">Invitee name</span>
                <input
                  className="h-11 rounded-2xl border border-input bg-card px-4"
                  value={inviteeName}
                  onChange={(event) => setInviteeName(event.target.value)}
                  placeholder="Dr. Meera Shah"
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium">Invitee email</span>
                <input
                  className="h-11 rounded-2xl border border-input bg-card px-4"
                  value={inviteeEmail}
                  onChange={(event) => setInviteeEmail(event.target.value)}
                  placeholder="meera@clinic.example"
                  type="email"
                  required
                />
              </label>

              <Button disabled={isPending} type="submit">
                {isPending ? "Working..." : "Create invite"}
              </Button>
            </form>

            {createdInvite ? (
              <div className="mt-5 rounded-3xl border border-border bg-background/70 p-4 text-sm">
                <p className="font-medium">Latest invite</p>
                <p className="mt-2 text-muted-foreground">
                  Code: <span className="font-semibold text-foreground">{createdInvite.inviteCode}</span>
                </p>
                <p className="mt-1 break-all text-muted-foreground">
                  Link: {createdInvite.inviteUrl}
                </p>
                <p className="mt-1 text-muted-foreground">
                  Email status:{" "}
                  <span className="font-semibold text-foreground">
                    {createdInvite.deliveryStatus}
                  </span>
                </p>
                {createdInvite.deliveryError ? (
                  <p className="mt-1 text-sm text-rose-700">
                    {createdInvite.deliveryError}
                  </p>
                ) : null}
                <div className="mt-3">
                  <Button
                    onClick={() => copyInvite(createdInvite.inviteUrl)}
                    type="button"
                    variant="outline"
                  >
                    Copy latest invite
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="bg-card/85">
          <CardHeader>
            <CardTitle>Admin is also doctor</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={handleLinkDoctor}>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Link my account to doctor profile</span>
                <select
                  className="h-11 rounded-2xl border border-input bg-card px-4"
                  value={linkDoctorId}
                  onChange={(event) => setLinkDoctorId(event.target.value)}
                >
                  <option value="">Select doctor profile</option>
                  {availableDoctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button disabled={!linkDoctorId || isPending} type="submit">
                {isPending ? "Working..." : "Link doctor profile"}
              </Button>
            </form>
            <p className="mt-4 text-sm text-muted-foreground">
              Use this when the clinic owner is also the practicing doctor and
              should access both admin and doctor workflows.
            </p>
          </CardContent>
        </Card>
      </div>

      {message ? (
        <Card className="border-accent/40 bg-accent/10">
          <CardContent className="pt-6 text-sm">{message}</CardContent>
        </Card>
      ) : null}

      <Card className="bg-card/85">
        <CardHeader>
          <CardTitle>Invite history</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            {invites.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No invites created yet.
              </p>
            ) : (
              invites.map((invite) => {
                const status = getInviteStatus(invite.status, invite.expires_at);
                const inviteUrl = `${appUrl}/join/${invite.invite_code}`;

                return (
                  <div
                    className="rounded-3xl border border-border/80 bg-background/70 p-4"
                    key={invite.id}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold">
                          {invite.invitee_name || "Unnamed invite"} ·{" "}
                          {invite.role}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Code {invite.invite_code}
                          {invite.doctors?.name
                            ? ` · Links to ${invite.doctors.name}`
                            : ""}
                        </p>
                        {invite.invitee_email ? (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {invite.invitee_email}
                          </p>
                        ) : null}
                        <p className="mt-1 text-sm text-muted-foreground">
                          Email delivery:{" "}
                          <span className="font-medium text-foreground">
                            {invite.delivery_status}
                          </span>
                        </p>
                        {invite.delivery_error ? (
                          <p className="mt-1 text-sm text-rose-700">
                            {invite.delivery_error}
                          </p>
                        ) : null}
                      </div>
                      <div
                        className={cn(
                          "rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide",
                          status === "pending" &&
                            "bg-primary/15 text-primary",
                          status === "accepted" &&
                            "bg-emerald-600/15 text-emerald-700",
                          status !== "pending" &&
                            status !== "accepted" &&
                            "bg-secondary text-secondary-foreground"
                        )}
                      >
                        {status}
                      </div>
                    </div>

                    <p className="mt-3 break-all text-sm text-muted-foreground">
                      {inviteUrl}
                    </p>

                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button
                        onClick={() => copyInvite(inviteUrl)}
                        type="button"
                        variant="outline"
                      >
                        Copy link
                      </Button>
                      {status === "pending" ? (
                        <Button
                          onClick={() => handleResend(invite.id)}
                          type="button"
                          variant="outline"
                        >
                          Resend email
                        </Button>
                      ) : null}
                      {status === "pending" ? (
                        <Button
                          onClick={() => handleRevoke(invite.id)}
                          type="button"
                          variant="ghost"
                        >
                          Revoke
                        </Button>
                      ) : null}
                    </div>

                    {status !== "pending" ? (
                      <p className="mt-3 text-sm text-muted-foreground">
                        {getInviteFailureMessage(status)}
                      </p>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
