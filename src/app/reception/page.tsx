import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function ReceptionPage() {
  const user = await requireRole(["clinic_admin", "receptionist"], "/reception");

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Reception Dashboard Placeholder</h1>
      <p className="mt-4 text-muted-foreground">
        Access confirmed for {user.role} in clinic {user.clinicId}. Phase 1
        sets up route protection only; queue operations arrive in later phases.
      </p>
    </main>
  );
}
