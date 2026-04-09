import type { AppRole } from "@/lib/utils/types";

export const APP_ROLES = ["clinic_admin", "receptionist", "doctor"] as const;

export function isAppRole(value: string): value is AppRole {
  return APP_ROLES.includes(value as AppRole);
}
