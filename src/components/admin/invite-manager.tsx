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
  const [doctorRecords, setDoctorRecords] = useState(doctors);
  const [activeLinkedDoctorId, setActiveLinkedDoctorId] = useState<string | null>(
    linkedDoctorId
  );
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

  const inviteableDoctors = useMemo(
    () => doctorRecords.filter((doctor) => !doctor.clerk_user_id),
    [doctorRecords]
  );
  const linkableDoctors = useMemo(
    () =>
      doctorRecords.filter(
        (doctor) =>
          !doctor.clerk_user_id ||
          (activeLinkedDoctorId !== null && doctor.id === activeLinkedDoctorId)
      ),
    [doctorRecords, activeLinkedDoctorId]
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

      setDoctorRecords((existingDoctors) =>
        existingDoctors.map((doctor) =>
          doctor.id === linkDoctorId
            ? { ...doctor, clerk_user_id: "__linked_to_current_admin__" }
            : doctor
        )
      );
      setActiveLinkedDoctorId(linkDoctorId);
      setMessage("Your account is now linked to that doctor profile.");
    });
  }

  function handleUnlinkDoctor() {
    setMessage(null);

    startTransition(async () => {
      const response = await fetch("/api/account/unlink-doctor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          doctorId: activeLinkedDoctorId ?? undefined
        })
      });

      const payload = (await response.json()) as {
        error?: string;
        doctorIds?: string[];
      };

      if (!response.ok) {
        setMessage(payload.error ?? "Failed to unlink doctor profile.");
        return;
      }

      setDoctorRecords((existingDoctors) =>
        existingDoctors.map((doctor) =>
          payload.doctorIds?.includes(doctor.id)
            ? { ...doctor, clerk_user_id: null }
            : doctor
        )
      );
      setActiveLinkedDoctorId(null);
      setLinkDoctorId("");
      setMessage("Doctor profile unlinked. You can now send a fresh doctor invite.");
    });
  }

  async function copyInvite(inviteUrl: string) {
    await navigator.clipboard.writeText(inviteUrl);
    setMessage("Invite link copied.");
  }

  return (
    <div className="grid gap-6">
      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card className="qcare-panel-soft">
          <CardHeader>
            <CardTitle>Create staff invite</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={handleCreateInvite}>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Role</span>
                <select
                  className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
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
                    className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                    value={doctorId}
                    onChange={(event) => setDoctorId(event.target.value)}
                    required
                  >
                    <option value="">Select doctor</option>
                    {inviteableDoctors.map((doctor) => (
                      <option key={doctor.id} value={doctor.id}>
                        {doctor.name}
                      </option>
                    ))}
                  </select>
                  {inviteableDoctors.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      All doctor profiles are already linked. Invite
                      receptionists, or add a new doctor profile before sending
                      another doctor invite.
                    </span>
                  ) : null}
                </label>
              ) : null}

              <label className="grid gap-2 text-sm">
                <span className="font-medium">Invitee name</span>
                <input
                  className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                  value={inviteeName}
                  onChange={(event) => setInviteeName(event.target.value)}
                  placeholder="Dr. Meera Shah"
                />
              </label>

              <label className="grid gap-2 text-sm">
                <span className="font-medium">Invitee email</span>
                <input
                  className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                  value={inviteeEmail}
                  onChange={(event) => setInviteeEmail(event.target.value)}
                  placeholder="meera@clinic.example"
                  type="email"
                  required
                />
              </label>

              <Button
                disabled={isPending || (role === "doctor" && !doctorId)}
                type="submit"
              >
                {isPending ? "Working..." : "Create invite"}
              </Button>
            </form>

            {createdInvite ? (
              <div className="mt-5 rounded-2xl border border-border bg-white/75 p-4 text-sm">
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
                  <p className="mt-1 text-sm text-destructive">
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

        <Card className="qcare-panel-soft">
          <CardHeader>
            <CardTitle>Admin is also doctor</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4" onSubmit={handleLinkDoctor}>
              <label className="grid gap-2 text-sm">
                <span className="font-medium">Link my account to doctor profile</span>
                <select
                  className="h-11 rounded-xl border border-input bg-white px-3 text-[13px]"
                  value={linkDoctorId}
                  onChange={(event) => setLinkDoctorId(event.target.value)}
                >
                  <option value="">Select doctor profile</option>
                  {linkableDoctors.map((doctor) => (
                    <option key={doctor.id} value={doctor.id}>
                      {doctor.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button disabled={!linkDoctorId || isPending} type="submit">
                {isPending ? "Working..." : "Link doctor profile"}
              </Button>
              {activeLinkedDoctorId ? (
                <Button
                  disabled={isPending}
                  onClick={handleUnlinkDoctor}
                  type="button"
                  variant="outline"
                >
                  {isPending ? "Working..." : "Unlink my doctor profile"}
                </Button>
              ) : null}
            </form>
            <p className="mt-4 text-sm text-muted-foreground">
              Use this when the clinic owner is also the practicing doctor and
              should access both admin and doctor workflows.
            </p>
          </CardContent>
        </Card>
      </div>

      {message ? (
        <Card className="border-indigo-200/70 bg-indigo-50/85">
          <CardContent className="pt-6 text-sm">{message}</CardContent>
        </Card>
      ) : null}

      <Card className="qcare-panel-soft">
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
                    className="rounded-2xl border border-border/80 bg-white/75 p-4"
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
                          <p className="mt-1 text-sm text-destructive">
                            {invite.delivery_error}
                          </p>
                        ) : null}
                      </div>
                      <div
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-semibold uppercase tracking-wide",
                          status === "pending" &&
                            "bg-indigo-100 text-indigo-700",
                          status === "accepted" &&
                            "bg-emerald-100 text-emerald-700",
                          status !== "pending" &&
                            status !== "accepted" &&
                            "bg-slate-100 text-slate-600"
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
