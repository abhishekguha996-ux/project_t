import Link from "next/link";
import { notFound } from "next/navigation";

import { requireClinicUser } from "@/lib/auth/guards";
import { getLinkedDoctorProfile } from "@/lib/doctor-access";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import { DoctorAccessSetup } from "@/components/doctor/doctor-access-setup";
import { DoctorWorkflowBoard } from "@/components/doctor/doctor-workflow-board";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Doctor } from "@/lib/utils/types";

export const dynamic = "force-dynamic";

export default async function DoctorPage() {
  const user = await requireClinicUser("/doctor");

  if (user.role !== "doctor" && user.role !== "clinic_admin") {
    notFound();
  }

  const doctor = await getLinkedDoctorProfile(user);
  const supabase = getSupabaseServiceRoleClient();
  const doctorList: Doctor[] =
    user.role === "clinic_admin"
      ? (((await supabase
          .from("doctors")
          .select("*")
          .eq("clinic_id", user.clinicId)
          .order("name", { ascending: true })).data as Doctor[] | null) ?? [])
      : [];
  const linkedDoctorId =
    ((await supabase
      .from("doctors")
      .select("id")
      .eq("clinic_id", user.clinicId)
      .eq("clerk_user_id", user.clerkUserId)
      .maybeSingle()).data as { id: string } | null)?.id ?? null;

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="mb-6 grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card className="qcare-hero">
          <CardHeader>
            <p className="qcare-kicker">Doctor workspace</p>
            <CardTitle className="text-3xl">Doctor workflow console</CardTitle>
            <p className="max-w-2xl text-base text-muted-foreground">
              Move patients through consultation, done, skipped, and Hold slot
              states. Reception and patient tracking views consume these same
              queue transitions.
            </p>
          </CardHeader>
        </Card>
        <Card className="qcare-panel-soft">
          <CardHeader>
            <CardTitle>Session context</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Signed in as {user.email ?? user.firstName ?? user.role} · Role{" "}
            {user.role}
          </CardContent>
        </Card>
      </div>

      {doctor ? (
        <DoctorWorkflowBoard doctor={doctor} />
      ) : user.role === "clinic_admin" ? (
        <div className="grid gap-4">
          <Card className="border-amber-300/60 bg-amber-50/80">
            <CardContent className="pt-6 text-sm text-amber-800">
              You are signed in correctly, but this account is not linked to a
              doctor profile yet. Link one profile below to unlock doctor workflow.
            </CardContent>
          </Card>
          <DoctorAccessSetup doctors={doctorList} linkedDoctorId={linkedDoctorId} />
        </div>
      ) : (
        <Card className="border-amber-300/60 bg-amber-50/80">
          <CardContent className="grid gap-4 pt-6 text-sm text-amber-800">
            <p>
              Your doctor account has no linked doctor profile yet. Ask your clinic
              admin to send and complete a doctor invite for this same email.
            </p>
            <div>
              <Button asChild type="button" variant="outline">
                <Link href="/join">Open invite code entry</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
