import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getLinkedDoctorProfile } from "@/lib/doctor-access";
import { notifyPatientStatusUpdate } from "@/lib/notifications/patient-updates";
import {
  clearExpiredQueuePauses,
  completeQueueToken,
  expireOverdueHoldSlots,
  startQueueToken
} from "@/lib/queue/status-actions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";

const nextActionSchema = z.object({
  doctorId: z.string().uuid().optional()
});

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const user = await getCurrentClinicUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (
    user.role !== "doctor" &&
    user.role !== "clinic_admin" &&
    user.role !== "receptionist"
  ) {
    return NextResponse.json(
      { error: "Only clinic staff users can advance queue flow." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = nextActionSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid queue next payload." }, { status: 400 });
  }

  const linkedDoctor = user.role === "doctor" ? await getLinkedDoctorProfile(user) : null;
  const effectiveDoctorId =
    user.role === "doctor" ? linkedDoctor?.id ?? null : parsed.data.doctorId ?? null;

  if (!effectiveDoctorId) {
    return NextResponse.json(
      {
        error:
          user.role === "doctor"
            ? "Your account must be linked to a doctor profile."
            : "Doctor id is required."
      },
      { status: 400 }
    );
  }

  if (user.role === "doctor" && parsed.data.doctorId && parsed.data.doctorId !== effectiveDoctorId) {
    return NextResponse.json(
      { error: "You can only advance your linked doctor queue." },
      { status: 403 }
    );
  }

  const scope = {
    clinicId: user.clinicId,
    doctorId: effectiveDoctorId,
    date: getTodayDate()
  };
  const supabase = getSupabaseServiceRoleClient();
  const actor = {
    clerkUserId: user.clerkUserId,
    role: user.role
  };
  await clearExpiredQueuePauses({
    supabase,
    clinicId: user.clinicId,
    doctorId: scope.doctorId
  });
  await expireOverdueHoldSlots({
    supabase,
    clinicId: user.clinicId,
    doctorId: scope.doctorId,
    date: scope.date
  });
  const completed = await completeQueueToken({ supabase, scope, actor });

  if (!completed.ok && completed.status !== 409) {
    return NextResponse.json({ error: completed.error }, { status: completed.status });
  }

  const started = await startQueueToken({ supabase, scope, actor });

  if (!started.ok && started.status !== 409) {
    return NextResponse.json({ error: started.error }, { status: started.status });
  }

  if (!completed.ok && !started.ok) {
    return NextResponse.json(
      {
        error:
          "No serving or waiting token found. Queue is currently idle for this doctor."
      },
      { status: 409 }
    );
  }

  try {
    if (completed.ok) {
      await notifyPatientStatusUpdate({
        tokenId: completed.token.id,
        event: "consult_complete",
        supabase
      });
    }

    if (started.ok) {
      await notifyPatientStatusUpdate({
        tokenId: started.token.id,
        event: "your_turn",
        supabase
      });
    }
  } catch (error) {
    console.error(
      "[QCare] queue next notification failed:",
      error instanceof Error ? error.message : error
    );
  }

  return NextResponse.json({
    ok: true,
    doctorId: scope.doctorId,
    completedToken: completed.ok ? completed.token : null,
    nextServingToken: started.ok ? started.token : null
  });
}
