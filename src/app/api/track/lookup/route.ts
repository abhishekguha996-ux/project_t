import { NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { TokenStatus } from "@/lib/utils/types";

const lookupSchema = z.object({
  clinicId: z.string().uuid(),
  phone: z.string().trim().min(7).max(20),
  tokenCode: z.string().trim().min(1).max(20)
});

type TokenLookupRow = {
  id: string;
  token_number: number;
  checked_in_at: string;
  status: TokenStatus;
  patients: { name?: string | null; phone?: string | null } | null;
  doctors: { name?: string | null } | null;
};

function normalizePhone(value: string) {
  return value.replace(/[^\d+]/g, "").trim();
}

function parseTokenNumber(value: string) {
  const digits = value.replace(/[^\d]/g, "").trim();
  if (!digits) {
    return null;
  }

  const parsed = Number(digits);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function getLookupStartDate() {
  const now = new Date();
  now.setDate(now.getDate() - 7);
  return now.toISOString().slice(0, 10);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = lookupSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid token lookup payload." },
      { status: 400 }
    );
  }

  const tokenNumber = parseTokenNumber(parsed.data.tokenCode);

  if (!tokenNumber) {
    return NextResponse.json(
      { error: "Token code must include a valid token number." },
      { status: 400 }
    );
  }

  const normalizedPhone = normalizePhone(parsed.data.phone);
  const supabase = getSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from("tokens")
    .select("id, token_number, checked_in_at, status, patients!inner(name, phone), doctors(name)")
    .eq("clinic_id", parsed.data.clinicId)
    .eq("token_number", tokenNumber)
    .eq("patients.phone", normalizedPhone)
    .gte("date", getLookupStartDate())
    .order("checked_in_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: "Failed to search for that token." },
      { status: 500 }
    );
  }

  if (!data) {
    return NextResponse.json(
      { error: "No matching token found for that phone and code." },
      { status: 404 }
    );
  }

  const token = data as TokenLookupRow;
  return NextResponse.json({
    ok: true,
    tokenId: token.id,
    tokenNumber: token.token_number,
    status: token.status,
    checkedInAt: token.checked_in_at,
    patientName: token.patients?.name ?? "Patient",
    doctorName: token.doctors?.name ?? "Doctor",
    trackUrl: `/track/${token.id}`
  });
}
