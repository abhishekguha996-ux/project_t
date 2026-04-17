import { notFound, redirect } from "next/navigation";

import { getLinkedDoctorProfile } from "@/lib/doctor-access";
import { getCurrentClinicUser } from "@/lib/auth/current-user";
import type { AppRole, CurrentClinicUser, Doctor } from "@/lib/utils/types";

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

export async function requireDoctorAccess(redirectUrl = "/doctor"): Promise<{
  user: CurrentClinicUser;
  doctor: Doctor;
}> {
  const user = await requireClinicUser(redirectUrl);

  if (user.role !== "doctor" && user.role !== "clinic_admin") {
    notFound();
  }

  const doctor = await getLinkedDoctorProfile(user);

  if (!doctor) {
    if (user.role === "clinic_admin") {
      redirect("/admin?doctor_profile=missing" as never);
    }
    notFound();
  }

  return { user, doctor };
}
