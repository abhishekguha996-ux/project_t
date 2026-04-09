import { notFound, redirect } from "next/navigation";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import type { AppRole, CurrentClinicUser } from "@/lib/utils/types";

export async function requireClinicUser(
  redirectUrl = "/"
): Promise<CurrentClinicUser> {
  const user = await getCurrentClinicUser();

  if (!user) {
    redirect(
      `/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}` as never
    );
  }

  return user;
}

export async function requireRole(
  roles: AppRole[],
  redirectUrl = "/"
): Promise<CurrentClinicUser> {
  const user = await requireClinicUser(redirectUrl);

  if (!roles.includes(user.role)) {
    notFound();
  }

  return user;
}
