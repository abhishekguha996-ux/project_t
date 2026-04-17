import type { QueuePauseReason, TokenStatus } from "@/lib/utils/types";

const QUEUE_PAUSE_REASON_LABELS: Record<QueuePauseReason, string> = {
  personal_emergency: "Personal emergency",
  medical_emergency: "Medical emergency",
  other: "Other"
};

const TOKEN_STATUS_LABELS: Record<TokenStatus, string> = {
  waiting: "Waiting",
  serving: "In consultation",
  stepped_out: "Hold slot",
  complete: "Consultation done",
  skipped: "Skipped"
};

const QUEUE_EVENT_ACTION_LABELS: Record<string, string> = {
  start_consultation: "Start consultation",
  mark_consultation_done: "Consultation done",
  hold_slot: "Hold slot",
  return_to_waiting: "Move to waiting",
  skip: "Skip",
  hold_slot_expired: "Hold slot expired",
  "checkout:awaiting_payment": "Set checkout: Awaiting payment",
  "checkout:payment_done": "Set checkout: Payment done",
  "checkout:pharmacy_pickup": "Set checkout: Pharmacy pickup",
  "checkout:referred_for_lab": "Set checkout: Referred for lab",
  "checkout:visit_closed": "Set checkout: Visit closed"
};

function sentenceCaseFromSnake(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((segment, index) =>
      index === 0
        ? segment.charAt(0).toUpperCase() + segment.slice(1)
        : segment
    )
    .join(" ");
}

export function formatQueuePauseReason(reason: QueuePauseReason | string) {
  if (reason in QUEUE_PAUSE_REASON_LABELS) {
    return QUEUE_PAUSE_REASON_LABELS[reason as QueuePauseReason];
  }
  return sentenceCaseFromSnake(reason);
}

export function formatTokenStatusLabel(status: TokenStatus | string | null) {
  if (!status) {
    return "-";
  }
  if (status in TOKEN_STATUS_LABELS) {
    return TOKEN_STATUS_LABELS[status as TokenStatus];
  }
  return sentenceCaseFromSnake(status);
}

export function formatQueueEventAction(action: string | null) {
  if (!action) {
    return "-";
  }
  return QUEUE_EVENT_ACTION_LABELS[action] ?? action;
}
