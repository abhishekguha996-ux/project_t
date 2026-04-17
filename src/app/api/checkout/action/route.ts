import { NextResponse } from "next/server";
import { z } from "zod";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getLinkedDoctorProfile } from "@/lib/doctor-access";
import {
  fetchTokenByClinic,
  setCheckoutStageForToken,
  type QueueActionActor
} from "@/lib/queue/status-actions";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { AppRole, CheckoutStage } from "@/lib/utils/types";

const checkoutActionSchema = z.object({
  tokenId: z.string().uuid(),
  action: z.enum([
    "awaiting_payment",
    "payment_done",
    "pharmacy_pickup",
    "referred_for_lab",
    "visit_closed"
  ]),
  notes: z.string().trim().min(1).max(500).optional()
});

function canMutateCheckout(role: AppRole) {
  return role === "clinic_admin" || role === "receptionist" || role === "doctor";
}

export async function POST(request: Request) {
  const user = await getCurrentClinicUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!canMutateCheckout(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const parsed = checkoutActionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid checkout action payload." }, { status: 400 });
  }

  const supabase = getSupabaseServiceRoleClient();
  const token = await fetchTokenByClinic({
    supabase,
    clinicId: user.clinicId,
    tokenId: parsed.data.tokenId
  });

  if (!token) {
    return NextResponse.json({ error: "Token not found." }, { status: 404 });
  }

  if (user.role === "doctor") {
    const linkedDoctor = await getLinkedDoctorProfile(user);
    if (!linkedDoctor) {
      return NextResponse.json(
        { error: "Doctor account is not linked to a doctor profile." },
        { status: 409 }
      );
    }
    if (token.doctor_id !== linkedDoctor.id) {
      return NextResponse.json(
        { error: "Doctor users can only update their own checkout items." },
        { status: 403 }
      );
    }
  }

  const actor: QueueActionActor = {
    clerkUserId: user.clerkUserId,
    role: user.role
  };
  const result = await setCheckoutStageForToken({
    supabase,
    token,
    stage: parsed.data.action as CheckoutStage,
    actor,
    notes: parsed.data.notes
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    token: result.token,
    checkout: result.checkout
  });
}
