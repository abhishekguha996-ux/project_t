import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { CurrentClinicUser, Doctor } from "@/lib/utils/types";

export async function getLinkedDoctorProfile(
  user: CurrentClinicUser
): Promise<Doctor | null> {
  const supabase = getSupabaseServiceRoleClient();
  const { data } = await supabase
    .from("doctors")
    .select("*")
    .eq("clinic_id", user.clinicId)
    .eq("clerk_user_id", user.clerkUserId)
    .maybeSingle();

  return (data as Doctor | null) ?? null;
}
