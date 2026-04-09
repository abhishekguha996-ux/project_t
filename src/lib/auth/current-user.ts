import { auth, clerkClient, currentUser } from "@clerk/nextjs/server";

import { isAppRole } from "@/lib/auth/roles";
import type { CurrentClinicUser } from "@/lib/utils/types";

type ClerkMetadata = {
  clinic_id?: string;
  role?: string;
};

export async function getCurrentClinicUser(): Promise<CurrentClinicUser | null> {
  const session = await auth();

  if (!session.userId) {
    return null;
  }

  const user = await currentUser();

  if (!user) {
    return null;
  }

  const metadata = user.publicMetadata as ClerkMetadata;
  const fallbackMetadata = user.privateMetadata as ClerkMetadata;
  const clinicId = metadata.clinic_id ?? fallbackMetadata.clinic_id;
  const roleValue = metadata.role ?? fallbackMetadata.role;

  if (!clinicId || !roleValue || !isAppRole(roleValue)) {
    return null;
  }

  return {
    clerkUserId: session.userId,
    clinicId,
    role: roleValue,
    email: user.primaryEmailAddress?.emailAddress ?? null,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null
  };
}

export async function syncUserRoleMetadata(params: {
  userId: string;
  clinicId: string;
  role: "clinic_admin" | "receptionist" | "doctor";
}) {
  const client = await clerkClient();

  return client.users.updateUserMetadata(params.userId, {
    publicMetadata: {
      clinic_id: params.clinicId,
      role: params.role
    }
  });
}
