import { notFound } from "next/navigation";

import { CheckinForm } from "@/components/checkin/checkin-form";
import { TrackStatusEntry } from "@/components/patient/track-status-entry";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { Clinic, Doctor } from "@/lib/utils/types";

export const dynamic = "force-dynamic";

export default async function PublicCheckinPage({
  params
}: {
  params: Promise<{ clinicId: string }>;
}) {
  const { clinicId } = await params;
  const supabase = getSupabaseServiceRoleClient();
  const [{ data: clinic }, { data: doctors }] = await Promise.all([
    supabase.from("clinics").select("*").eq("id", clinicId).maybeSingle(),
    supabase
      .from("doctors")
      .select("*")
      .eq("clinic_id", clinicId)
      .neq("status", "offline")
      .order("name", { ascending: true })
  ]);

  if (!clinic) {
    notFound();
  }

  const clinicRecord = clinic as Clinic;

  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <Card className="qcare-hero mb-6">
        <CardHeader>
          <p className="qcare-kicker text-[11px]">
            QCare Check-in
          </p>
          <CardTitle className="mt-2 text-4xl leading-tight">
            Welcome to {clinicRecord.name}
          </CardTitle>
          <p className="max-w-2xl text-base text-muted-foreground">
            Fill in your details to receive your queue token. If your household
            already has records, select your name after entering your phone
            number.
          </p>
        </CardHeader>
      </Card>

      <TrackStatusEntry clinicId={clinicId} />

      <CheckinForm
        clinicId={clinicId}
        description="Public QR check-in flow. AI summaries will be layered in after this baseline token assignment path."
        doctors={(doctors as Doctor[] | null) ?? []}
        mode="qr"
        title="Patient check-in"
      />
    </main>
  );
}
