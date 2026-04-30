"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  History,
  Languages,
  Loader2,
  Mic,
  MicOff,
  Phone,
  Sparkles,
  Stethoscope,
  ThumbsDown,
  ThumbsUp,
  UserPlus,
  X
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import type { AnswerAction, SourceRef } from "@/lib/ai/types";

/* ---------------- types ---------------- */

type Phase = "serving" | "waiting";

export type PulseContext =
  | {
      patientId: string;
      tokenId: string;
      patientName: string;
      phase: Phase;
      age?: number | null;
      gender?: "male" | "female" | "other" | null;
    }
  | null;

type ToolStep = {
  tool: string;
  status: "pending" | "done" | "soft";
};

type Chip = {
  id: string;
  label: string;
  q: string;
  icon: React.ReactNode;
};

type ThemeKey = "serving" | "waiting" | "idle";

type SseEvent =
  | { type: "meta"; turnId: string; language: string; cacheHit: boolean }
  | { type: "plan"; calls: Array<{ tool: string; args: unknown }> }
  | { type: "tool_start"; tool: string; args: unknown }
  | {
      type: "tool_done";
      tool: string;
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

type LegacyJsonAnswer = {
  answer?: string;
  actions?: AnswerAction[];
};

type AskState = {
  asking: boolean;
  answer: string;
  trace: ToolStep[];
  accumulatedSources: SourceRef[];
  citations: SourceRef[];
  actions: AnswerAction[];
  turnId: string | null;
  error: string | null;
  feedback: 1 | -1 | null;
};

const INITIAL_ASK_STATE: AskState = {
  asking: false,
  answer: "",
  trace: [],
  accumulatedSources: [],
  citations: [],
  actions: [],
  turnId: null,
  error: null,
  feedback: null
};

/* ---------------- helpers ---------------- */

async function readJson<T>(res: Response): Promise<T | null> {
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function initialOf(name: string | null | undefined) {
  return (name ?? "P").charAt(0).toUpperCase();
}

function formatProfile(ctx: PulseContext): string | null {
  if (!ctx) return null;
  const bits: string[] = [];
  if (typeof ctx.age === "number") bits.push(`${ctx.age} y/o`);
  if (ctx.gender) {
    bits.push(
      ctx.gender === "male" ? "Male" : ctx.gender === "female" ? "Female" : "Other"
    );
  }
  return bits.length ? bits.join(" • ") : null;
}

/* ---- tool trace labels ---- */

const TOOL_LABELS: Record<string, string> = {
  search_patients: "Searching patients",
  get_patient: "Fetching patient",
  get_patient_history: "Reading history",
  get_today_queue: "Checking queue",
  get_clinic_stats: "Aggregating stats",
  get_doctors_on: "Checking doctors"
};

function labelForTool(tool: string): string {
  return TOOL_LABELS[tool] ?? tool.replace(/_/g, " ");
}

/* ---- SSE reader (consumes agent loop events) ---- */

async function* streamSse(
  url: string,
  body: unknown,
  signal: AbortSignal
): AsyncGenerator<SseEvent | { type: "legacy"; payload: LegacyJsonAnswer }, void, void> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream"
    },
    body: JSON.stringify(body),
    signal
  });
  const ct = res.headers.get("content-type") ?? "";
  if (!ct.includes("text/event-stream")) {
    const payload = (await readJson<LegacyJsonAnswer>(res)) ?? {};
    yield { type: "legacy", payload };
    return;
  }
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.indexOf("\n\n");
    while (idx !== -1) {
      const frame = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      idx = buffer.indexOf("\n\n");
      if (!frame.startsWith("data:")) continue;
      const data = frame.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        yield JSON.parse(data) as SseEvent;
      } catch {
        // Ignore malformed frames.
      }
    }
  }
}

/* ---- Voice input (Web Speech API, Chrome/Safari) ---- */

type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult:
    | ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: unknown) => void) | null;
  start: () => void;
  stop: () => void;
};

function createRecognizer(lang = "en-IN"): SpeechRecognitionLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const recog = new Ctor();
  recog.lang = lang;
  recog.interimResults = true;
  recog.continuous = false;
  return recog;
}

/* ---- Answer / citation renderers ---- */

function renderAnswerTokens(
  text: string,
  sources: SourceRef[]
): React.ReactNode[] {
  if (!text) return [];
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((p, i) => {
    const m = p.match(/^\[(\d+)\]$/);
    if (!m) return <span key={i}>{p}</span>;
    const id = Number(m[1]);
    const src = sources.find((s) => s.id === id);
    if (!src)
      return (
        <span className="text-slate-400" key={i}>
          {p}
        </span>
      );
    return <CitationInline key={i} source={src} />;
  });
}

function CitationInline({ source }: { source: SourceRef }) {
  return (
    <span
      className="mx-0.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-indigo-50 px-1 align-middle text-[10px] font-bold leading-none text-indigo-700 ring-1 ring-indigo-100"
      title={`[${source.id}] ${source.label}`}
    >
      {source.id}
    </span>
  );
}

function CitationCard({ source }: { source: SourceRef }) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[10px] font-bold text-indigo-700">
        {source.id}
      </span>
      <div className="min-w-0">
        <p className="text-[9px] font-bold uppercase tracking-[0.2em] text-slate-400">
          {source.table}
        </p>
        <p className="truncate text-[12px] font-semibold tracking-[-0.01em] text-slate-900">
          {source.label}
        </p>
      </div>
    </div>
  );
}

function TraceChip({ step }: { step: ToolStep }) {
  const { status } = step;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold tracking-[-0.01em] transition",
        status === "pending" && "border-slate-200 bg-white text-slate-500",
        status === "soft" && "border-amber-200 bg-amber-50 text-amber-700",
        status === "done" && "border-emerald-200 bg-emerald-50 text-emerald-700"
      )}
    >
      {status === "pending" ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : status === "soft" ? (
        <Clock className="h-3 w-3" />
      ) : (
        <CheckCircle2 className="h-3 w-3" />
      )}
      {labelForTool(step.tool)}
    </span>
  );
}

/* ---------------- chips ---------------- */

const CHIPS_BOUND: Chip[] = [
  {
    id: "summary",
    label: "Summary",
    q: "Give me a quick summary",
    icon: <FileText className="h-3.5 w-3.5" />
  },
  {
    id: "red_flags",
    label: "Red flags",
    q: "Any red flags?",
    icon: <AlertTriangle className="h-3.5 w-3.5" />
  },
  {
    id: "allergies",
    label: "Allergies?",
    q: "Any allergies on file?",
    icon: <AlertTriangle className="h-3.5 w-3.5" />
  },
  {
    id: "last_visit",
    label: "Last visit",
    q: "When was the last visit?",
    icon: <History className="h-3.5 w-3.5" />
  },
  {
    id: "last_complaint",
    label: "Last complaint",
    q: "What was the last complaint?",
    icon: <Stethoscope className="h-3.5 w-3.5" />
  },
  {
    id: "language",
    label: "Language",
    q: "What language do they prefer?",
    icon: <Languages className="h-3.5 w-3.5" />
  }
];

const CHIPS_UNBOUND: Chip[] = [
  {
    id: "next",
    label: "Who's next?",
    q: "Who's next in line?",
    icon: <Sparkles className="h-3.5 w-3.5" />
  },
  {
    id: "doctors",
    label: "Doctors today",
    q: "Which doctors are on today?",
    icon: <Stethoscope className="h-3.5 w-3.5" />
  }
];

/* ---------------- theme ---------------- */

const PHASE_THEME: Record<
  ThemeKey,
  {
    kicker: string;
    ring: string;
    chip: string;
    dot: string;
    auraFrom: string;
  }
> = {
  serving: {
    kicker: "text-emerald-600",
    ring: "ring-emerald-500/30",
    chip: "bg-emerald-50 text-emerald-700 border-emerald-100",
    dot: "bg-emerald-500",
    auraFrom: "from-emerald-200/60"
  },
  waiting: {
    kicker: "text-indigo-600",
    ring: "ring-indigo-500/30",
    chip: "bg-indigo-50 text-indigo-700 border-indigo-100",
    dot: "bg-indigo-500",
    auraFrom: "from-indigo-200/60"
  },
  idle: {
    kicker: "text-slate-500",
    ring: "ring-slate-300/40",
    chip: "bg-slate-100 text-slate-700 border-slate-200",
    dot: "bg-slate-400",
    auraFrom: "from-slate-200/60"
  }
};

/* ---------------- Kbd ---------------- */

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-slate-200 bg-white px-1.5 py-[1px] font-mono text-[10px] font-bold text-slate-600">
      {children}
    </kbd>
  );
}

/* ---------------- Main ---------------- */

export function DoctorPulse({ context }: { context: PulseContext }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [askState, setAskState] = useState<AskState>(INITIAL_ASK_STATE);
  const [listening, setListening] = useState(false);
  const [hasRecognizer, setHasRecognizer] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);

  const phase: ThemeKey = context?.phase ?? "idle";
  const theme = PHASE_THEME[phase];

  useEffect(() => {
    setMounted(true);
    setHasRecognizer(Boolean(createRecognizer()));
  }, []);

  // Global keyboard: ⌘K / Ctrl+K toggles, "/" focuses when closed, Esc closes.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const isMeta = e.metaKey || e.ctrlKey;
      if (isMeta && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (!open && e.key === "/" && !isMeta) {
        const el = document.activeElement as HTMLElement | null;
        const tag = (el?.tagName ?? "").toLowerCase();
        if (tag === "input" || tag === "textarea" || el?.isContentEditable) return;
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (open && e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Focus input on open; reset transient state on close (after exit animation).
  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => inputRef.current?.focus(), 80);
      return () => window.clearTimeout(id);
    }
    const id = window.setTimeout(() => {
      setAskState(INITIAL_ASK_STATE);
      setQuery("");
      abortRef.current?.abort();
      abortRef.current = null;
      recogRef.current?.stop();
      recogRef.current = null;
      setListening(false);
    }, 320);
    return () => window.clearTimeout(id);
  }, [open]);

  // Reset state if the bound patient changes mid-session.
  useEffect(() => {
    setAskState(INITIAL_ASK_STATE);
  }, [context?.patientId]);

  const askQuestion = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question) return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setAskState({ ...INITIAL_ASK_STATE, asking: true });

      const body = {
        question,
        stream: true,
        context: context
          ? { patientId: context.patientId, tokenId: context.tokenId }
          : undefined
      };

      try {
        for await (const evt of streamSse(
          "/api/copilot/ask",
          body,
          controller.signal
        )) {
          if (evt.type === "legacy") {
            setAskState((s) => ({
              ...s,
              answer:
                evt.payload.answer ?? "I don't have enough context to answer that.",
              actions: evt.payload.actions ?? [],
              asking: false
            }));
            return;
          }
          setAskState((s) => {
            switch (evt.type) {
              case "meta":
                return {
                  ...s,
                  turnId: evt.turnId === "pending" ? s.turnId : evt.turnId
                };
              case "tool_start":
                return {
                  ...s,
                  trace: [...s.trace, { tool: evt.tool, status: "pending" }]
                };
              case "tool_done":
                return {
                  ...s,
                  trace: s.trace.map((t, i, arr) =>
                    i === arr.length - 1 &&
                    t.tool === evt.tool &&
                    t.status === "pending"
                      ? { tool: t.tool, status: evt.soft ? "soft" : "done" }
                      : t
                  ),
                  accumulatedSources: [...s.accumulatedSources, ...evt.sources]
                };
              case "token":
                return { ...s, answer: s.answer + evt.text };
              case "done":
                return {
                  ...s,
                  answer: evt.answer,
                  citations: evt.citations,
                  actions: evt.actions,
                  asking: false
                };
              case "error":
                return { ...s, error: evt.message, asking: false };
              default:
                return s;
            }
          });
        }
      } catch (err) {
        if ((err as Error)?.name !== "AbortError") {
          setAskState((s) => ({
            ...s,
            error: "Network error — please try again.",
            asking: false
          }));
        }
      } finally {
        setAskState((s) => (s.asking ? { ...s, asking: false } : s));
      }
    },
    [context]
  );

  const startListening = useCallback(() => {
    const recog = createRecognizer("en-IN");
    if (!recog) return;
    recog.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        const first = e.results[i][0] as { transcript?: string };
        if (first?.transcript) text += first.transcript;
      }
      setQuery(text);
    };
    recog.onend = () => setListening(false);
    recog.onerror = () => setListening(false);
    try {
      recog.start();
      recogRef.current = recog;
      setListening(true);
    } catch {
      setListening(false);
    }
  }, []);

  const stopListening = useCallback(() => {
    recogRef.current?.stop();
    setListening(false);
  }, []);

  const sendFeedback = useCallback(
    async (rating: 1 | -1) => {
      if (!askState.turnId || askState.feedback !== null) return;
      setAskState((s) => ({ ...s, feedback: rating }));
      await fetch("/api/copilot/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ turnId: askState.turnId, rating })
      }).catch(() => null);
    },
    [askState.turnId, askState.feedback]
  );

  const chips = context ? CHIPS_BOUND : CHIPS_UNBOUND;
  const placeholder = context
    ? `Ask anything about ${context.patientName.split(" ")[0]}…`
    : "Ask about any patient, doctor, or the queue…";

  return (
    <>
      {/* Ambient pill */}
      <button
        aria-label="Open Pulse co-pilot"
        className={cn(
          "fixed bottom-6 right-6 z-40 flex items-center gap-3 rounded-full border border-white/80 bg-white/80 py-2 pl-2 pr-4 shadow-[0_20px_50px_rgba(15,23,42,0.18)] backdrop-blur-2xl transition-all duration-300",
          "hover:-translate-y-0.5 hover:shadow-[0_26px_60px_rgba(15,23,42,0.24)]",
          "active:scale-[0.98]",
          "ring-1",
          theme.ring,
          open
            ? "pointer-events-none translate-y-3 opacity-0"
            : "translate-y-0 opacity-100"
        )}
        onClick={() => setOpen(true)}
        type="button"
      >
        <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]">
          <Sparkles className="h-4 w-4" />
          <span
            className={cn(
              "absolute -right-0.5 -top-0.5 h-2.5 w-2.5 animate-pulse rounded-full ring-2 ring-white",
              theme.dot
            )}
          />
        </span>
        <span className="flex flex-col items-start leading-tight">
          <span
            className={cn(
              "text-[9px] font-bold uppercase tracking-[0.24em]",
              theme.kicker
            )}
          >
            Pulse
          </span>
          <span className="text-[13px] font-semibold tracking-[-0.01em] text-slate-900">
            {context ? `Ask about ${context.patientName.split(" ")[0]}` : "Ask Pulse"}
          </span>
        </span>
        <span className="ml-1 hidden items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 sm:flex">
          <Kbd>⌘K</Kbd>
        </span>
      </button>

      {/* Overlay + palette, portaled to body */}
      {mounted &&
        createPortal(
          <PulseOverlay onClose={() => setOpen(false)} open={open}>
            <PulseCard
              askState={askState}
              chips={chips}
              context={context}
              hasRecognizer={hasRecognizer}
              inputRef={inputRef}
              listening={listening}
              onAsk={(q) => void askQuestion(q)}
              onClose={() => setOpen(false)}
              onFeedback={(r) => void sendFeedback(r)}
              onStartListening={startListening}
              onStopListening={stopListening}
              phase={phase}
              placeholder={placeholder}
              query={query}
              setQuery={setQuery}
            />
          </PulseOverlay>,
          document.body
        )}
    </>
  );
}

/* ---------------- Overlay (portal) ---------------- */

function PulseOverlay({
  open,
  onClose,
  children
}: {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [rendered, setRendered] = useState(open);

  useEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    const id = window.setTimeout(() => setRendered(false), 320);
    return () => window.clearTimeout(id);
  }, [open]);

  if (!rendered) return null;

  return (
    <div
      aria-modal="true"
      className={cn(
        "fixed inset-0 z-50 transition-opacity duration-300",
        open ? "opacity-100" : "pointer-events-none opacity-0"
      )}
      role="dialog"
    >
      {/* Dim + blur layer — captures outside clicks */}
      <div
        aria-hidden
        className="absolute inset-0 bg-slate-900/20 backdrop-blur-xl"
        onMouseDown={onClose}
      />
      {/* Card wrapper — pointer-events-none so clicks fall through to backdrop */}
      <div className="pointer-events-none relative flex min-h-full items-start justify-center px-4 pt-[14vh] pb-12">
        <div
          className={cn(
            "pointer-events-auto w-full max-w-[680px] transition-all",
            "duration-300 ease-out",
            open
              ? "translate-y-0 scale-100 opacity-100"
              : "translate-y-3 scale-[0.975] opacity-0"
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Card ---------------- */

function PulseCard({
  phase,
  context,
  query,
  setQuery,
  askState,
  inputRef,
  chips,
  onAsk,
  onClose,
  placeholder,
  hasRecognizer,
  listening,
  onStartListening,
  onStopListening,
  onFeedback
}: {
  phase: ThemeKey;
  context: PulseContext;
  query: string;
  setQuery: (v: string) => void;
  askState: AskState;
  inputRef: React.RefObject<HTMLInputElement | null>;
  chips: Chip[];
  onAsk: (q: string) => void;
  onClose: () => void;
  placeholder: string;
  hasRecognizer: boolean;
  listening: boolean;
  onStartListening: () => void;
  onStopListening: () => void;
  onFeedback: (rating: 1 | -1) => void;
}) {
  const theme = PHASE_THEME[phase];
  const profile = formatProfile(context);
  const {
    asking,
    answer,
    trace,
    accumulatedSources,
    citations,
    actions,
    error,
    turnId,
    feedback
  } = askState;

  // During streaming, cite against whatever sources we've gathered so far;
  // after `done`, the backend gives us the filtered citations list.
  const liveSources = useMemo(
    () => (citations.length > 0 ? citations : accumulatedSources),
    [citations, accumulatedSources]
  );
  const hasAnswer = answer.length > 0;
  const showAnswerArea = asking || hasAnswer || trace.length > 0 || Boolean(error);

  return (
    <div className="relative overflow-hidden rounded-[36px] border border-white bg-white/90 p-7 shadow-[0_40px_90px_-20px_rgba(15,23,42,0.35)] backdrop-blur-2xl">
      {/* Top-left contextual aura */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute -left-20 -top-28 h-64 w-64 rounded-full bg-gradient-to-br opacity-70 blur-3xl",
          theme.auraFrom,
          "to-transparent"
        )}
      />

      {/* Header */}
      <div className="relative flex items-start justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.22)]">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="space-y-0.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">
              Pulse · Clinical Co-pilot
            </p>
            <p
              className={cn(
                "text-[11px] font-bold uppercase tracking-[0.2em]",
                theme.kicker
              )}
            >
              {phase === "serving"
                ? "In consultation"
                : phase === "waiting"
                  ? "Next in line"
                  : "Clinic view"}
            </p>
          </div>
        </div>
        <button
          aria-label="Close Pulse"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white/70 text-slate-500 transition hover:bg-white hover:text-slate-900"
          onClick={onClose}
          type="button"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Patient chip */}
      {context && (
        <div className="relative mt-5 flex items-center gap-4 rounded-[22px] border border-white bg-gradient-to-br from-white to-slate-50/80 p-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-[18px] bg-slate-900 text-[22px] font-black text-white shadow-[0_12px_28px_rgba(15,23,42,0.24)]">
            {initialOf(context.patientName)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[24px] font-extrabold leading-[1.05] tracking-[-0.03em] text-slate-900">
              {context.patientName}
            </p>
            {profile && (
              <p className="mt-0.5 text-[13px] font-bold tracking-[-0.01em] text-slate-400">
                {profile}
              </p>
            )}
          </div>
          <span
            className={cn(
              "inline-flex shrink-0 items-center rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em]",
              theme.chip
            )}
          >
            <span
              className={cn(
                "mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle",
                theme.dot
              )}
            />
            {phase === "serving" ? "Serving" : "Waiting"}
          </span>
        </div>
      )}

      {/* Input */}
      <div className="relative mt-5">
        <div className="flex items-center gap-2 rounded-[22px] border border-slate-200 bg-white/90 py-2 pl-5 pr-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
          <Sparkles className="h-4 w-4 shrink-0 text-slate-400" />
          <input
            className="h-10 flex-1 bg-transparent text-[15px] font-medium tracking-[-0.01em] text-slate-900 placeholder:text-slate-400 focus:outline-none"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (query.trim()) onAsk(query);
              }
            }}
            placeholder={placeholder}
            ref={inputRef}
            value={query}
          />
          {hasRecognizer && (
            <button
              aria-label={listening ? "Stop listening" : "Start voice input"}
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition",
                listening
                  ? "border-rose-200 bg-rose-50 text-rose-600"
                  : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              )}
              onClick={listening ? onStopListening : onStartListening}
              type="button"
            >
              {listening ? (
                <MicOff className="h-4 w-4" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </button>
          )}
          <button
            className={cn(
              "flex h-10 items-center gap-2 rounded-full bg-slate-900 px-4 text-[11px] font-bold uppercase tracking-[0.2em] text-white transition-all",
              "hover:bg-black active:scale-95 disabled:opacity-40 disabled:hover:bg-slate-900"
            )}
            disabled={!query.trim() || asking}
            onClick={() => onAsk(query)}
            type="button"
          >
            {asking ? "Thinking" : "Ask"}
            <ArrowRight
              className={cn("h-3.5 w-3.5", asking && "animate-pulse")}
            />
          </button>
        </div>
      </div>

      {/* Quick-ask chips */}
      <div className="relative mt-4 flex flex-wrap gap-2">
        {chips.map((c) => (
          <button
            className="group inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-700 transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
            disabled={asking}
            key={c.id}
            onClick={() => {
              setQuery(c.q);
              onAsk(c.q);
            }}
            type="button"
          >
            <span className="text-slate-400 transition group-hover:text-slate-600">
              {c.icon}
            </span>
            {c.label}
          </button>
        ))}
      </div>

      {/* Answer area — tool trace + streamed answer + citations + actions + feedback */}
      {showAnswerArea && (
        <div className="relative mt-6 rounded-[26px] border border-slate-100 bg-gradient-to-b from-slate-50/80 to-white p-5">
          {/* Tool trace strip — the "thinking" visualization */}
          {trace.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-1.5">
              {trace.map((step, i) => (
                <TraceChip key={`${step.tool}-${i}`} step={step} />
              ))}
            </div>
          )}

          {/* Streamed answer */}
          {hasAnswer ? (
            <p className="text-[17px] font-semibold leading-[1.4] tracking-[-0.01em] text-slate-900">
              {renderAnswerTokens(answer, liveSources)}
              {asking && (
                <span className="ml-0.5 inline-block h-[1.05em] w-[2px] -translate-y-[1px] animate-pulse rounded-sm bg-slate-900 align-middle" />
              )}
            </p>
          ) : asking ? (
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
                    theme.dot
                  )}
                />
                <span
                  className={cn(
                    "relative inline-flex h-2 w-2 rounded-full",
                    theme.dot
                  )}
                />
              </span>
              <p className="text-[13px] font-semibold tracking-[-0.01em] text-slate-500">
                Pulse is thinking…
              </p>
            </div>
          ) : error ? (
            <p className="text-[14px] font-semibold text-rose-600">{error}</p>
          ) : null}

          {/* Sources list */}
          {citations.length > 0 && !asking && (
            <div className="mt-4 space-y-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.3em] text-slate-400">
                Sources
              </p>
              <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {citations.map((src) => (
                  <CitationCard key={src.id} source={src} />
                ))}
              </div>
            </div>
          )}

          {/* Actions */}
          {actions.length > 0 && !asking && (
            <div className="mt-4 flex flex-wrap gap-2">
              {actions.map((a) => {
                const inner = (
                  <>
                    {a.kind === "call" && <Phone className="h-3.5 w-3.5" />}
                    {a.kind === "checkin" && (
                      <UserPlus className="h-3.5 w-3.5" />
                    )}
                    {a.label}
                  </>
                );
                if (a.href) {
                  return (
                    <a
                      className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
                      href={a.href}
                      key={a.label}
                    >
                      {inner}
                    </a>
                  );
                }
                return (
                  <button
                    className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.15em] text-slate-800 transition hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50"
                    key={a.label}
                    type="button"
                  >
                    {inner}
                  </button>
                );
              })}
            </div>
          )}

          {/* Feedback row */}
          {hasAnswer && !asking && turnId && (
            <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
                Helpful?
              </span>
              <button
                aria-label="Helpful"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border transition disabled:opacity-60",
                  feedback === 1
                    ? "border-emerald-200 bg-emerald-50 text-emerald-600"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                )}
                disabled={feedback !== null}
                onClick={() => onFeedback(1)}
                type="button"
              >
                <ThumbsUp className="h-3.5 w-3.5" />
              </button>
              <button
                aria-label="Not helpful"
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-full border transition disabled:opacity-60",
                  feedback === -1
                    ? "border-rose-200 bg-rose-50 text-rose-600"
                    : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
                )}
                disabled={feedback !== null}
                onClick={() => onFeedback(-1)}
                type="button"
              >
                <ThumbsDown className="h-3.5 w-3.5" />
              </button>
              {feedback !== null && (
                <span className="text-[10px] font-semibold tracking-[-0.01em] text-slate-500">
                  Thanks — Pulse will learn from this.
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="relative mt-6 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
        <span className="flex items-center gap-1.5">
          <Kbd>Enter</Kbd> to ask
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>Esc</Kbd> close · <Kbd>⌘K</Kbd> toggle
        </span>
      </div>
    </div>
  );
}
