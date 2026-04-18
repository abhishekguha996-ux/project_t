import { NextResponse } from "next/server";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/utils/types";

/**
 * Co-pilot Q&A — natural-language to structured answer.
 *
 * V1 is a deterministic NLU-lite: regex intent classification + entity extraction + DB lookup.
 * V2 will swap the classifier for Claude tool-use; the endpoint contract is stable.
 */

type AnswerAction = {
  label: string;
  href?: string;
  kind: "link" | "call" | "checkin";
};

type AnswerPatient = {
  id: string;
  name: string;
  phone: string;
  age: number | null;
  gender: "male" | "female" | "other" | null;
  language_preference: string | null;
  allergies: string[];
  created_at: string | null;
  totalVisits: number;
  todayTokenId: string | null;
  todayTokenNumber: number | null;
  todayStatus: string | null;
  todayDoctor: string | null;
};

function canAccess(role: AppRole) {
  return role === "clinic_admin" || role === "receptionist" || role === "doctor";
}

/* ------------ NLU-lite ------------ */

type Intent =
  | "is_returning"
  | "is_new"
  | "ask_phone"
  | "ask_age"
  | "ask_gender"
  | "ask_language"
  | "ask_allergies"
  | "ask_blood_group"
  | "ask_today_status"
  | "ask_doctor"
  | "ask_payment"
  | "ask_last_visit"
  | "ask_last_complaint"
  | "ask_visit_count"
  | "ask_queue_next"
  | "ask_doctors_on"
  | "unknown";

const STOP_TOKENS = new Set([
  "is", "are", "was", "were", "be", "am",
  "a", "an", "the", "of", "for", "to", "with",
  "has", "have", "had", "does", "did", "do",
  "on", "about", "please", "can", "you",
  "tell", "me", "show", "say", "give", "check",
  "what", "whats", "what's", "who", "whos", "who's",
  "which", "when", "where", "how", "why",
  "currently", "now", "today", "s"
]);

const ATTR_TOKENS = new Set([
  "patient", "patients",
  "returning", "new", "first", "time", "repeat", "return",
  "phone", "number", "contact", "mobile", "cell",
  "age", "old", "years", "year",
  "gender", "male", "female", "sex",
  "language", "speak", "speaks", "prefer", "prefers", "preferred",
  "allergy", "allergies", "allergic",
  "blood", "group", "bloodgroup", "bloodtype",
  "visit", "visits", "visited", "visiting",
  "last", "previous", "recent", "lastvisit",
  "checkin", "check-in", "checked", "in", "queue", "waiting",
  "doctor", "dr", "drs", "doctors",
  "consulting", "seeing", "attending",
  "payment", "paid", "pay", "bill", "billed", "billing",
  "complaint", "complaints", "symptom", "symptoms",
  "many", "total", "count", "number",
  "next", "up",
  "today", "todays", "today's",
  "room"
]);

function normalize(q: string) {
  return q
    .toLowerCase()
    .replace(/[?,.;:!'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function classifyIntent(raw: string): Intent {
  const q = normalize(raw);
  if (/\bblood\s*(group|type)\b|\bbg\b/.test(q)) return "ask_blood_group";
  if (/\breturning\b|\brepeat\b|\breturn\s+patient\b/.test(q)) return "is_returning";
  if (/\bnew\s+patient\b|\bfirst\s+time\b|\bfirst\s+visit\b/.test(q)) return "is_new";
  if (/\bphone\b|\bnumber\b|\bcontact\b|\bmobile\b|\bcell\b/.test(q)) return "ask_phone";
  if (/\bage\b|\bhow\s+old\b|\byears?\s+old\b/.test(q)) return "ask_age";
  if (/\bgender\b|\bmale\b|\bfemale\b|\bsex\b/.test(q)) return "ask_gender";
  if (/\blanguage\b|\bspeaks?\b|\bprefers?\b/.test(q)) return "ask_language";
  if (/\ballerg/.test(q)) return "ask_allergies";
  if (/\bpayment\b|\bpaid\b|\bbill/.test(q)) return "ask_payment";
  if (/\blast\s+complaint\b|\bprevious\s+complaint\b|\blast\s+symptom\b/.test(q))
    return "ask_last_complaint";
  if (/\blast\s+visit\b|\bprevious\s+visit\b|\bwhen\s+did\b.*\bvisit\b/.test(q))
    return "ask_last_visit";
  if (/\btotal\s+visits\b|\bhow\s+many\s+visits\b|\bvisit\s+count\b/.test(q))
    return "ask_visit_count";
  if (/\bwho'?s?\s+next\b|\bnext\s+patient\b|\bnext\s+up\b/.test(q)) return "ask_queue_next";
  if (/\b(which|what)\s+doctors?\b|\bdoctors\s+on\b|\bdoctors\s+today\b/.test(q))
    return "ask_doctors_on";
  if (/\b(which|what)\s+doctor\b|\bwith\s+doctor\b|\bconsulting\s+with\b|\bseeing\b/.test(q))
    return "ask_doctor";
  if (/\b(check\s*in|checked\s*in|in\s+(the\s+)?queue|in\s+waiting|today'?s?\s+status)\b/.test(q))
    return "ask_today_status";
  return "unknown";
}

function extractEntity(raw: string): { phone: string | null; nameQuery: string | null } {
  const q = normalize(raw);
  const digits = q.replace(/[^\d]/g, "");
  const phone = digits.length >= 7 ? digits : null;

  const tokens = q
    .split(/\s+/)
    .filter((t) => t && !STOP_TOKENS.has(t) && !ATTR_TOKENS.has(t) && !/^\d+$/.test(t));
  const nameQuery = tokens.length > 0 ? tokens.join(" ").trim() : null;
  return { phone, nameQuery };
}

/* ------------ DB helpers ------------ */

async function findPatient(
  supabase: ReturnType<typeof getSupabaseServiceRoleClient>,
  clinicId: string,
  phone: string | null,
  nameQuery: string | null
): Promise<AnswerPatient | null> {
  let q = supabase
    .from("patients")
    .select("id, name, phone, age, gender, language_preference, allergies, created_at")
    .eq("clinic_id", clinicId)
    .limit(1);

  if (phone) {
    q = q.ilike("phone", `%${phone}%`);
  } else if (nameQuery) {
    q = q.ilike("name", `%${nameQuery}%`);
  } else {
    return null;
  }

  const { data } = await q;
  const row = ((data as Array<{
    id: string;
    name: string;
    phone: string;
    age: number | null;
    gender: "male" | "female" | "other" | null;
    language_preference: string | null;
    allergies: string[] | null;
    created_at: string | null;
  }> | null) ?? [])[0];
  if (!row) return null;

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: todayTokens }, { data: allVisits }] = await Promise.all([
    supabase
      .from("tokens")
      .select("id, token_number, status, doctor_id, doctors(name)")
      .eq("clinic_id", clinicId)
      .eq("patient_id", row.id)
      .eq("date", today)
      .limit(1),
    supabase
      .from("tokens")
      .select("id", { count: "exact", head: false })
      .eq("clinic_id", clinicId)
      .eq("patient_id", row.id)
  ]);

  const todayT = ((todayTokens as unknown) as
    | Array<{
        id: string;
        token_number: number;
        status: string;
        doctor_id: string;
        doctors: { name?: string | null } | Array<{ name?: string | null }> | null;
      }>
    | null) ?? [];
  const t = todayT[0];
  const doctor = t ? (Array.isArray(t.doctors) ? t.doctors[0] : t.doctors) : null;

  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    age: row.age,
    gender: row.gender,
    language_preference: row.language_preference,
    allergies: row.allergies ?? [],
    created_at: row.created_at,
    totalVisits: allVisits?.length ?? 0,
    todayTokenId: t?.id ?? null,
    todayTokenNumber: t?.token_number ?? null,
    todayStatus: t?.status ?? null,
    todayDoctor: doctor?.name ?? null
  };
}

async function findLastToken(
  supabase: ReturnType<typeof getSupabaseServiceRoleClient>,
  clinicId: string,
  patientId: string
) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("tokens")
    .select("id, token_number, date, raw_complaint, doctors(name)")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .lt("date", today)
    .order("date", { ascending: false })
    .limit(1);

  const row = ((data as unknown) as
    | Array<{
        id: string;
        token_number: number;
        date: string;
        raw_complaint: string | null;
        doctors: { name?: string | null } | Array<{ name?: string | null }> | null;
      }>
    | null) ?? [];
  if (row.length === 0) return null;
  const doctor = Array.isArray(row[0].doctors) ? row[0].doctors[0] : row[0].doctors;
  return {
    id: row[0].id,
    token_number: row[0].token_number,
    date: row[0].date,
    raw_complaint: row[0].raw_complaint,
    doctor: doctor?.name ?? null
  };
}

async function findPaymentForToday(
  supabase: ReturnType<typeof getSupabaseServiceRoleClient>,
  clinicId: string,
  patientId: string
) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: tokens } = await supabase
    .from("tokens")
    .select("id, status")
    .eq("clinic_id", clinicId)
    .eq("patient_id", patientId)
    .eq("date", today);

  const ids = ((tokens as Array<{ id: string; status: string }> | null) ?? []).map((t) => t.id);
  if (ids.length === 0) return null;

  const { data: checkouts } = await supabase
    .from("token_checkout")
    .select("token_id, checkout_stage, payment_status")
    .in("token_id", ids);
  const row = ((checkouts as Array<{
    token_id: string;
    checkout_stage: string;
    payment_status: string;
  }> | null) ?? [])[0];
  return row ?? null;
}

function isSameDate(iso: string, d: Date) {
  const x = new Date(iso);
  return (
    x.getUTCFullYear() === d.getUTCFullYear() &&
    x.getUTCMonth() === d.getUTCMonth() &&
    x.getUTCDate() === d.getUTCDate()
  );
}

function fmtDate(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(iso));
}

function langFull(c?: string | null) {
  const m: Record<string, string> = {
    en: "English",
    hi: "Hindi",
    ta: "Tamil",
    te: "Telugu",
    kn: "Kannada",
    ml: "Malayalam"
  };
  return m[(c ?? "").toLowerCase()] ?? (c ?? "unknown");
}

function defaultActions(p: AnswerPatient): AnswerAction[] {
  const a: AnswerAction[] = [];
  if (p.phone) a.push({ label: `Call ${p.phone}`, href: `tel:${p.phone}`, kind: "call" });
  if (p.todayTokenId) {
    a.push({ label: "View tracking", href: `/track/${p.todayTokenId}`, kind: "link" });
  } else {
    a.push({ label: "Check in", kind: "checkin" });
  }
  return a;
}

/* ------------ route ------------ */

export async function POST(request: Request) {
  const user = await getCurrentClinicUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccess(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { question?: string } | null;
  const question = (body?.question ?? "").trim();
  if (question.length < 2) {
    return NextResponse.json({
      ok: true,
      answer: "Ask me something — e.g. \"Is Swaminathan a returning patient?\"",
      patient: null,
      actions: []
    });
  }

  const supabase = getSupabaseServiceRoleClient();
  const intent = classifyIntent(question);
  const { phone, nameQuery } = extractEntity(question);

  /* ---- clinic-scope intents (no entity needed) ---- */
  if (intent === "ask_queue_next") {
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await supabase
      .from("tokens")
      .select("id, token_number, patient_id, patients(name), doctors(name)")
      .eq("clinic_id", user.clinicId)
      .eq("date", today)
      .eq("status", "waiting")
      .order("token_number", { ascending: true })
      .limit(1);
    const row = ((data as unknown) as
      | Array<{
          id: string;
          token_number: number;
          patients: { name?: string | null } | Array<{ name?: string | null }> | null;
          doctors: { name?: string | null } | Array<{ name?: string | null }> | null;
        }>
      | null) ?? [];
    if (row.length === 0) {
      return NextResponse.json({
        ok: true,
        answer: "Nobody is waiting right now across any doctor.",
        patient: null,
        actions: []
      });
    }
    const p = Array.isArray(row[0].patients) ? row[0].patients[0] : row[0].patients;
    const d = Array.isArray(row[0].doctors) ? row[0].doctors[0] : row[0].doctors;
    return NextResponse.json({
      ok: true,
      answer: `Next is #${row[0].token_number} ${p?.name ?? "Patient"} for ${d?.name ?? "a doctor"}.`,
      patient: null,
      actions: [
        { label: "View tracking", href: `/track/${row[0].id}`, kind: "link" }
      ]
    });
  }

  if (intent === "ask_doctors_on") {
    const { data } = await supabase
      .from("doctors")
      .select("name, specialty, room, status")
      .eq("clinic_id", user.clinicId)
      .neq("status", "offline")
      .order("name", { ascending: true });
    const rows = (data as Array<{
      name: string;
      specialty: string | null;
      room: string | null;
      status: string;
    }> | null) ?? [];
    if (rows.length === 0) {
      return NextResponse.json({
        ok: true,
        answer: "No active doctors today.",
        patient: null,
        actions: []
      });
    }
    const listed = rows
      .map((r) => `${r.name}${r.specialty ? ` · ${r.specialty}` : ""}${r.room ? ` · ${r.room}` : ""}`)
      .join("; ");
    return NextResponse.json({
      ok: true,
      answer: `On today: ${listed}.`,
      patient: null,
      actions: []
    });
  }

  /* ---- entity-scoped intents ---- */
  const patient = await findPatient(supabase, user.clinicId, phone, nameQuery);

  if (!patient) {
    return NextResponse.json({
      ok: true,
      answer:
        nameQuery || phone
          ? `I couldn't find a patient matching "${nameQuery ?? phone}". Try a full name or phone number.`
          : "I couldn't tell which patient you meant. Try including a name or phone.",
      patient: null,
      actions: []
    });
  }

  const now = new Date();
  const isFirstVisit = patient.created_at ? isSameDate(patient.created_at, now) : false;

  let answer = "";
  switch (intent) {
    case "is_returning":
      answer = isFirstVisit
        ? `No — ${patient.name} is a new patient today. First record created ${fmtDate(patient.created_at)}.`
        : `Yes — ${patient.name} is returning. First seen ${fmtDate(patient.created_at)}, ${patient.totalVisits} total visit${patient.totalVisits === 1 ? "" : "s"}.`;
      break;
    case "is_new":
      answer = isFirstVisit
        ? `Yes — ${patient.name} is new. First record created ${fmtDate(patient.created_at)}.`
        : `No — ${patient.name} has visited before. First seen ${fmtDate(patient.created_at)}, ${patient.totalVisits} total visit${patient.totalVisits === 1 ? "" : "s"}.`;
      break;
    case "ask_phone":
      answer = `${patient.name}'s phone is ${patient.phone}.`;
      break;
    case "ask_age":
      answer = patient.age
        ? `${patient.name} is ${patient.age} years old.`
        : `Age isn't recorded for ${patient.name}.`;
      break;
    case "ask_gender":
      answer = patient.gender
        ? `${patient.name}'s gender on file is ${patient.gender}.`
        : `Gender isn't recorded for ${patient.name}.`;
      break;
    case "ask_language":
      answer = `${patient.name} prefers ${langFull(patient.language_preference)}.`;
      break;
    case "ask_allergies":
      answer = patient.allergies.length > 0
        ? `${patient.name}'s recorded allergies: ${patient.allergies.join(", ")}.`
        : `No allergies recorded for ${patient.name}.`;
      break;
    case "ask_blood_group":
      answer = `Blood group isn't captured at QR check-in yet — we only collect name, phone, age, gender, language, allergies, and the complaint. Add it to check-in if you want it queryable.`;
      break;
    case "ask_today_status": {
      if (patient.todayStatus) {
        answer = `Yes — ${patient.name} is token #${patient.todayTokenNumber}, currently ${patient.todayStatus}${patient.todayDoctor ? ` with ${patient.todayDoctor}` : ""}.`;
      } else {
        answer = `${patient.name} hasn't checked in today.`;
      }
      break;
    }
    case "ask_doctor": {
      if (patient.todayDoctor) {
        answer = `${patient.name} is with ${patient.todayDoctor} today (token #${patient.todayTokenNumber}, ${patient.todayStatus}).`;
      } else {
        answer = `${patient.name} isn't assigned to a doctor today — no token yet.`;
      }
      break;
    }
    case "ask_payment": {
      const co = await findPaymentForToday(supabase, user.clinicId, patient.id);
      if (!co) {
        answer = patient.todayStatus
          ? `${patient.name} hasn't reached checkout yet today — current state is ${patient.todayStatus}.`
          : `${patient.name} hasn't checked in today.`;
      } else {
        answer = `${patient.name}'s payment is ${co.payment_status}; checkout stage is ${co.checkout_stage.replace(/_/g, " ")}.`;
      }
      break;
    }
    case "ask_last_visit": {
      const last = await findLastToken(supabase, user.clinicId, patient.id);
      answer = last
        ? `Last visit was ${fmtDate(last.date)} — token #${last.token_number}${last.doctor ? ` with ${last.doctor}` : ""}.`
        : isFirstVisit
          ? `${patient.name} is a new patient — no prior visits.`
          : `No earlier visit recorded for ${patient.name}.`;
      break;
    }
    case "ask_last_complaint": {
      const last = await findLastToken(supabase, user.clinicId, patient.id);
      answer = last
        ? last.raw_complaint
          ? `Last complaint (${fmtDate(last.date)}): "${last.raw_complaint}".`
          : `Last visit was on ${fmtDate(last.date)} but no complaint text was saved.`
        : `No earlier visit recorded for ${patient.name}.`;
      break;
    }
    case "ask_visit_count":
      answer = `${patient.name} has ${patient.totalVisits} visit${patient.totalVisits === 1 ? "" : "s"} on record.`;
      break;
    default:
      // Unknown intent — give a compact profile summary as a sensible fallback.
      answer = `${patient.name} — ${patient.phone}${patient.age ? `, ${patient.age}` : ""}${patient.gender ? `, ${patient.gender}` : ""}${patient.language_preference && patient.language_preference !== "en" ? `, speaks ${langFull(patient.language_preference)}` : ""}. ${isFirstVisit ? "New patient today." : `Returning — ${patient.totalVisits} visits since ${fmtDate(patient.created_at)}.`}`;
  }

  return NextResponse.json({
    ok: true,
    intent,
    answer,
    patient,
    actions: defaultActions(patient)
  });
}
