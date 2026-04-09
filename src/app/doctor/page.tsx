import { requireRole } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function DoctorPage() {
  const user = await requireRole(["clinic_admin", "doctor"], "/doctor");

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Doctor Dashboard Placeholder</h1>
      <p className="mt-4 text-muted-foreground">
        Access confirmed for {user.role} in clinic {user.clinicId}. This page
        exists to validate the Clerk role model and protected route setup.
      </p>
    </main>
  );
}
