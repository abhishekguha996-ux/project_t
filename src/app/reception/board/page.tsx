import Link from "next/link";

import { ReceptionQueueBoard } from "@/components/reception/reception-queue-board";
import { ReceptionNav } from "@/components/reception/reception-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { requireRole } from "@/lib/auth/guards";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { Doctor } from "@/lib/utils/types";

export const dynamic = "force-dynamic";

export default async function ReceptionBoardPage() {
  const user = await requireRole(["clinic_admin", "receptionist"], "/reception/board");
  const supabase = getSupabaseServiceRoleClient();
  const { data: doctors } = await supabase
    .from("doctors")
    .select("*")
    .eq("clinic_id", user.clinicId)
    .neq("status", "offline")
    .order("name", { ascending: true });

  return (
    <main className="mx-auto w-full max-w-[1500px] px-6 py-8">
      <div className="mb-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="qcare-hero">
          <CardHeader>
            <p className="qcare-kicker">Reception workspace</p>
            <CardTitle className="text-3xl">Reception Operations Board</CardTitle>
            <p className="max-w-3xl text-base text-muted-foreground">
              Move patients between queue lanes with drag and drop, manage hold-slot
              notes, pause doctor queue for emergencies, and run checkout statuses
              after consultation.
            </p>
          </CardHeader>
        </Card>
        <Card className="qcare-panel-soft">
          <CardHeader>
            <CardTitle>Session context</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Signed in as {user.email ?? user.firstName ?? user.role} · Role {user.role}
          </CardContent>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <ReceptionNav />
        {user.role === "clinic_admin" ? (
          <Button asChild type="button" variant="outline">
            <Link href="/admin">Open admin onboarding</Link>
          </Button>
        ) : null}
      </div>

      <ReceptionQueueBoard actorRole={user.role} doctors={(doctors as Doctor[] | null) ?? []} />
    </main>
  );
}
