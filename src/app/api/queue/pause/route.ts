import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getLinkedDoctorProfile } from "@/lib/doctor-access";
import { getServerEnv } from "@/lib/env/server";
import {
  pauseDoctorQueue,
  resumeDoctorQueue,
  type QueueActionActor
} from "@/lib/queue/status-actions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { AppRole, QueuePauseReason } from "@/lib/utils/types";

const pauseActionSchema = z.object({
  action: z.enum(["pause", "resume"]),
  doctorId: z.string().uuid().optional(),
  pauseMinutes: z.number().int().min(1).max(240).optional(),
  reason: z
    .enum(["personal_emergency", "medical_emergency", "other"])
    .optional(),
  note: z.string().trim().min(1).max(500).optional()
});

function canMutateQueue(role: AppRole) {
  return role === "clinic_admin" || role === "receptionist" || role === "doctor";
}

export async function POST(request: Request) {
  const user = await getCurrentClinicUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canMutateQueue(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = pauseActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid queue pause payload." }, { status: 400 });
  }

  const supabase = getSupabaseServiceRoleClient();
  const env = getServerEnv();
  const linkedDoctor = user.role === "doctor" ? await getLinkedDoctorProfile(user) : null;
  const effectiveDoctorId =
    user.role === "doctor" ? linkedDoctor?.id ?? null : parsed.data.doctorId ?? null;

  if (!effectiveDoctorId) {
    return NextResponse.json(
      {
        error:
          user.role === "doctor"
            ? "Doctor account is not linked to a doctor profile."
            : "Doctor id is required."
      },
      { status: 400 }
    );
  }

  if (user.role === "doctor" && parsed.data.doctorId && parsed.data.doctorId !== effectiveDoctorId) {
    return NextResponse.json(
      { error: "Doctor users can only pause their own queue." },
      { status: 403 }
    );
  }

  const actor: QueueActionActor = {
    clerkUserId: user.clerkUserId,
    role: user.role
  };

  const result =
    parsed.data.action === "pause"
      ? await pauseDoctorQueue({
          supabase,
          clinicId: user.clinicId,
          doctorId: effectiveDoctorId,
          pauseMinutes: parsed.data.pauseMinutes ?? env.QCARE_DEFAULT_DOCTOR_PAUSE_MINUTES,
          reason: (parsed.data.reason ?? "personal_emergency") as QueuePauseReason,
          note: parsed.data.note,
          actor
        })
      : await resumeDoctorQueue({
          supabase,
          clinicId: user.clinicId,
          doctorId: effectiveDoctorId,
          actor
        });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    doctorId: effectiveDoctorId,
    queuePaused: Boolean(result.pause),
    queuePause: result.pause,
    message: result.message ?? null
  });
}
