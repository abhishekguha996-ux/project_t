import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getLinkedDoctorProfile } from "@/lib/doctor-access";
import { getServerEnv } from "@/lib/env/server";
import { notifyPatientStatusUpdate } from "@/lib/notifications/patient-updates";
import {
  clearExpiredQueuePauses,
  completeQueueToken,
  expireOverdueHoldSlots,
  holdQueueToken,
  returnHeldTokenToWaiting,
  startQueueToken,
  transitionQueueToken,
  type QueueActionActor
} from "@/lib/queue/status-actions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/utils/types";

const queueActionSchema = z.object({
  action: z.enum([
    "start_consultation",
    "mark_consultation_done",
    "skip",
    "hold_slot",
    "return_to_waiting"
  ]),
  tokenId: z.string().uuid(),
  doctorId: z.string().uuid().optional(),
  holdMinutes: z.number().int().min(1).max(120).optional(),
  holdNote: z.string().trim().min(1).max(500).optional()
});

function canMutateQueue(role: AppRole) {
  return role === "clinic_admin" || role === "receptionist" || role === "doctor";
}

function getTodayDate() {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const user = await getCurrentClinicUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canMutateQueue(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = queueActionSchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid queue action payload." }, { status: 400 });
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
      { error: "Doctor users can only modify their own queue." },
      { status: 403 }
    );
  }

  const scope = {
    clinicId: user.clinicId,
    doctorId: effectiveDoctorId,
    date: getTodayDate()
  };
  const actor: QueueActionActor = {
    clerkUserId: user.clerkUserId,
    role: user.role
  };

  await clearExpiredQueuePauses({
    supabase,
    clinicId: user.clinicId,
    doctorId: effectiveDoctorId
  });
  await expireOverdueHoldSlots({
    supabase,
    clinicId: user.clinicId,
    doctorId: effectiveDoctorId,
    date: scope.date
  });

  let result:
    | Awaited<ReturnType<typeof startQueueToken>>
    | Awaited<ReturnType<typeof completeQueueToken>>
    | Awaited<ReturnType<typeof transitionQueueToken>>
    | Awaited<ReturnType<typeof holdQueueToken>>
    | Awaited<ReturnType<typeof returnHeldTokenToWaiting>>;

  if (parsed.data.action === "start_consultation") {
    result = await startQueueToken({
      supabase,
      scope,
      tokenId: parsed.data.tokenId,
      actor
    });
  } else if (parsed.data.action === "mark_consultation_done") {
    result = await completeQueueToken({
      supabase,
      scope,
      tokenId: parsed.data.tokenId,
      actor
    });
  } else if (parsed.data.action === "skip") {
    result = await transitionQueueToken({
      supabase,
      scope,
      tokenId: parsed.data.tokenId,
      targetStatus: "skipped",
      actor
    });
  } else if (parsed.data.action === "return_to_waiting") {
    result = await returnHeldTokenToWaiting({
      supabase,
      scope,
      tokenId: parsed.data.tokenId,
      actor
    });
  } else {
    const holdNote = parsed.data.holdNote?.trim() ?? "";
    if (user.role === "receptionist" && holdNote.length < 8) {
      return NextResponse.json(
        {
          error:
            "Hold slot requires receptionist note (minimum 8 characters)."
        },
        { status: 400 }
      );
    }

    result = await holdQueueToken({
      supabase,
      scope,
      tokenId: parsed.data.tokenId,
      holdMinutes: parsed.data.holdMinutes ?? env.QCARE_DEFAULT_HOLD_SLOT_MINUTES,
      holdNote:
        holdNote ||
        (user.role === "doctor"
          ? "Doctor marked Hold slot."
          : "Hold slot applied by clinic admin."),
      actor
    });
  }

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  try {
    if (parsed.data.action === "start_consultation") {
      await notifyPatientStatusUpdate({
        tokenId: result.token.id,
        event: "your_turn",
        supabase
      });
    } else if (parsed.data.action === "mark_consultation_done") {
      await notifyPatientStatusUpdate({
        tokenId: result.token.id,
        event: "consult_complete",
        supabase
      });
    } else if (parsed.data.action === "skip") {
      await notifyPatientStatusUpdate({
        tokenId: result.token.id,
        event: "skipped_noshow",
        supabase
      });
    } else if (parsed.data.action === "hold_slot") {
      await notifyPatientStatusUpdate({
        tokenId: result.token.id,
        event: "stepped_out_check",
        supabase
      });
    }
  } catch (error) {
    console.error(
      "[QCare] queue action notification failed:",
      error instanceof Error ? error.message : error
    );
  }

  return NextResponse.json({
    ok: true,
    doctorId: effectiveDoctorId,
    token: result.token,
    message: result.message ?? null
  });
}
