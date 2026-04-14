import { randomInt } from "crypto";

import type { AppRole, InviteStatus } from "@/lib/utils/types";

const INVITE_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function generateInviteCode(length = 6) {
  let code = "";

  for (let index = 0; index < length; index += 1) {
    code += INVITE_CODE_ALPHABET[randomInt(0, INVITE_CODE_ALPHABET.length)];
  }

  return code;
}

export function getInviteDestination(role: Exclude<AppRole, "clinic_admin">) {
  return role === "doctor" ? "/doctor" : "/reception";
}

export function getInviteStatus(status: InviteStatus, expiresAt: string) {
  if (status !== "pending") {
    return status;
  }

  return new Date(expiresAt).getTime() > Date.now() ? "pending" : "expired";
}

export function getInviteFailureMessage(reason: string) {
  switch (reason) {
    case "accepted":
      return "This invite has already been used.";
    case "revoked":
      return "This invite was revoked by the clinic admin.";
    case "expired":
      return "This invite has expired. Please ask the clinic admin for a new one.";
    default:
      return "This invite code is invalid. Please verify it with your clinic admin.";
  }
}
