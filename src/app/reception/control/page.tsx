import Link from "next/link";

import { ReceptionNav } from "@/components/reception/reception-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/guards";
import {
  formatQueueEventAction,
  formatQueuePauseReason,
  formatTokenStatusLabel
} from "@/lib/queue/labels";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function formatDateTime(value: string | null) {
  if (!value) {
    return "N/A";
  }

  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

export default async function ReceptionControlPage() {
  const user = await requireRole(["clinic_admin", "receptionist"], "/reception/control");
  const supabase = getSupabaseServiceRoleClient();
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: pauses }, { data: holdSlots }, { data: recentEvents }] = await Promise.all([
    supabase
      .from("doctor_queue_pauses")
      .select("id, reason, note, ends_at, doctors(name)")
      .eq("clinic_id", user.clinicId)
      .eq("is_active", true)
      .order("ends_at", { ascending: true }),
    supabase
      .from("tokens")
      .select("id, token_number, hold_until, hold_note, patients(name, phone), doctors(name)")
      .eq("clinic_id", user.clinicId)
      .eq("date", today)
      .eq("status", "stepped_out")
      .order("hold_until", { ascending: true }),
    supabase
      .from("token_event_log")
      .select("id, action, from_state, to_state, created_at, tokens(token_number), doctors(name)")
      .eq("clinic_id", user.clinicId)
      .order("created_at", { ascending: false })
      .limit(20)
  ]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <ReceptionNav />
        {user.role === "clinic_admin" ? (
          <Button asChild type="button" variant="outline">
            <Link href="/admin">Open admin onboarding</Link>
          </Button>
        ) : null}
      </div>

      <Card className="qcare-hero mb-6">
        <CardHeader>
          <p className="qcare-kicker">Reception workspace</p>
          <CardTitle className="text-3xl">Reception Control Center</CardTitle>
          <p className="max-w-3xl text-base text-muted-foreground">
            Monitor active doctor pauses, current Hold slot patients, and recent queue
            transitions for operational debugging and workflow tuning.
          </p>
        </CardHeader>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="qcare-panel-soft">
          <CardHeader>
            <CardTitle>Active doctor pauses</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {((pauses as Array<{
              id: string;
              reason: string;
              note: string | null;
              ends_at: string;
              doctors: { name?: string | null } | null;
            }> | null) ?? []).length === 0 ? (
              <p className="text-muted-foreground">No active doctor pauses.</p>
            ) : (
              ((pauses as Array<{
                id: string;
                reason: string;
                note: string | null;
                ends_at: string;
                doctors: { name?: string | null } | null;
              }> | null) ?? []).map((pause) => (
                <div className="rounded-2xl border border-border/70 bg-white/75 p-3" key={pause.id}>
                  <p className="font-medium">{pause.doctors?.name ?? "Doctor"}</p>
                  <p className="text-muted-foreground">Reason: {formatQueuePauseReason(pause.reason)}</p>
                  {pause.note ? <p className="text-muted-foreground">Note: {pause.note}</p> : null}
                  <p className="text-muted-foreground">Ends: {formatDateTime(pause.ends_at)}</p>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="qcare-panel-soft">
          <CardHeader>
            <CardTitle>Active hold slots</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {((holdSlots as Array<{
              id: string;
              token_number: number;
              hold_until: string | null;
              hold_note: string | null;
              patients: { name?: string | null; phone?: string | null } | null;
              doctors: { name?: string | null } | null;
            }> | null) ?? []).length === 0 ? (
              <p className="text-muted-foreground">No patients in Hold slot.</p>
            ) : (
              ((holdSlots as Array<{
                id: string;
                token_number: number;
                hold_until: string | null;
                hold_note: string | null;
                patients: { name?: string | null; phone?: string | null } | null;
                doctors: { name?: string | null } | null;
              }> | null) ?? []).map((token) => (
                <div className="rounded-2xl border border-border/70 bg-white/75 p-3" key={token.id}>
                  <p className="font-medium">
                    #{token.token_number} · {token.patients?.name ?? "Patient"}
                  </p>
                  <p className="text-muted-foreground">
                    {token.patients?.phone ?? "No phone"} · Doctor {token.doctors?.name ?? "N/A"}
                  </p>
                  {token.hold_note ? (
                    <p className="text-muted-foreground">Note: {token.hold_note}</p>
                  ) : null}
                  <p className="text-muted-foreground">
                    Hold until: {formatDateTime(token.hold_until)}
                  </p>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 qcare-panel-soft">
        <CardHeader>
          <CardTitle>Recent queue events</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-2xl border border-border/70 bg-white/75">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Doctor</th>
                  <th className="px-4 py-3">Token</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Transition</th>
                </tr>
              </thead>
              <tbody>
                {((recentEvents as Array<{
                  id: string;
                  action: string;
                  from_state: string | null;
                  to_state: string | null;
                  created_at: string;
                  tokens: { token_number?: number | null } | null;
                  doctors: { name?: string | null } | null;
                }> | null) ?? []).map((event) => (
                  <tr className="border-b border-border/60 last:border-0" key={event.id}>
                    <td className="px-4 py-3">{formatDateTime(event.created_at)}</td>
                    <td className="px-4 py-3">{event.doctors?.name ?? "Doctor"}</td>
                    <td className="px-4 py-3">
                      {event.tokens?.token_number ? `#${event.tokens.token_number}` : "-"}
                    </td>
                    <td className="px-4 py-3">{formatQueueEventAction(event.action)}</td>
                    <td className="px-4 py-3">
                      {formatTokenStatusLabel(event.from_state)} → {formatTokenStatusLabel(event.to_state)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
