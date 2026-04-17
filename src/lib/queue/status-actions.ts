import type { SupabaseClient } from "@supabase/supabase-js";

import { getServerEnv } from "@/lib/env/server";
import type {
  AppRole,
  CheckoutStage,
  LabStatus,
  PaymentStatus,
  PharmacyStatus,
  QueuePauseReason,
  TokenStatus
} from "@/lib/utils/types";

export type QueueTokenRecord = {
  id: string;
  clinic_id: string;
  doctor_id: string;
  patient_id: string;
  token_number: number;
  date: string;
  status: TokenStatus;
  type: string;
  urgency: string;
  checkin_channel: string;
  checked_in_at: string;
  serving_started_at: string | null;
  completed_at: string | null;
  raw_complaint: string | null;
  consult_duration_seconds: number | null;
  hold_until: string | null;
  hold_note: string | null;
  hold_set_by_role: AppRole | null;
  hold_set_by_clerk_id: string | null;
  created_at: string;
};

export type TokenCheckoutRecord = {
  token_id: string;
  clinic_id: string;
  doctor_id: string;
  checkout_stage: CheckoutStage;
  payment_status: PaymentStatus;
  pharmacy_status: PharmacyStatus;
  lab_status: LabStatus;
  notes: string | null;
  closed_at: string | null;
  updated_at: string;
  created_at: string;
};

export type DoctorQueuePauseRecord = {
  id: string;
  clinic_id: string;
  doctor_id: string;
  reason: QueuePauseReason;
  note: string | null;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  created_by_clerk_id: string;
  created_by_role: AppRole;
  ended_at: string | null;
  ended_by_clerk_id: string | null;
  created_at: string;
};

export type QueueActionActor = {
  clerkUserId: string;
  role: AppRole;
};

type QueueScope = {
  clinicId: string;
  doctorId: string;
  date: string;
};

export type QueueMutationResult =
  | {
      ok: true;
      token: QueueTokenRecord;
      message?: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export type CheckoutMutationResult =
  | {
      ok: true;
      checkout: TokenCheckoutRecord;
      token: QueueTokenRecord;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

export type QueuePauseMutationResult =
  | {
      ok: true;
      pause: DoctorQueuePauseRecord | null;
      message?: string;
    }
  | {
      ok: false;
      status: number;
      error: string;
    };

function nowIso() {
  return new Date().toISOString();
}

function plusMinutesIso(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function calculateConsultDurationSeconds(startedAt: string | null) {
  if (!startedAt) {
    return null;
  }

  const startedAtTime = new Date(startedAt).getTime();
  if (Number.isNaN(startedAtTime)) {
    return null;
  }

  return Math.max(0, Math.floor((Date.now() - startedAtTime) / 1000));
}

async function logTokenEvent(params: {
  supabase: SupabaseClient;
  token: QueueTokenRecord;
  actor?: QueueActionActor | null;
  action: string;
  fromState: string | null;
  toState: string | null;
  metadata?: Record<string, unknown> | null;
}) {
  const { error } = await params.supabase.from("token_event_log").insert({
    token_id: params.token.id,
    clinic_id: params.token.clinic_id,
    doctor_id: params.token.doctor_id,
    actor_clerk_id: params.actor?.clerkUserId ?? null,
    actor_role: params.actor?.role ?? null,
    action: params.action,
    from_state: params.fromState,
    to_state: params.toState,
    metadata: params.metadata ?? null
  });

  if (error) {
    console.error("[QCare] Failed to write token event log:", error.message);
  }
}

export async function clearExpiredQueuePauses(params: {
  supabase: SupabaseClient;
  clinicId: string;
  doctorId?: string;
}) {
  const { supabase, clinicId, doctorId } = params;
  let query = supabase
    .from("doctor_queue_pauses")
    .update({
      is_active: false,
      ended_at: nowIso()
    })
    .eq("clinic_id", clinicId)
    .eq("is_active", true)
    .lte("ends_at", nowIso());

  if (doctorId) {
    query = query.eq("doctor_id", doctorId);
  }

  await query;
}

export async function getActiveQueuePause(params: {
  supabase: SupabaseClient;
  clinicId: string;
  doctorId: string;
}) {
  const { supabase, clinicId, doctorId } = params;
  const { data } = await supabase
    .from("doctor_queue_pauses")
    .select("*")
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId)
    .eq("is_active", true)
    .gt("ends_at", nowIso())
    .order("ends_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (data as DoctorQueuePauseRecord | null) ?? null;
}

async function assertQueueNotPaused(
  supabase: SupabaseClient,
  scope: QueueScope
): Promise<QueueMutationResult | null> {
  await clearExpiredQueuePauses({
    supabase,
    clinicId: scope.clinicId,
    doctorId: scope.doctorId
  });
  const activePause = await getActiveQueuePause({
    supabase,
    clinicId: scope.clinicId,
    doctorId: scope.doctorId
  });

  if (!activePause) {
    return null;
  }

  return {
    ok: false,
    status: 409,
    error: `Queue is paused until ${new Intl.DateTimeFormat("en-IN", {
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(activePause.ends_at))}.`
  };
}

async function fetchServingToken(
  supabase: SupabaseClient,
  scope: QueueScope
): Promise<QueueTokenRecord | null> {
  const { data } = await supabase
    .from("tokens")
    .select("*")
    .eq("clinic_id", scope.clinicId)
    .eq("doctor_id", scope.doctorId)
    .eq("date", scope.date)
    .eq("status", "serving")
    .order("token_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data as QueueTokenRecord | null) ?? null;
}

async function fetchTokenById(
  supabase: SupabaseClient,
  scope: QueueScope,
  tokenId: string
): Promise<QueueTokenRecord | null> {
  const { data } = await supabase
    .from("tokens")
    .select("*")
    .eq("id", tokenId)
    .eq("clinic_id", scope.clinicId)
    .eq("doctor_id", scope.doctorId)
    .eq("date", scope.date)
    .maybeSingle();

  return (data as QueueTokenRecord | null) ?? null;
}

export async function fetchTokenByClinic(params: {
  supabase: SupabaseClient;
  clinicId: string;
  tokenId: string;
}) {
  const { data } = await params.supabase
    .from("tokens")
    .select("*")
    .eq("id", params.tokenId)
    .eq("clinic_id", params.clinicId)
    .maybeSingle();

  return (data as QueueTokenRecord | null) ?? null;
}

async function fetchNextWaitingToken(
  supabase: SupabaseClient,
  scope: QueueScope
): Promise<QueueTokenRecord | null> {
  const { data } = await supabase
    .from("tokens")
    .select("*")
    .eq("clinic_id", scope.clinicId)
    .eq("doctor_id", scope.doctorId)
    .eq("date", scope.date)
    .eq("status", "waiting")
    .order("token_number", { ascending: true })
    .limit(1)
    .maybeSingle();

  return (data as QueueTokenRecord | null) ?? null;
}

async function ensureCheckoutRowForToken(params: {
  supabase: SupabaseClient;
  token: QueueTokenRecord;
}) {
  const { supabase, token } = params;
  const { data: existing } = await supabase
    .from("token_checkout")
    .select("*")
    .eq("token_id", token.id)
    .maybeSingle();

  if (existing) {
    return existing as TokenCheckoutRecord;
  }

  const { data } = await supabase
    .from("token_checkout")
    .insert({
      token_id: token.id,
      clinic_id: token.clinic_id,
      doctor_id: token.doctor_id,
      checkout_stage: "awaiting_payment",
      payment_status: "pending",
      pharmacy_status: "pending",
      lab_status: "pending",
      updated_at: nowIso()
    })
    .select("*")
    .single();

  return data as TokenCheckoutRecord;
}

export async function expireOverdueHoldSlots(params: {
  supabase: SupabaseClient;
  clinicId: string;
  date: string;
  doctorId?: string;
}) {
  const { supabase, clinicId, doctorId, date } = params;

  let query = supabase
    .from("tokens")
    .update({
      status: "skipped",
      hold_until: null,
      hold_note: null,
      hold_set_by_role: null,
      hold_set_by_clerk_id: null
    })
    .eq("clinic_id", clinicId)
    .eq("date", date)
    .eq("status", "stepped_out")
    .lte("hold_until", nowIso())
    .select("*");

  if (doctorId) {
    query = query.eq("doctor_id", doctorId);
  }

  const { data } = await query;
  const expired = (data as QueueTokenRecord[] | null) ?? [];

  for (const token of expired) {
    await logTokenEvent({
      supabase,
      token,
      actor: null,
      action: "hold_slot_expired",
      fromState: "stepped_out",
      toState: "skipped",
      metadata: { reason: "hold_window_expired" }
    });
  }

  return expired;
}

export async function startQueueToken(params: {
  supabase: SupabaseClient;
  scope: QueueScope;
  tokenId?: string;
  actor?: QueueActionActor;
}): Promise<QueueMutationResult> {
  const { supabase, scope, tokenId, actor } = params;
  const pauseError = await assertQueueNotPaused(supabase, scope);
  if (pauseError) {
    return pauseError;
  }

  const currentServing = await fetchServingToken(supabase, scope);

  if (currentServing) {
    return {
      ok: false,
      status: 409,
      error: `Token #${currentServing.token_number} is already in consultation.`
    };
  }

  let targetToken: QueueTokenRecord | null = null;

  if (tokenId) {
    targetToken = await fetchTokenById(supabase, scope, tokenId);
    if (!targetToken) {
      return { ok: false, status: 404, error: "Token not found for this queue." };
    }
    if (targetToken.status !== "waiting") {
      return {
        ok: false,
        status: 409,
        error: "Only waiting tokens can start consultation."
      };
    }
  } else {
    targetToken = await fetchNextWaitingToken(supabase, scope);
    if (!targetToken) {
      return { ok: false, status: 409, error: "No waiting tokens available." };
    }
  }

  const { data, error } = await supabase
    .from("tokens")
    .update({
      status: "serving",
      serving_started_at: nowIso(),
      hold_until: null,
      hold_note: null,
      hold_set_by_role: null,
      hold_set_by_clerk_id: null
    })
    .eq("id", targetToken.id)
    .eq("clinic_id", scope.clinicId)
    .eq("doctor_id", scope.doctorId)
    .eq("date", scope.date)
    .eq("status", "waiting")
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      status: 500,
      error: "Could not start consultation for the selected token."
    };
  }

  const nextToken = data as QueueTokenRecord;
  await logTokenEvent({
    supabase,
    token: nextToken,
    actor,
    action: "start_consultation",
    fromState: targetToken.status,
    toState: nextToken.status
  });

  return { ok: true, token: nextToken };
}

export async function completeQueueToken(params: {
  supabase: SupabaseClient;
  scope: QueueScope;
  tokenId?: string;
  actor?: QueueActionActor;
}): Promise<QueueMutationResult> {
  const { supabase, scope, tokenId, actor } = params;
  let targetToken: QueueTokenRecord | null = null;

  if (tokenId) {
    targetToken = await fetchTokenById(supabase, scope, tokenId);
    if (!targetToken) {
      return { ok: false, status: 404, error: "Token not found for this queue." };
    }
    if (targetToken.status !== "serving") {
      return {
        ok: false,
        status: 409,
        error: "Only an in-consultation token can be marked done."
      };
    }
  } else {
    targetToken = await fetchServingToken(supabase, scope);
    if (!targetToken) {
      return { ok: false, status: 409, error: "No token is currently in consultation." };
    }
  }

  const consultDuration = calculateConsultDurationSeconds(
    targetToken.serving_started_at
  );

  const { data, error } = await supabase
    .from("tokens")
    .update({
      status: "complete",
      completed_at: nowIso(),
      consult_duration_seconds: consultDuration
    })
    .eq("id", targetToken.id)
    .eq("clinic_id", scope.clinicId)
    .eq("doctor_id", scope.doctorId)
    .eq("date", scope.date)
    .eq("status", "serving")
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      status: 500,
      error: "Could not mark consultation done."
    };
  }

  const completedToken = data as QueueTokenRecord;
  const existingCheckout = await ensureCheckoutRowForToken({
    supabase,
    token: completedToken
  });

  if (existingCheckout.checkout_stage === "visit_closed") {
    const { data: reopenedCheckout } = await supabase
      .from("token_checkout")
      .update({
        checkout_stage: "awaiting_payment",
        closed_at: null,
        updated_at: nowIso()
      })
      .eq("token_id", completedToken.id)
      .select("*")
      .single();

    if (reopenedCheckout) {
      void reopenedCheckout;
    }
  }

  await logTokenEvent({
    supabase,
    token: completedToken,
    actor,
    action: "mark_consultation_done",
    fromState: targetToken.status,
    toState: completedToken.status
  });

  return { ok: true, token: completedToken };
}

export async function holdQueueToken(params: {
  supabase: SupabaseClient;
  scope: QueueScope;
  tokenId: string;
  holdMinutes: number;
  holdNote: string;
  actor: QueueActionActor;
}): Promise<QueueMutationResult> {
  const { supabase, scope, tokenId, holdMinutes, holdNote, actor } = params;
  const token = await fetchTokenById(supabase, scope, tokenId);

  if (!token) {
    return { ok: false, status: 404, error: "Token not found for this queue." };
  }

  if (token.status !== "waiting" && token.status !== "serving") {
    return {
      ok: false,
      status: 409,
      error: `Token is currently ${token.status} and cannot be moved to Hold slot.`
    };
  }

  const { data, error } = await supabase
    .from("tokens")
    .update({
      status: "stepped_out",
      hold_until: plusMinutesIso(Math.max(1, holdMinutes)),
      hold_note: holdNote.trim(),
      hold_set_by_role: actor.role,
      hold_set_by_clerk_id: actor.clerkUserId,
      serving_started_at: token.status === "serving" ? null : token.serving_started_at
    })
    .eq("id", token.id)
    .eq("clinic_id", scope.clinicId)
    .eq("doctor_id", scope.doctorId)
    .eq("date", scope.date)
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      status: 500,
      error: "Could not place token on Hold slot."
    };
  }

  const heldToken = data as QueueTokenRecord;
  await logTokenEvent({
    supabase,
    token: heldToken,
    actor,
    action: "hold_slot",
    fromState: token.status,
    toState: heldToken.status,
    metadata: {
      hold_minutes: holdMinutes,
      hold_note: holdNote.trim()
    }
  });

  return { ok: true, token: heldToken };
}

export async function returnHeldTokenToWaiting(params: {
  supabase: SupabaseClient;
  scope: QueueScope;
  tokenId: string;
  actor: QueueActionActor;
}): Promise<QueueMutationResult> {
  const { supabase, scope, tokenId, actor } = params;
  const token = await fetchTokenById(supabase, scope, tokenId);

  if (!token) {
    return { ok: false, status: 404, error: "Token not found for this queue." };
  }

  if (token.status !== "stepped_out" && token.status !== "skipped") {
    return {
      ok: false,
      status: 409,
      error: "Only Hold slot or skipped tokens can move to waiting."
    };
  }

  const { data, error } = await supabase
    .from("tokens")
    .update({
      status: "waiting",
      hold_until: null,
      hold_note: null,
      hold_set_by_role: null,
      hold_set_by_clerk_id: null
    })
    .eq("id", token.id)
    .eq("clinic_id", scope.clinicId)
    .eq("doctor_id", scope.doctorId)
    .eq("date", scope.date)
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      status: 500,
      error: "Could not return token to waiting."
    };
  }

  const waitingToken = data as QueueTokenRecord;
  await logTokenEvent({
    supabase,
    token: waitingToken,
    actor,
    action: "return_to_waiting",
    fromState: token.status,
    toState: waitingToken.status
  });

  return { ok: true, token: waitingToken };
}

export async function transitionQueueToken(params: {
  supabase: SupabaseClient;
  scope: QueueScope;
  tokenId: string;
  targetStatus: "skipped" | "stepped_out";
  actor?: QueueActionActor;
}): Promise<QueueMutationResult> {
  const { supabase, scope, tokenId, targetStatus, actor } = params;
  const token = await fetchTokenById(supabase, scope, tokenId);

  if (!token) {
    return { ok: false, status: 404, error: "Token not found for this queue." };
  }

  if (token.status === "complete") {
    return {
      ok: false,
      status: 409,
      error: "Consultation-done tokens cannot be changed from this action."
    };
  }

  if (token.status === targetStatus) {
    return { ok: true, token, message: "Token is already in this state." };
  }

  const canSkipFromSteppedOut =
    targetStatus === "skipped" && token.status === "stepped_out";
  if (token.status !== "waiting" && token.status !== "serving" && !canSkipFromSteppedOut) {
    return {
      ok: false,
      status: 409,
      error: `Token is currently ${token.status} and cannot transition to ${targetStatus}.`
    };
  }

  const updatePayload: Record<string, unknown> = {
    status: targetStatus
  };
  if (targetStatus === "stepped_out") {
    const env = getServerEnv();
    updatePayload.hold_until = plusMinutesIso(env.QCARE_DEFAULT_HOLD_SLOT_MINUTES);
    updatePayload.hold_note =
      actor?.role === "doctor"
        ? "Doctor set Hold slot from doctor workflow."
        : "Hold slot applied.";
    updatePayload.hold_set_by_role = actor?.role ?? null;
    updatePayload.hold_set_by_clerk_id = actor?.clerkUserId ?? null;
    if (token.status === "serving") {
      updatePayload.serving_started_at = null;
    }
  } else {
    updatePayload.hold_until = null;
    updatePayload.hold_note = null;
    updatePayload.hold_set_by_role = null;
    updatePayload.hold_set_by_clerk_id = null;
  }

  const { data, error } = await supabase
    .from("tokens")
    .update(updatePayload)
    .eq("id", token.id)
    .eq("clinic_id", scope.clinicId)
    .eq("doctor_id", scope.doctorId)
    .eq("date", scope.date)
    .select("*")
    .maybeSingle();

  if (error || !data) {
    return {
      ok: false,
      status: 500,
      error: "Could not update token status."
    };
  }

  const nextToken = data as QueueTokenRecord;
  await logTokenEvent({
    supabase,
    token: nextToken,
    actor,
    action: targetStatus === "skipped" ? "skip" : "hold_slot",
    fromState: token.status,
    toState: nextToken.status
  });

  return { ok: true, token: nextToken };
}

export async function pauseDoctorQueue(params: {
  supabase: SupabaseClient;
  clinicId: string;
  doctorId: string;
  pauseMinutes: number;
  reason: QueuePauseReason;
  note?: string;
  actor: QueueActionActor;
}): Promise<QueuePauseMutationResult> {
  const { supabase, clinicId, doctorId, reason, note, actor } = params;
  const pauseMinutes = Math.max(1, params.pauseMinutes);
  await clearExpiredQueuePauses({ supabase, clinicId, doctorId });
  const activePause = await getActiveQueuePause({ supabase, clinicId, doctorId });

  if (activePause) {
    const { data, error } = await supabase
      .from("doctor_queue_pauses")
      .update({
        reason,
        note: note?.trim() || null,
        ends_at: plusMinutesIso(pauseMinutes),
        is_active: true
      })
      .eq("id", activePause.id)
      .select("*")
      .single();

    if (error || !data) {
      return { ok: false, status: 500, error: "Could not update doctor pause." };
    }

    return {
      ok: true,
      pause: data as DoctorQueuePauseRecord,
      message: "Queue pause updated."
    };
  }

  const { data, error } = await supabase
    .from("doctor_queue_pauses")
    .insert({
      clinic_id: clinicId,
      doctor_id: doctorId,
      reason,
      note: note?.trim() || null,
      starts_at: nowIso(),
      ends_at: plusMinutesIso(pauseMinutes),
      is_active: true,
      created_by_clerk_id: actor.clerkUserId,
      created_by_role: actor.role
    })
    .select("*")
    .single();

  if (error || !data) {
    return { ok: false, status: 500, error: "Could not pause doctor queue." };
  }

  return { ok: true, pause: data as DoctorQueuePauseRecord };
}

export async function resumeDoctorQueue(params: {
  supabase: SupabaseClient;
  clinicId: string;
  doctorId: string;
  actor: QueueActionActor;
}): Promise<QueuePauseMutationResult> {
  const { supabase, clinicId, doctorId, actor } = params;
  const { data, error } = await supabase
    .from("doctor_queue_pauses")
    .update({
      is_active: false,
      ended_at: nowIso(),
      ended_by_clerk_id: actor.clerkUserId
    })
    .eq("clinic_id", clinicId)
    .eq("doctor_id", doctorId)
    .eq("is_active", true)
    .select("*");

  if (error) {
    return { ok: false, status: 500, error: "Could not resume doctor queue." };
  }

  if (!data || data.length === 0) {
    return {
      ok: false,
      status: 409,
      error: "Queue is not paused for this doctor."
    };
  }

  return { ok: true, pause: null, message: "Queue resumed." };
}

export async function setCheckoutStageForToken(params: {
  supabase: SupabaseClient;
  token: QueueTokenRecord;
  stage: CheckoutStage;
  actor: QueueActionActor;
  notes?: string;
}): Promise<CheckoutMutationResult> {
  const { supabase, token, stage, actor, notes } = params;

  if (token.status !== "complete") {
    return {
      ok: false,
      status: 409,
      error: "Checkout states can only be updated after consultation is done."
    };
  }

  const existing = await ensureCheckoutRowForToken({ supabase, token });
  const update: Partial<TokenCheckoutRecord> & { updated_at: string } = {
    checkout_stage: stage,
    updated_at: nowIso()
  };

  if (stage === "awaiting_payment") {
    update.payment_status = "pending";
  }
  if (stage === "payment_done") {
    update.payment_status = "done";
  }
  if (stage === "pharmacy_pickup") {
    update.pharmacy_status = "picked_up";
  }
  if (stage === "referred_for_lab") {
    update.lab_status = "referred";
  }
  if (stage === "visit_closed") {
    update.closed_at = nowIso();
  } else {
    update.closed_at = null;
  }
  if (notes && notes.trim()) {
    update.notes = notes.trim();
  }

  const { data, error } = await supabase
    .from("token_checkout")
    .update(update)
    .eq("token_id", token.id)
    .select("*")
    .single();

  if (error || !data) {
    return {
      ok: false,
      status: 500,
      error: "Could not update checkout stage."
    };
  }

  const checkout = data as TokenCheckoutRecord;
  await logTokenEvent({
    supabase,
    token,
    actor,
    action: `checkout:${stage}`,
    fromState: existing.checkout_stage,
    toState: checkout.checkout_stage,
    metadata: {
      payment_status: checkout.payment_status,
      pharmacy_status: checkout.pharmacy_status,
      lab_status: checkout.lab_status,
      notes: notes?.trim() || null
    }
  });

  return { ok: true, checkout, token };
}
