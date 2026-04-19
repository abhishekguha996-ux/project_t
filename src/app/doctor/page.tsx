import Link from "next/link";
import { notFound } from "next/navigation";

import { requireClinicUser } from "@/lib/auth/guards";
import { getLinkedDoctorProfile } from "@/lib/doctor-access";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { DoctorAccessSetup } from "@/components/doctor/doctor-access-setup";
import { DoctorWorkflowBoard } from "@/components/doctor/doctor-workflow-board";
import { Button } from "@/components/ui/button";
import type { Doctor } from "@/lib/utils/types";

export const dynamic = "force-dynamic";

export default async function DoctorPage({
  searchParams,
}: {
  searchParams: Promise<{ doctorId?: string }>;
}) {
  const user = await requireClinicUser("/doctor");

  if (user.role !== "doctor" && user.role !== "clinic_admin") {
    notFound();
  }

  const { doctorId: queryDoctorId } = await searchParams;
  const supabase = getSupabaseServiceRoleClient();

  // Always fetch doctor list for admins (used for the switcher dropdown)
  const allDoctors: Doctor[] =
    user.role === "clinic_admin"
      ? (((
          await supabase
            .from("doctors")
            .select("*")
            .eq("clinic_id", user.clinicId)
            .order("name", { ascending: true })
        ).data as Doctor[] | null) ?? [])
      : [];

  // Clinic admins can view any doctor's workspace via ?doctorId=
  if (user.role === "clinic_admin" && queryDoctorId) {
    const selected = allDoctors.find((d) => d.id === queryDoctorId);
    if (selected) {
      return <DoctorWorkflowBoard doctor={selected} allDoctors={allDoctors} />;
    }
  }

  const doctor = await getLinkedDoctorProfile(user);

  if (doctor) {
    return (
      <DoctorWorkflowBoard
        doctor={doctor}
        allDoctors={user.role === "clinic_admin" ? allDoctors : []}
      />
    );
  }

  // No linked doctor profile — show setup / error states
  const linkedDoctorId =
    (
      (
        await supabase
          .from("doctors")
          .select("id")
          .eq("clinic_id", user.clinicId)
          .eq("clerk_user_id", user.clerkUserId)
          .maybeSingle()
      ).data as { id: string } | null
    )?.id ?? null;

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <div className="mb-8">
        <p className="qcare-kicker">Doctor workspace</p>
        <h1 className="text-2xl font-bold text-slate-900">
          Doctor workflow console
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Signed in as {user.email ?? user.firstName ?? user.role} · Role{" "}
          {user.role}
        </p>
      </div>

      {user.role === "clinic_admin" ? (
        <div className="grid gap-4">
          <div className="rounded-2xl border border-amber-300/60 bg-amber-50/80 px-6 py-4 text-sm text-amber-800">
            You are signed in correctly, but this account is not linked to a
            doctor profile yet. Link one profile below to unlock doctor
            workflow.
          </div>
          <DoctorAccessSetup
            doctors={allDoctors}
            linkedDoctorId={linkedDoctorId}
          />
        </div>
      ) : (
        <div className="grid gap-4">
          <div className="rounded-2xl border border-amber-300/60 bg-amber-50/80 px-6 py-4 text-sm text-amber-800">
            Your doctor account has no linked doctor profile yet. Ask your
            clinic admin to send and complete a doctor invite for this same
            email.
          </div>
          <div>
            <Button asChild type="button" variant="outline">
              <Link href="/join">Open invite code entry</Link>
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}
