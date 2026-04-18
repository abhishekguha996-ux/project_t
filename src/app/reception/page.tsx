import { NowConsole } from "@/components/reception/now-console";
import { requireRole } from "@/lib/auth/guards";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { Clinic, Doctor } from "@/lib/utils/types";

export const dynamic = "force-dynamic";

export default async function ReceptionPage() {
  const user = await requireRole(["clinic_admin", "receptionist"], "/reception");
  const supabase = getSupabaseServiceRoleClient();

  const [{ data: clinic }, { data: doctors }] = await Promise.all([
    supabase.from("clinics").select("*").eq("id", user.clinicId).maybeSingle(),
    supabase
      .from("doctors")
      .select("*")
      .eq("clinic_id", user.clinicId)
      .neq("status", "offline")
      .order("name", { ascending: true })
  ]);

  return (
    <NowConsole
      actorRole={user.role}
      clinic={(clinic as Clinic | null) ?? null}
      doctors={(doctors as Doctor[] | null) ?? []}
      userLabel={user.email ?? user.firstName ?? user.role}
    />
  );
}
