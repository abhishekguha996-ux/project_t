import Link from "next/link";

import { CheckinForm } from "@/components/checkin/checkin-form";
import { ReceptionNav } from "@/components/reception/reception-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/guards";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { Doctor } from "@/lib/utils/types";

export const dynamic = "force-dynamic";

export default async function ReceptionCheckinPage() {
  const user = await requireRole(["clinic_admin", "receptionist"], "/reception/checkin");
  const supabase = getSupabaseServiceRoleClient();
  const { data: doctors } = await supabase
    .from("doctors")
    .select("*")
    .eq("clinic_id", user.clinicId)
    .neq("status", "offline")
    .order("name", { ascending: true });

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
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
          <CardTitle className="text-3xl">Reception Quick Add</CardTitle>
          <p className="max-w-2xl text-base text-muted-foreground">
            Dedicated check-in view for walk-ins. Queue operations are available in the
            Queue Board tab.
          </p>
        </CardHeader>
      </Card>

      <CheckinForm
        clinicId={user.clinicId}
        description="Use this form for front desk intake, household lookup, and immediate token assignment."
        doctors={(doctors as Doctor[] | null) ?? []}
        mode="reception"
        title="Reception quick-add check-in"
      />
    </main>
  );
}
