import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  await requireRole(["clinic_admin"], "/analytics");

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Analytics Placeholder</h1>
      <p className="mt-4 text-muted-foreground">
        Phase 1 includes the aggregated stats table and cron wiring, but not
        the analytics UI itself.
      </p>
    </main>
  );
}
