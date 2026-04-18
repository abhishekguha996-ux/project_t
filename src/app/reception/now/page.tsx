import Link from "next/link";

import { NowConsole } from "@/components/reception/now-console";
import { ReceptionNav } from "@/components/reception/reception-nav";
import { Button } from "@/components/ui/button";
import { requireRole } from "@/lib/auth/guards";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { Doctor } from "@/lib/utils/types";

export const dynamic = "force-dynamic";

export default async function ReceptionNowPage() {
  const user = await requireRole(["clinic_admin", "receptionist"], "/reception/now");
  const supabase = getSupabaseServiceRoleClient();
  const { data: doctors } = await supabase
    .from("doctors")
    .select("*")
    .eq("clinic_id", user.clinicId)
    .neq("status", "offline")
    .order("name", { ascending: true });

  return (
    <main className="mx-auto w-full max-w-[1500px] px-6 py-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <ReceptionNav />
        {user.role === "clinic_admin" ? (
          <Button asChild type="button" variant="outline">
            <Link href="/admin">Open admin onboarding</Link>
          </Button>
        ) : null}
      </div>

      <NowConsole
        actorRole={user.role}
        clinicId={user.clinicId}
        doctors={(doctors as Doctor[] | null) ?? []}
        userLabel={user.email ?? user.firstName ?? user.role}
      />
    </main>
  );
}
