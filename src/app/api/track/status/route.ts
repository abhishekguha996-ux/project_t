import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { CheckoutStage, TokenStatus } from "@/lib/utils/types";

const tokenIdSchema = z.string().uuid();

type TrackTokenRow = {
  id: string;
  clinic_id: string;
  doctor_id: string;
  token_number: number;
  date: string;
  status: TokenStatus;
  checked_in_at: string;
  serving_started_at: string | null;
  completed_at: string | null;
  raw_complaint: string | null;
  patients: { name?: string | null; phone?: string | null } | null;
  doctors: {
    id?: string | null;
    name?: string | null;
    avg_consult_minutes?: number | null;
    specialty?: string | null;
    room?: string | null;
  } | null;
};

export async function GET(request: Request) {
  const tokenIdRaw = new URL(request.url).searchParams.get("tokenId");
  const parsedTokenId = tokenIdSchema.safeParse(tokenIdRaw);

  if (!parsedTokenId.success) {
    return NextResponse.json({ error: "Invalid token id." }, { status: 400 });
  }

  const supabase = getSupabaseServiceRoleClient();
  const { data: tokenData, error } = await supabase
    .from("tokens")
    .select(
      "id, clinic_id, doctor_id, token_number, date, status, checked_in_at, serving_started_at, completed_at, raw_complaint, patients(name, phone), doctors(id, name, avg_consult_minutes, specialty, room)"
    )
    .eq("id", parsedTokenId.data)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to load tracking status." },
      { status: 500 }
    );
  }

  if (!tokenData) {
    return NextResponse.json({ error: "Tracking token not found." }, { status: 404 });
  }

  const token = tokenData as TrackTokenRow;
  const { data: checkoutData, error: checkoutError } = await supabase
    .from("token_checkout")
    .select("checkout_stage, updated_at")
    .eq("token_id", token.id)
    .maybeSingle();

  if (checkoutError) {
    return NextResponse.json(
      { error: "Failed to load checkout status." },
      { status: 500 }
    );
  }

  const activeStates: TokenStatus[] = ["waiting", "serving"];
  const { data: activeQueue, error: activeQueueError } = await supabase
    .from("tokens")
    .select("id, token_number, status")
    .eq("clinic_id", token.clinic_id)
    .eq("doctor_id", token.doctor_id)
    .eq("date", token.date)
    .in("status", activeStates)
    .order("token_number", { ascending: true });

  if (activeQueueError) {
    return NextResponse.json(
      { error: "Failed to compute queue position." },
      { status: 500 }
    );
  }

  const activeQueueList =
    (activeQueue as Array<{ id: string; token_number: number; status: TokenStatus }> | null) ??
    [];
  const activeIndex = activeQueueList.findIndex((item) => item.id === token.id);
  const queueAhead =
    token.status === "waiting" && activeIndex >= 0 ? activeIndex : 0;
  const position =
    token.status === "waiting" && activeIndex >= 0 ? activeIndex + 1 : null;
  const avgConsultMinutes = Math.max(
    1,
    Number(token.doctors?.avg_consult_minutes ?? 8)
  );
  const estimatedWaitMinutes =
    token.status === "waiting" ? queueAhead * avgConsultMinutes : 0;

  return NextResponse.json({
    ok: true,
    tokenId: token.id,
    tokenNumber: token.token_number,
    status: token.status,
    checkedInAt: token.checked_in_at,
    servingStartedAt: token.serving_started_at,
    completedAt: token.completed_at,
    patientName: token.patients?.name ?? "Patient",
    patientPhone: token.patients?.phone ?? null,
    doctorName: token.doctors?.name ?? "Doctor",
    doctorSpecialty: token.doctors?.specialty ?? null,
    doctorRoom: token.doctors?.room ?? null,
    checkoutStage: (checkoutData as { checkout_stage?: CheckoutStage | null } | null)
      ?.checkout_stage ?? null,
    checkoutUpdatedAt: (
      checkoutData as { updated_at?: string | null } | null
    )?.updated_at ?? null,
    complaint: token.raw_complaint,
    queue: {
      position,
      ahead: queueAhead,
      activeCount: activeQueueList.length,
      estimatedWaitMinutes
    },
    now: new Date().toISOString()
  });
}
