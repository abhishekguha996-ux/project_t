import { InviteManager } from "@/components/admin/invite-manager";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/guards";
import { getServerEnv } from "@/lib/env/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { Doctor, StaffInvite } from "@/lib/utils/types";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const user = await requireRole(["clinic_admin"], "/admin");
  const supabase = getSupabaseServiceRoleClient();
  const env = getServerEnv();

  const [{ data: invites }, { data: doctors }, { data: linkedDoctor }] =
    await Promise.all([
      supabase
        .from("staff_invites")
        .select("*, doctors(id, name)")
        .eq("clinic_id", user.clinicId)
        .order("created_at", { ascending: false }),
      supabase
        .from("doctors")
        .select("*")
        .eq("clinic_id", user.clinicId)
        .order("name", { ascending: true }),
      supabase
        .from("doctors")
        .select("id")
        .eq("clinic_id", user.clinicId)
        .eq("clerk_user_id", user.clerkUserId)
        .maybeSingle()
    ]);

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="overflow-hidden border-primary/20 bg-[linear-gradient(160deg,rgba(19,78,74,0.97),rgba(27,111,103,0.88))] text-primary-foreground">
          <CardHeader>
            <CardTitle className="text-3xl">
              Staff onboarding and access control
            </CardTitle>
            <CardDescription className="max-w-2xl text-base text-primary-foreground/80">
              Create one-time invite links for doctors and receptionists, track
              their status, and handle the common small-clinic case where the
              clinic owner is also the doctor.
            </CardDescription>
          </CardHeader>
        </Card>
        <Card className="bg-card/85">
          <CardHeader>
            <CardTitle>Clinic admin</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Signed in as {user.email ?? user.firstName ?? "Clinic admin"} for
            clinic {user.clinicId}.
          </CardContent>
        </Card>
      </div>

      <InviteManager
        appUrl={env.NEXT_PUBLIC_APP_URL}
        doctors={(doctors as Doctor[] | null) ?? []}
        initialInvites={(invites as (StaffInvite & { doctors?: { id: string; name: string } | null })[] | null) ?? []}
        linkedDoctorId={(linkedDoctor as { id: string } | null)?.id ?? null}
      />
    </main>
  );
}
