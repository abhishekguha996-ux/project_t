import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  Type,
  type Content,
  type FunctionDeclaration
} from "@google/genai";
import { NextResponse } from "next/server";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getServerEnv } from "@/lib/env/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { AppRole, PatientPregnancyStatus } from "@/lib/utils/types";

/**
 * Prāṇa — the soul of QCare.
 *
 * Conversational receptionist companion powered by Google Gemini. Prāṇa can:
 *   • Answer any question about patients, the queue, or the day
 *   • Journal for the receptionist ("note that Savita seemed anxious today")
 *   • Schedule reminders ("remind me in 20 min to call Ananya back")
 *   • Read back upcoming reminders and recent journal entries
 *
 * Implementation: Gemini function-calling loop. Prāṇa picks tools, we run
 * them against Supabase, and hand the results back until Gemini produces a
 * final text answer.
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
  pregnancy_status: PatientPregnancyStatus;
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

type Supa = ReturnType<typeof getSupabaseServiceRoleClient>;

/* ============================================================
   Tool implementations — identical to the Claude version; only
   the orchestration layer below has changed.
   ============================================================ */

async function tool_search_patient(
  supabase: Supa,
  clinicId: string,
  args: { name?: string; phone?: string }
): Promise<AnswerPatient | { not_found: true; query: string }> {
  let q = supabase
    .from("patients")
    .select(
      "id, name, phone, age, gender, pregnancy_status, language_preference, allergies, created_at"
    )
    .eq("clinic_id", clinicId)
    .limit(1);
  const phone = args.phone?.replace(/[^\d]/g, "") ?? "";
  if (phone.length >= 5) q = q.ilike("phone", `%${phone}%`);
  else if (args.name) q = q.ilike("name", `%${args.name}%`);
  else return { not_found: true, query: "" };

  const { data } = await q;
  const row = ((data as Array<{
    id: string;
    name: string;
    phone: string;
    age: number | null;
    gender: "male" | "female" | "other" | null;
    pregnancy_status: PatientPregnancyStatus;
    language_preference: string | null;
    allergies: string[] | null;
    created_at: string | null;
  }> | null) ?? [])[0];

  if (!row) return { not_found: true, query: args.name ?? args.phone ?? "" };

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
    pregnancy_status: row.pregnancy_status,
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

async function tool_patient_last_visit(
  supabase: Supa,
  clinicId: string,
  args: { patient_id: string }
) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("tokens")
    .select("id, token_number, date, raw_complaint, doctors(name)")
    .eq("clinic_id", clinicId)
    .eq("patient_id", args.patient_id)
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
  if (row.length === 0) return { none: true };
  const d = Array.isArray(row[0].doctors) ? row[0].doctors[0] : row[0].doctors;
  return {
    token_id: row[0].id,
    token_number: row[0].token_number,
    date: row[0].date,
    complaint: row[0].raw_complaint,
    doctor: d?.name ?? null
  };
}

async function tool_queue_snapshot(supabase: Supa, clinicId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from("tokens")
    .select(
      "id, token_number, status, raw_complaint, checked_in_at, patients(name), doctors(name)"
    )
    .eq("clinic_id", clinicId)
    .eq("date", today)
    .in("status", ["waiting", "serving", "stepped_out"])
    .order("token_number", { ascending: true });
  const rows = ((data as unknown) as
    | Array<{
        id: string;
        token_number: number;
        status: string;
        raw_complaint: string | null;
        checked_in_at: string;
        patients: { name?: string | null } | Array<{ name?: string | null }> | null;
        doctors: { name?: string | null } | Array<{ name?: string | null }> | null;
      }>
    | null) ?? [];
  return rows.map((r) => {
    const p = Array.isArray(r.patients) ? r.patients[0] : r.patients;
    const d = Array.isArray(r.doctors) ? r.doctors[0] : r.doctors;
    return {
      token_id: r.id,
      token_number: r.token_number,
      status: r.status,
      complaint: r.raw_complaint,
      minutes_waited: Math.round((Date.now() - new Date(r.checked_in_at).getTime()) / 60000),
      patient: p?.name ?? null,
      doctor: d?.name ?? null
    };
  });
}

async function tool_queue_demographic_filter(
  supabase: Supa,
  clinicId: string,
  args: {
    statuses?: string[];
    min_age?: number;
    max_age?: number;
    gender?: "male" | "female" | "other";
    pregnancy_status?: PatientPregnancyStatus;
    doctor_id?: string;
  }
) {
  const today = new Date().toISOString().slice(0, 10);
  const validStatuses = new Set(["waiting", "serving", "stepped_out", "complete", "skipped"]);
  const requestedStatuses = (args.statuses ?? ["waiting"]).filter((status) =>
    validStatuses.has(status)
  );
  const statuses = requestedStatuses.length > 0 ? requestedStatuses : ["waiting"];

  let query = supabase
    .from("tokens")
    .select(
      "id, token_number, status, raw_complaint, checked_in_at, doctor_id, patients(name, age, gender, pregnancy_status), doctors(name)"
    )
    .eq("clinic_id", clinicId)
    .eq("date", today)
    .in("status", statuses)
    .order("token_number", { ascending: true });

  if (args.doctor_id) {
    query = query.eq("doctor_id", args.doctor_id);
  }

  const { data } = await query;
  const rows = ((data as unknown) as
    | Array<{
        id: string;
        token_number: number;
        status: string;
        raw_complaint: string | null;
        checked_in_at: string;
        doctor_id: string;
        patients:
          | {
              name?: string | null;
              age?: number | null;
              gender?: "male" | "female" | "other" | null;
              pregnancy_status?: PatientPregnancyStatus | null;
            }
          | Array<{
              name?: string | null;
              age?: number | null;
              gender?: "male" | "female" | "other" | null;
              pregnancy_status?: PatientPregnancyStatus | null;
            }>
          | null;
        doctors: { name?: string | null } | Array<{ name?: string | null }> | null;
      }>
    | null) ?? [];

  const normalized = rows.map((row) => {
    const patient = Array.isArray(row.patients) ? row.patients[0] : row.patients;
    const doctor = Array.isArray(row.doctors) ? row.doctors[0] : row.doctors;
    return {
      token_id: row.id,
      token_number: row.token_number,
      status: row.status,
      complaint: row.raw_complaint,
      minutes_waited: Math.round((Date.now() - new Date(row.checked_in_at).getTime()) / 60000),
      patient: patient?.name ?? null,
      age: patient?.age ?? null,
      gender: patient?.gender ?? null,
      pregnancy_status: patient?.pregnancy_status ?? "unknown",
      doctor: doctor?.name ?? null
    };
  });

  const baseFiltered = normalized.filter((row) => {
    if (typeof args.min_age === "number" && (row.age ?? -1) < args.min_age) {
      return false;
    }
    if (typeof args.max_age === "number" && (row.age ?? Number.MAX_SAFE_INTEGER) > args.max_age) {
      return false;
    }
    if (args.gender && row.gender !== args.gender) {
      return false;
    }
    return true;
  });

  const items = baseFiltered.filter((row) => {
    if (args.pregnancy_status && row.pregnancy_status !== args.pregnancy_status) {
      return false;
    }
    return true;
  });

  const unknownPregnancyCount =
    args.pregnancy_status === "pregnant"
      ? baseFiltered.filter((row) => row.pregnancy_status === "unknown").length
      : 0;

  return {
    count: items.length,
    unknown_pregnancy_count: unknownPregnancyCount,
    items
  };
}

async function tool_doctors_on_duty(supabase: Supa, clinicId: string) {
  const { data } = await supabase
    .from("doctors")
    .select("id, name, specialty, room, status")
    .eq("clinic_id", clinicId)
    .order("name", { ascending: true });
  return (data as Array<{
    id: string;
    name: string;
    specialty: string | null;
    room: string | null;
    status: string;
  }> | null) ?? [];
}

async function tool_journal_add(
  supabase: Supa,
  clinicId: string,
  actorClerkId: string,
  actorRole: AppRole,
  args: { body: string; mood?: string; tags?: string[]; patient_id?: string; token_id?: string }
) {
  const { data, error } = await supabase
    .from("prana_journal")
    .insert({
      clinic_id: clinicId,
      actor_clerk_id: actorClerkId,
      actor_role: actorRole,
      body: args.body,
      mood: args.mood ?? null,
      tags: args.tags ?? [],
      patient_id: args.patient_id ?? null,
      token_id: args.token_id ?? null
    })
    .select("id, created_at")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: (data as { id: string }).id, created_at: (data as { created_at: string }).created_at };
}

async function tool_journal_recent(
  supabase: Supa,
  clinicId: string,
  actorClerkId: string,
  args: { limit?: number }
) {
  const limit = Math.min(Math.max(args.limit ?? 5, 1), 20);
  const { data } = await supabase
    .from("prana_journal")
    .select("id, body, mood, tags, created_at, patients(name)")
    .eq("clinic_id", clinicId)
    .eq("actor_clerk_id", actorClerkId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = ((data as unknown) as
    | Array<{
        id: string;
        body: string;
        mood: string | null;
        tags: string[] | null;
        created_at: string;
        patients: { name?: string | null } | Array<{ name?: string | null }> | null;
      }>
    | null) ?? [];
  return rows.map((r) => {
    const p = Array.isArray(r.patients) ? r.patients[0] : r.patients;
    return {
      id: r.id,
      body: r.body,
      mood: r.mood,
      tags: r.tags ?? [],
      created_at: r.created_at,
      patient: p?.name ?? null
    };
  });
}

async function tool_reminder_add(
  supabase: Supa,
  clinicId: string,
  actorClerkId: string,
  actorRole: AppRole,
  args: {
    title: string;
    details?: string;
    remind_in_minutes?: number;
    remind_at?: string;
    patient_id?: string;
    token_id?: string;
  }
) {
  let remindAt: Date;
  if (args.remind_at) {
    remindAt = new Date(args.remind_at);
    if (Number.isNaN(remindAt.getTime())) {
      return { ok: false, error: "Invalid remind_at" };
    }
  } else if (typeof args.remind_in_minutes === "number") {
    remindAt = new Date(Date.now() + args.remind_in_minutes * 60_000);
  } else {
    return { ok: false, error: "Need remind_at or remind_in_minutes" };
  }

  const { data, error } = await supabase
    .from("prana_reminders")
    .insert({
      clinic_id: clinicId,
      actor_clerk_id: actorClerkId,
      actor_role: actorRole,
      title: args.title,
      details: args.details ?? null,
      remind_at: remindAt.toISOString(),
      patient_id: args.patient_id ?? null,
      token_id: args.token_id ?? null
    })
    .select("id, remind_at")
    .single();
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    id: (data as { id: string }).id,
    remind_at: (data as { remind_at: string }).remind_at
  };
}

async function tool_reminder_upcoming(
  supabase: Supa,
  clinicId: string,
  actorClerkId: string,
  args: { hours_ahead?: number }
) {
  const hoursAhead = Math.min(Math.max(args.hours_ahead ?? 24, 1), 168);
  const now = new Date();
  const horizon = new Date(now.getTime() + hoursAhead * 3_600_000);
  const { data } = await supabase
    .from("prana_reminders")
    .select("id, title, details, remind_at, patients(name)")
    .eq("clinic_id", clinicId)
    .eq("actor_clerk_id", actorClerkId)
    .eq("status", "pending")
    .lte("remind_at", horizon.toISOString())
    .order("remind_at", { ascending: true })
    .limit(20);
  const rows = ((data as unknown) as
    | Array<{
        id: string;
        title: string;
        details: string | null;
        remind_at: string;
        patients: { name?: string | null } | Array<{ name?: string | null }> | null;
      }>
    | null) ?? [];
  return rows.map((r) => {
    const p = Array.isArray(r.patients) ? r.patients[0] : r.patients;
    return {
      id: r.id,
      title: r.title,
      details: r.details,
      remind_at: r.remind_at,
      minutes_from_now: Math.round(
        (new Date(r.remind_at).getTime() - Date.now()) / 60_000
      ),
      patient: p?.name ?? null
    };
  });
}

/* ============================================================
   Gemini function declarations
   ============================================================ */

const functionDeclarations: FunctionDeclaration[] = [
  {
    name: "search_patient",
    description:
      "Find a patient in this clinic by name or phone. Returns their profile plus any token for today (number, status, doctor). Prefer phone when the user gives digits; otherwise match by name substring.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, description: "Full or partial name." },
        phone: { type: Type.STRING, description: "Phone number digits, with or without +91." }
      }
    }
  },
  {
    name: "patient_last_visit",
    description:
      "Get the most recent prior-day visit for a patient (date, doctor, complaint).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        patient_id: { type: Type.STRING, description: "UUID from search_patient." }
      },
      required: ["patient_id"]
    }
  },
  {
    name: "queue_snapshot",
    description:
      "Snapshot of today's active queue across all doctors — every token that is waiting, serving, or stepped_out. Includes how long each person has been waiting.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "queue_demographic_filter",
    description:
      "Filter today's queue by demographics and queue state. Use this for questions about older/senior patients, women/ladies, pregnant patients, or children. This tool only supports AND filters, so for 'or' questions you should call it multiple times and combine results without double-counting.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        statuses: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
          description:
            "Queue statuses to include. Defaults to ['waiting'] when omitted."
        },
        min_age: { type: Type.INTEGER, description: "Minimum patient age, inclusive." },
        max_age: { type: Type.INTEGER, description: "Maximum patient age, inclusive." },
        gender: {
          type: Type.STRING,
          enum: ["male", "female", "other"]
        },
        pregnancy_status: {
          type: Type.STRING,
          enum: ["unknown", "pregnant", "not_pregnant", "prefer_not_to_say"]
        },
        doctor_id: {
          type: Type.STRING,
          description: "Optional doctor UUID to scope the queue to one doctor."
        }
      }
    }
  },
  {
    name: "doctors_on_duty",
    description: "List doctors on the roster today with their specialty, room, and status.",
    parameters: { type: Type.OBJECT, properties: {} }
  },
  {
    name: "journal_add",
    description:
      "Save a private journal/diary note for the current receptionist. Use this when the user says things like 'note that…', 'remember for me…', 'jot down…', 'I want to remember…'. You may optionally tag the note with a patient_id.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        body: { type: Type.STRING, description: "The note content. Keep the user's voice." },
        mood: {
          type: Type.STRING,
          enum: ["calm", "rushed", "stressed", "proud", "tired", "curious"]
        },
        tags: { type: Type.ARRAY, items: { type: Type.STRING } },
        patient_id: { type: Type.STRING },
        token_id: { type: Type.STRING }
      },
      required: ["body"]
    }
  },
  {
    name: "journal_recent",
    description: "Read back recent journal entries for the current receptionist.",
    parameters: {
      type: Type.OBJECT,
      properties: { limit: { type: Type.INTEGER, minimum: 1, maximum: 20 } }
    }
  },
  {
    name: "reminder_add",
    description:
      "Schedule a reminder for the current receptionist. Either pass remind_in_minutes (e.g. 20) OR an absolute remind_at ISO timestamp. Use this when the user says 'remind me in/at/when…'.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING },
        details: { type: Type.STRING },
        remind_in_minutes: { type: Type.INTEGER, minimum: 1, maximum: 1440 },
        remind_at: { type: Type.STRING, description: "ISO 8601 timestamp, UTC." },
        patient_id: { type: Type.STRING },
        token_id: { type: Type.STRING }
      },
      required: ["title"]
    }
  },
  {
    name: "reminder_upcoming",
    description: "List pending reminders for the current receptionist in the next N hours.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        hours_ahead: { type: Type.INTEGER, minimum: 1, maximum: 168 }
      }
    }
  }
];

/* ============================================================
   Route
   ============================================================ */

type CoPilotResponse = {
  ok: true;
  answer: string;
  intent?: string;
  patient: AnswerPatient | null;
  actions: AnswerAction[];
};

function defaultActions(p: AnswerPatient | null): AnswerAction[] {
  if (!p) return [];
  const a: AnswerAction[] = [];
  if (p.phone) a.push({ label: `Call ${p.phone}`, href: `tel:${p.phone}`, kind: "call" });
  if (p.todayTokenId) {
    a.push({ label: "View tracking", href: `/track/${p.todayTokenId}`, kind: "link" });
  } else {
    a.push({ label: "Check in", kind: "checkin" });
  }
  return a;
}

export async function POST(request: Request) {
  const user = await getCurrentClinicUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canAccess(user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { question?: string } | null;
  const question = (body?.question ?? "").trim();
  if (question.length < 2) {
    return NextResponse.json<CoPilotResponse>({
      ok: true,
      answer: "Ask me anything — about a patient, the queue, or say 'remind me in 10 min…'",
      patient: null,
      actions: []
    });
  }

  const env = getServerEnv();
  if (!env.GEMINI_API_KEY) {
    return NextResponse.json<CoPilotResponse>({
      ok: true,
      answer:
        "I'm not connected to my brain yet. Add GEMINI_API_KEY=… to .env.local and restart the dev server. Get a key at aistudio.google.com/apikey.",
      patient: null,
      actions: []
    });
  }

  const supabase = getSupabaseServiceRoleClient();
  const genai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

  let lastPatient: AnswerPatient | null = null;

  async function runTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "search_patient": {
        const res = await tool_search_patient(supabase, user!.clinicId, args as { name?: string; phone?: string });
        if (!("not_found" in res)) lastPatient = res;
        return res;
      }
      case "patient_last_visit":
        return tool_patient_last_visit(supabase, user!.clinicId, args as { patient_id: string });
      case "queue_snapshot":
        return tool_queue_snapshot(supabase, user!.clinicId);
      case "queue_demographic_filter":
        return tool_queue_demographic_filter(supabase, user!.clinicId, args as {
          statuses?: string[];
          min_age?: number;
          max_age?: number;
          gender?: "male" | "female" | "other";
          pregnancy_status?: PatientPregnancyStatus;
          doctor_id?: string;
        });
      case "doctors_on_duty":
        return tool_doctors_on_duty(supabase, user!.clinicId);
      case "journal_add":
        return tool_journal_add(supabase, user!.clinicId, user!.clerkUserId, user!.role, args as {
          body: string;
          mood?: string;
          tags?: string[];
          patient_id?: string;
          token_id?: string;
        });
      case "journal_recent":
        return tool_journal_recent(supabase, user!.clinicId, user!.clerkUserId, args as { limit?: number });
      case "reminder_add":
        return tool_reminder_add(supabase, user!.clinicId, user!.clerkUserId, user!.role, args as {
          title: string;
          details?: string;
          remind_in_minutes?: number;
          remind_at?: string;
          patient_id?: string;
          token_id?: string;
        });
      case "reminder_upcoming":
        return tool_reminder_upcoming(supabase, user!.clinicId, user!.clerkUserId, args as { hours_ahead?: number });
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }

  const now = new Date();
  const nowIST = new Intl.DateTimeFormat("en-IN", {
    dateStyle: "full",
    timeStyle: "short",
    timeZone: "Asia/Kolkata"
  }).format(now);

  function errorAnswer(e: unknown): CoPilotResponse {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[Prāṇa] Gemini call failed:", raw);
    let answer = `Prāṇa tripped on: ${raw.slice(0, 220)}`;
    const lower = raw.toLowerCase();
    if (
      lower.includes("api key not valid") ||
      lower.includes("api_key_invalid") ||
      lower.includes("invalid api key") ||
      lower.includes("401") ||
      lower.includes("403") ||
      lower.includes("permission_denied")
    ) {
      answer =
        "GEMINI_API_KEY looks invalid. Check the key in .env.local and restart the dev server. Generate one at aistudio.google.com/apikey.";
    } else if (
      lower.includes("model") &&
      (lower.includes("not_found") || lower.includes("not found") || lower.includes("does not exist"))
    ) {
      answer = `Model "${env.PRANA_MODEL}" isn't available on your API key. Try PRANA_MODEL=gemini-2.5-flash or gemini-2.0-flash in .env.local and restart.`;
    } else if (lower.includes("quota") || lower.includes("resource_exhausted")) {
      answer = "Gemini quota exceeded. Check your Google AI Studio usage and try again.";
    } else if (lower.includes("rate") && lower.includes("limit")) {
      answer = "Rate-limited by Gemini. Give it a few seconds and try again.";
    } else if (lower.includes("overloaded") || lower.includes("unavailable")) {
      answer = "Gemini is overloaded right now. Try again in a moment.";
    } else if (lower.includes("safety") || lower.includes("blocked")) {
      answer = "Gemini's safety filter blocked that. Try rephrasing.";
    }
    return { ok: true, answer, patient: null, actions: [] };
  }

  const systemPrompt = `You are Prāṇa — the soul of QCare, an Indian clinic management platform. Prāṇa means "life force" in Sanskrit; you help the clinic breathe.

Right now you're the silent co-worker of a ${user.role.replace(/_/g, " ")} at an Indian outpatient clinic. Current time: ${nowIST} (Asia/Kolkata).

Your capabilities via tools:
  • search_patient, patient_last_visit — answer questions about patients
  • queue_snapshot — who's waiting, with whom, for how long
  • queue_demographic_filter — demographic filters on today's queue
  • doctors_on_duty — clinic roster
  • journal_add, journal_recent — receptionist's private journal ("note that…", "remember for me…")
  • reminder_add, reminder_upcoming — receptionist's calendar ("remind me in 20 min…")

Style guide:
  • Be terse and human. 1–3 sentences. Never lecture.
  • Use Indian clinic language — "token #12", "with Dr. Arjun", "₹500", "IST".
  • When the user says "note/remember/jot/diary", CALL journal_add — don't just reply.
  • When they say "remind me", CALL reminder_add.
  • When they ask about a patient, CALL search_patient first, then answer.
  • When they ask about older/senior/elderly patients, women/ladies, pregnant patients, or children in the queue, CALL queue_demographic_filter.
  • Older/senior means age 65 and above.
  • Children means age under 12.
  • "Waiting" means status = waiting unless the user asks otherwise.
  • Ladies/women means gender = female for now.
  • Never infer pregnancy from complaint text or symptoms.
  • For questions that say "or" (example: "old or pregnant ladies waiting"), make multiple queue_demographic_filter calls and combine the results without double-counting.
  • For pregnancy questions, if no pregnant patients are found but queue_demographic_filter reports unknown_pregnancy_count > 0, mention that some patients have unknown pregnancy status.
  • If a tool returns not_found, say so clearly. Don't invent data.
  • When you save a journal entry or reminder, confirm briefly — "Noted." or "Reminder set for 3:42 PM."
  • Never expose UUIDs or internal IDs in your answer.
`;

  // Gemini chat history. Each turn is a Content object with role + parts.
  const contents: Content[] = [
    { role: "user", parts: [{ text: question }] }
  ];

  // Function-calling loop. Cap at 6 iterations to bound cost/latency.
  let finalText = "";
  try {
    for (let i = 0; i < 6; i++) {
      const resp = await genai.models.generateContent({
        model: env.PRANA_MODEL,
        contents,
        config: {
          systemInstruction: systemPrompt,
          tools: [{ functionDeclarations }],
          toolConfig: {
            functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO }
          },
          temperature: 0.4,
          maxOutputTokens: 1024
        }
      });

      const candidate = resp.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];

      const functionCalls = parts.filter((p) => p.functionCall);
      const text = parts
        .filter((p) => typeof p.text === "string" && p.text.length > 0)
        .map((p) => p.text as string)
        .join("\n")
        .trim();

      if (functionCalls.length === 0) {
        finalText = text;
        break;
      }

      // Record the model's turn (both any text and the function calls), then
      // append a user turn containing the tool results — that's Gemini's
      // convention for continuing a tool-using conversation.
      contents.push({
        role: "model",
        parts
      });

      const toolResultParts = await Promise.all(
        functionCalls.map(async (p) => {
          const call = p.functionCall!;
          const callName = call.name ?? "";
          const callArgs = (call.args ?? {}) as Record<string, unknown>;
          const output = await runTool(callName, callArgs).catch((e: unknown) => ({
            error: String(e)
          }));
          return {
            functionResponse: {
              name: callName,
              response: { output }
            }
          };
        })
      );
      contents.push({ role: "user", parts: toolResultParts });
    }
  } catch (e) {
    return NextResponse.json<CoPilotResponse>(errorAnswer(e));
  }

  if (!finalText) {
    finalText = "I got stuck — could you rephrase that?";
  }

  return NextResponse.json<CoPilotResponse>({
    ok: true,
    answer: finalText,
    patient: lastPatient,
    actions: defaultActions(lastPatient)
  });
}
