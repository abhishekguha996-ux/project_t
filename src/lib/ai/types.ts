/**
 * Shared types for the agent loop.
 *
 * Design note: the LLM never sees clinic_id / actor_clerk_id — those are
 * injected by the executor. Tools receive a typed `context` that enforces
 * clinic isolation at the boundary, not at the model.
 */

import type { AppRole } from "@/lib/utils/types";

export type Language = "en" | "hi" | "te" | "hinglish";

export type AskContext = {
  clinicId: string;
  actorClerkId: string;
  actorRole: AppRole;
  boundPatientId: string | null;
  boundTokenId: string | null;
};

/* ---------------- Tool types ---------------- */

export type ToolName =
  | "search_patients"
  | "get_patient"
  | "get_patient_history"
  | "get_today_queue"
  | "get_clinic_stats"
  | "get_doctors_on";

export type ToolCall = {
  tool: ToolName;
  args: Record<string, unknown>;
};

export type SourceRef = {
  /** Number shown to the user, e.g. [1]. Stable within a single turn. */
  id: number;
  /** Supabase table (for developer inspection). */
  table: string;
  /** Row id (patient/token/etc) — UI uses this for previews. */
  ref: string;
  /** Short human label shown in the citation chip ("Meera S · token #12"). */
  label: string;
};

export type ToolResult = {
  tool: ToolName;
  /** Markdown-ish compact text the synthesizer reads. */
  summary: string;
  /** Citations this tool contributed (may be empty). */
  sources: SourceRef[];
  /** Structured payload for UI actions (e.g. patient phone for a call button). */
  data?: Record<string, unknown>;
  /** Wall-clock latency for observability. */
  latencyMs: number;
  /** True if the tool degraded (e.g. empty result, permission denied). */
  soft?: boolean;
};

/* ---------------- Engine events (streamed over SSE) ---------------- */

export type EngineEvent =
  | { type: "meta"; turnId: string; language: Language; cacheHit: boolean }
  | { type: "plan"; calls: ToolCall[] }
  | { type: "tool_start"; tool: ToolName; args: Record<string, unknown> }
  | {
      type: "tool_done";
      tool: ToolName;
      summary: string;
      sources: SourceRef[];
      latencyMs: number;
      soft?: boolean;
    }
  | { type: "token"; text: string }
  | {
      type: "done";
      answer: string;
      citations: SourceRef[];
      actions: AnswerAction[];
      totalLatencyMs: number;
    }
  | { type: "error"; message: string };

export type AnswerAction = {
  label: string;
  kind: "call" | "link" | "checkin";
  href?: string;
};

/* ---------------- OpenAI-compatible chat primitives ---------------- */

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string };

export type ChatCompletionResult = {
  content: string;
  totalTokens: number | null;
};
