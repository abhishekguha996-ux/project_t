import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

import { getCurrentClinicUser } from "@/lib/auth/current-user";
import { getServerEnv } from "@/lib/env/server";
import { getSupabaseServiceRoleClient } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/utils/types";

/**
 * Prāṇa — the soul of QCare.
 *
 * Conversational receptionist companion powered by Claude. Prāṇa can:
 *   • Answer any question about patients, the queue, or the day
 *   • Journal for the receptionist ("note that Savita seemed anxious today")
 *   • Schedule reminders ("remind me in 20 min to call Ananya back")
 *   • Read back upcoming reminders and recent journal entries
 *
 * Implementation: Claude tool-use loop. Prāṇa decides which tools to call, we
 * execute them against Supabase, and hand the results back until it produces
 * a final text answer. The endpoint contract on the client side is unchanged
 * from v1, so the old answer-card UI still works.
 *
 * Fallback: if ANTHROPIC_API_KEY is missing, we return a polite degraded
 * response rather than crashing.
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

type Supa = ReturnType<typeof getSupabaseServiceRoleClient>;

/* ============================================================
   Tool implementations — each runs Supabase queries scoped to
   the authenticated user's clinic + actor.
   ============================================================ */

async function tool_search_patient(
  supabase: Supa,
  clinicId: string,
  args: { name?: string; phone?: string }
): Promise<AnswerPatient | { not_found: true; query: string }> {
  let q = supabase
    .from("patients")
    .select("id, name, phone, age, gender, language_preference, allergies, created_at")
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
   Claude tool definitions
   ============================================================ */

const tools: Anthropic.Tool[] = [
  {
    name: "search_patient",
    description:
      "Find a patient in this clinic by name or phone. Returns their profile plus any token for today (number, status, doctor). Prefer phone when the user gives digits; otherwise match by name substring.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Full or partial name." },
        phone: { type: "string", description: "Phone number digits, with or without +91." }
      }
    }
  },
  {
    name: "patient_last_visit",
    description:
      "Get the most recent prior-day visit for a patient (date, doctor, complaint).",
    input_schema: {
      type: "object",
      properties: {
        patient_id: { type: "string", description: "UUID from search_patient." }
      },
      required: ["patient_id"]
    }
  },
  {
    name: "queue_snapshot",
    description:
      "Snapshot of today's active queue across all doctors — every token that is waiting, serving, or stepped_out. Includes how long each person has been waiting.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "doctors_on_duty",
    description: "List doctors on the roster today with their specialty, room, and status.",
    input_schema: { type: "object", properties: {} }
  },
  {
    name: "journal_add",
    description:
      "Save a private journal/diary note for the current receptionist. Use this when the user says things like 'note that…', 'remember for me…', 'jot down…', 'I want to remember…'. You may optionally tag the note with a patient_id.",
    input_schema: {
      type: "object",
      properties: {
        body: { type: "string", description: "The note content. Keep the user's voice." },
        mood: {
          type: "string",
          enum: ["calm", "rushed", "stressed", "proud", "tired", "curious"]
        },
        tags: { type: "array", items: { type: "string" } },
        patient_id: { type: "string" },
        token_id: { type: "string" }
      },
      required: ["body"]
    }
  },
  {
    name: "journal_recent",
    description: "Read back recent journal entries for the current receptionist.",
    input_schema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 20 } }
    }
  },
  {
    name: "reminder_add",
    description:
      "Schedule a reminder for the current receptionist. Either pass remind_in_minutes (e.g. 20) OR an absolute remind_at ISO timestamp. Use this when the user says 'remind me in/at/when…'.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        details: { type: "string" },
        remind_in_minutes: { type: "integer", minimum: 1, maximum: 1440 },
        remind_at: { type: "string", description: "ISO 8601 timestamp, UTC." },
        patient_id: { type: "string" },
        token_id: { type: "string" }
      },
      required: ["title"]
    }
  },
  {
    name: "reminder_upcoming",
    description: "List pending reminders for the current receptionist in the next N hours.",
    input_schema: {
      type: "object",
      properties: {
        hours_ahead: { type: "integer", minimum: 1, maximum: 168 }
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
  if (!env.ANTHROPIC_API_KEY) {
    return NextResponse.json<CoPilotResponse>({
      ok: true,
      answer:
        "I'm not connected to my brain yet. Add ANTHROPIC_API_KEY=sk-ant-… to .env.local and restart the dev server. Get a key at console.anthropic.com/settings/keys.",
      patient: null,
      actions: []
    });
  }

  const supabase = getSupabaseServiceRoleClient();
  const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

  // Track the "subject" patient for the response so the UI's patient card
  // surfaces the right person when Prāṇa's answer was about them.
  let lastPatient: AnswerPatient | null = null;

  async function runTool(name: string, input: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "search_patient": {
        const res = await tool_search_patient(supabase, user!.clinicId, input as { name?: string; phone?: string });
        if (!("not_found" in res)) lastPatient = res;
        return res;
      }
      case "patient_last_visit":
        return tool_patient_last_visit(supabase, user!.clinicId, input as { patient_id: string });
      case "queue_snapshot":
        return tool_queue_snapshot(supabase, user!.clinicId);
      case "doctors_on_duty":
        return tool_doctors_on_duty(supabase, user!.clinicId);
      case "journal_add":
        return tool_journal_add(supabase, user!.clinicId, user!.clerkUserId, user!.role, input as {
          body: string;
          mood?: string;
          tags?: string[];
          patient_id?: string;
          token_id?: string;
        });
      case "journal_recent":
        return tool_journal_recent(supabase, user!.clinicId, user!.clerkUserId, input as { limit?: number });
      case "reminder_add":
        return tool_reminder_add(supabase, user!.clinicId, user!.clerkUserId, user!.role, input as {
          title: string;
          details?: string;
          remind_in_minutes?: number;
          remind_at?: string;
          patient_id?: string;
          token_id?: string;
        });
      case "reminder_upcoming":
        return tool_reminder_upcoming(supabase, user!.clinicId, user!.clerkUserId, input as { hours_ahead?: number });
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

  // Friendly, specific error when the Anthropic call fails so the user isn't
  // left with the generic client-side fallback.
  function errorAnswer(e: unknown): CoPilotResponse {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[Prāṇa] Claude call failed:", raw);
    let answer = `Prāṇa tripped on: ${raw.slice(0, 220)}`;
    const lower = raw.toLowerCase();
    if (lower.includes("401") || lower.includes("authentication") || lower.includes("invalid api key") || lower.includes("x-api-key")) {
      answer =
        "ANTHROPIC_API_KEY looks invalid. Check the key in .env.local — should start with sk-ant-…";
    } else if (lower.includes("model") && (lower.includes("not_found") || lower.includes("not found") || lower.includes("404") || lower.includes("does not exist"))) {
      answer = `Model "${env.PRANA_MODEL}" isn't available on your API key. Try PRANA_MODEL=claude-haiku-4-5 or claude-sonnet-4-5 in .env.local and restart.`;
    } else if (lower.includes("rate") && lower.includes("limit")) {
      answer = "Rate-limited by Anthropic. Give it a few seconds and try again.";
    } else if (lower.includes("overloaded")) {
      answer = "Anthropic is overloaded right now. Try again in a moment.";
    }
    return { ok: true, answer, patient: null, actions: [] };
  }

  const systemPrompt = `You are Prāṇa — the soul of QCare, an Indian clinic management platform. Prāṇa means "life force" in Sanskrit; you help the clinic breathe.

Right now you're the silent co-worker of a ${user.role.replace(/_/g, " ")} at an Indian outpatient clinic. Current time: ${nowIST} (Asia/Kolkata).

Your capabilities via tools:
  • search_patient, patient_last_visit — answer questions about patients
  • queue_snapshot — who's waiting, with whom, for how long
  • doctors_on_duty — clinic roster
  • journal_add, journal_recent — receptionist's private journal ("note that…", "remember for me…")
  • reminder_add, reminder_upcoming — receptionist's calendar ("remind me in 20 min…")

Style guide:
  • Be terse and human. 1–3 sentences. Never lecture.
  • Use Indian clinic language — "token #12", "with Dr. Arjun", "₹500", "IST".
  • When the user says "note/remember/jot/diary", CALL journal_add — don't just reply.
  • When they say "remind me", CALL reminder_add.
  • When they ask about a patient, CALL search_patient first, then answer.
  • If a tool returns not_found, say so clearly. Don't invent data.
  • When you save a journal entry or reminder, confirm briefly — "Noted." or "Reminder set for 3:42 PM."
  • Never expose UUIDs or internal IDs in your answer.
`;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: question }
  ];

  // Tool-use loop. Cap at 6 iterations to keep cost/latency bounded.
  let finalText = "";
  try {
    for (let i = 0; i < 6; i++) {
      const resp = await anthropic.messages.create({
        model: env.PRANA_MODEL,
        max_tokens: 1024,
        system: systemPrompt,
        tools,
        messages
      });

      const toolUses = resp.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      const texts = resp.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();

      if (toolUses.length === 0) {
        finalText = texts;
        break;
      }

      messages.push({ role: "assistant", content: resp.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const out = await runTool(use.name, use.input as Record<string, unknown>).catch(
          (e: unknown) => ({ error: String(e) })
        );
        toolResults.push({
          type: "tool_result",
          tool_use_id: use.id,
          content: JSON.stringify(out)
        });
      }
      messages.push({ role: "user", content: toolResults });

      if (resp.stop_reason !== "tool_use") {
        finalText = texts;
        break;
      }
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
