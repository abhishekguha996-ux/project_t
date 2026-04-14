import { requireDoctorAccess } from "@/lib/auth/guards";

export const dynamic = "force-dynamic";

export default async function DoctorPage() {
  const { user, doctor } = await requireDoctorAccess("/doctor");

  return (
    <main className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Doctor Dashboard Placeholder</h1>
      <p className="mt-4 text-muted-foreground">
        Access confirmed for {user.role} in clinic {user.clinicId}. Linked
        doctor profile: {doctor.name}. This page exists to validate the doctor
        access model before the full dashboard lands.
      </p>
    </main>
  );
}
