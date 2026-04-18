"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { cn } from "@/lib/utils/cn";
import type { CheckoutStage, TokenStatus } from "@/lib/utils/types";

type TrackPayload = {
  tokenId: string;
  tokenNumber: number;
  status: TokenStatus;
  checkedInAt: string;
  servingStartedAt: string | null;
  completedAt: string | null;
  patientName: string;
  patientPhone: string | null;
  doctorName: string;
  doctorSpecialty: string | null;
  doctorRoom: string | null;
  checkoutStage: CheckoutStage | null;
  checkoutUpdatedAt: string | null;
  complaint: string | null;
  queue: {
    position: number | null;
    ahead: number;
    activeCount: number;
    estimatedWaitMinutes: number;
  };
  now: string;
};

function waitingMessage(waitMins: number) {
  if (waitMins <= 0) {
    return "You're next, please head to reception.";
  }
  if (waitMins <= 10) {
    return "You're almost there.";
  }
  if (waitMins <= 40) {
    return "You're in line. We'll keep this updated.";
  }
  if (waitMins <= 99) {
    return "Wait is longer than usual.";
  }
  return "High queue right now. We'll notify you when your turn is close.";
}

function statusMessage(status: TokenStatus, waitMins: number, checkoutStage: CheckoutStage | null) {
  if (status === "waiting") {
    return waitingMessage(waitMins);
  }
  if (status === "serving") {
    return "Please proceed to the doctor now.";
  }
  if (status === "complete") {
    if (checkoutStage === "payment_done") {
      return "Payment confirmed. Please follow reception guidance for next instructions.";
    }
    if (checkoutStage === "visit_closed") {
      return "You're all set. Thank you for visiting QCare.";
    }
    return "Your consultation is complete.";
  }
  if (status === "skipped") {
    return "Please check with reception to rejoin the queue.";
  }
  return "Your slot is on temporary hold. Please inform reception when you return.";
}

function initialsFromName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    return "QC";
  }
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function formatPatientName(name: string | null | undefined) {
  const normalized = (name ?? "").trim();
  if (!normalized) {
    return "Patient";
  }

  const cleaned = normalized.replace(/\s+/g, " ");
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length === 0) {
    return "Patient";
  }

  const honorific = parts[0]?.replace(/\./g, "").toLowerCase();
  const honorifics = new Set([
    "mr",
    "mrs",
    "ms",
    "miss",
    "dr",
    "doctor",
    "prof",
    "sir",
    "shri",
    "smt"
  ]);
  if (honorifics.has(honorific) && parts.length > 1) {
    return parts[1] ?? "Patient";
  }

  return parts[0] ?? "Patient";
}

function truncateGraphemes(value: string, maxGraphemes: number) {
  const graphemes = Array.from(value);
  if (graphemes.length <= maxGraphemes) {
    return value;
  }
  return `${graphemes.slice(0, Math.max(1, maxGraphemes - 1)).join("")}\u2026`;
}

function ordinal(value: number) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return `${value}st`;
  if (mod10 === 2 && mod100 !== 12) return `${value}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${value}rd`;
  return `${value}th`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatLongWait(waitMins: number) {
  const hours = Math.floor(waitMins / 60);
  const mins = waitMins % 60;
  if (mins === 0) {
    return `${hours}h+`;
  }
  return `${hours}h ${String(mins).padStart(2, "0")}m+`;
}

function completionNextStep(stage: CheckoutStage | null) {
  if (stage === "payment_done") {
    return {
      badge: "Payment confirmed",
      title: "Payment received.",
      description: "You're all set at billing. Please follow reception guidance for next instructions."
    };
  }
  if (stage === "pharmacy_pickup") {
    return {
      badge: "Pharmacy pickup",
      title: "Please collect medicines from pharmacy.",
      description: "Carry your prescription and token number for faster pickup."
    };
  }
  if (stage === "referred_for_lab") {
    return {
      badge: "Referred for lab",
      title: "Please proceed to the lab desk.",
      description: "Your lab referral is ready and reception can guide you to the next counter."
    };
  }
  if (stage === "visit_closed") {
    return {
      badge: "Visit closed",
      title: "You're all set.",
      description: "Your visit is complete. You can safely close this page now."
    };
  }
  return {
    badge: "Awaiting payment",
    title: "Please proceed to billing desk.",
    description: "Reception will help complete payment and finish your visit checkout."
  };
}

function completionHeroSubtitle(stage: CheckoutStage | null) {
  if (stage === "payment_done") {
    return "Reception will guide your final instructions.";
  }
  if (stage === "visit_closed") {
    return "Thank you for visiting QCare.";
  }
  if (stage === "pharmacy_pickup") {
    return "Please collect medicines from the pharmacy counter.";
  }
  if (stage === "referred_for_lab") {
    return "Please proceed to the lab desk for your tests.";
  }
  return "Your consultation is complete.";
}

function completionTone(stage: CheckoutStage | null) {
  if (stage === "payment_done") {
    return {
      surfaceClass: "bg-[#F3F7FF]",
      auraClass:
        "qcare-breathe h-[900px] w-[900px] top-[78%] left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,rgba(59,130,246,0.24)_0%,rgba(147,197,253,0.42)_34%,rgba(243,247,255,0.88)_58%,rgba(243,247,255,0.34)_74%,rgba(243,247,255,0)_88%)]",
      panelClass: "border-[#C8DAFC] bg-[linear-gradient(145deg,#FAFCFF_0%,#EEF4FF_60%,#FFFFFF_100%)]",
      badgeClass: "bg-[#DBEAFE] text-[#1D4ED8]",
      heroChipClass: "bg-[linear-gradient(135deg,#E8F0FF_0%,#DCE8FF_100%)] text-[#1E40AF]",
      transitionOverlayClass:
        "bg-[radial-gradient(circle_at_50%_78%,rgba(59,130,246,0.32)_0%,rgba(147,197,253,0.3)_26%,rgba(243,247,255,0)_68%)]"
    };
  }
  if (stage === "pharmacy_pickup") {
    return {
      surfaceClass: "bg-[#F0F9FF]",
      auraClass:
        "qcare-breathe h-[860px] w-[860px] top-[78%] left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,rgba(14,165,233,0.24)_0%,rgba(186,230,253,0.54)_34%,rgba(240,249,255,0.82)_56%,rgba(240,249,255,0.28)_74%,rgba(240,249,255,0)_86%)]",
      panelClass: "border-[#BAE6FD] bg-[linear-gradient(140deg,#F0F9FF_0%,#E0F2FE_50%,#FFFFFF_100%)]",
      badgeClass: "bg-[#E0F2FE] text-[#0369A1]",
      heroChipClass: "bg-[linear-gradient(135deg,#E0F2FE_0%,#BAE6FD_100%)] text-[#0369A1]",
      transitionOverlayClass:
        "bg-[radial-gradient(circle_at_50%_78%,rgba(14,165,233,0.28)_0%,rgba(186,230,253,0.32)_28%,rgba(240,249,255,0)_66%)]"
    };
  }
  if (stage === "referred_for_lab") {
    return {
      surfaceClass: "bg-[#F5F3FF]",
      auraClass:
        "qcare-breathe h-[860px] w-[860px] top-[78%] left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,rgba(139,92,246,0.22)_0%,rgba(221,214,254,0.52)_34%,rgba(245,243,255,0.84)_56%,rgba(245,243,255,0.3)_74%,rgba(245,243,255,0)_86%)]",
      panelClass: "border-[#DDD6FE] bg-[linear-gradient(140deg,#F5F3FF_0%,#EDE9FE_52%,#FFFFFF_100%)]",
      badgeClass: "bg-[#EDE9FE] text-[#6D28D9]",
      heroChipClass: "bg-[linear-gradient(135deg,#EDE9FE_0%,#DDD6FE_100%)] text-[#6D28D9]",
      transitionOverlayClass:
        "bg-[radial-gradient(circle_at_50%_78%,rgba(139,92,246,0.24)_0%,rgba(221,214,254,0.32)_28%,rgba(245,243,255,0)_66%)]"
    };
  }
  if (stage === "visit_closed") {
    return {
      surfaceClass: "bg-[#F5F7FB]",
      auraClass:
        "qcare-breathe h-[900px] w-[900px] top-[78%] left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,rgba(148,163,184,0.26)_0%,rgba(191,219,254,0.36)_34%,rgba(245,247,251,0.88)_58%,rgba(245,247,251,0.34)_74%,rgba(245,247,251,0)_88%)]",
      panelClass: "border-[#D7E1EF] bg-[linear-gradient(145deg,#FFFFFF_0%,#F4F8FF_60%,#FFFFFF_100%)]",
      badgeClass: "bg-[#DCE7F5] text-[#4A5D7A]",
      heroChipClass: "bg-[linear-gradient(135deg,#E6EDF7_0%,#DCE7F5_100%)] text-[#3E4C66]",
      transitionOverlayClass:
        "bg-[radial-gradient(circle_at_50%_78%,rgba(148,163,184,0.34)_0%,rgba(191,219,254,0.30)_24%,rgba(245,247,251,0)_68%)]"
    };
  }
  return {
    surfaceClass: "bg-[#FFFBEB]",
    auraClass:
      "qcare-breathe h-[860px] w-[860px] top-[78%] left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,rgba(245,158,11,0.25)_0%,rgba(253,230,138,0.5)_34%,rgba(255,251,235,0.84)_56%,rgba(255,251,235,0.32)_74%,rgba(255,251,235,0)_86%)]",
    panelClass: "border-[#FDE68A] bg-[linear-gradient(140deg,#FFFBEB_0%,#FEF3C7_52%,#FFFFFF_100%)]",
    badgeClass: "bg-[#FEF3C7] text-[#B45309]",
    heroChipClass: "bg-[linear-gradient(135deg,#FEF3C7_0%,#FDE68A_100%)] text-[#B45309]",
    transitionOverlayClass:
      "bg-[radial-gradient(circle_at_50%_78%,rgba(245,158,11,0.28)_0%,rgba(253,230,138,0.32)_28%,rgba(255,251,235,0)_66%)]"
  };
}

export function PatientTrackClient({ tokenId }: { tokenId: string }) {
  const [data, setData] = useState<TrackPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showCompletionTransition, setShowCompletionTransition] = useState(false);
  const previousStatusRef = useRef<TokenStatus | null>(null);
  const previousCheckoutStageRef = useRef<CheckoutStage | null>(null);
  const completionTransitionTimerRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/track/status?tokenId=${encodeURIComponent(tokenId)}`,
        {
          method: "GET",
          cache: "no-store"
        }
      );
      const payload = (await response.json().catch(() => ({}))) as TrackPayload & {
        error?: string;
      };

      if (!response.ok) {
        setError(payload.error ?? "Could not load tracking status.");
        return;
      }

      setError(null);
      setData(payload);
    } catch {
      setError("Could not load tracking status. Please refresh.");
    }
  }, [tokenId]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      window.clearInterval(interval);
    };
  }, [refresh]);

  useEffect(() => {
    const currentStatus = data?.status;
    const currentCheckoutStage = data?.checkoutStage ?? null;
    if (!currentStatus) {
      return;
    }

    const previousStatus = previousStatusRef.current;
    const previousCheckoutStage = previousCheckoutStageRef.current;
    const firstCompletePaint = currentStatus === "complete" && previousStatus === null;
    const becameComplete = currentStatus === "complete" && previousStatus && previousStatus !== "complete";
    const movedCompleteStage =
      currentStatus === "complete" &&
      previousStatus === "complete" &&
      previousCheckoutStage !== currentCheckoutStage;

    if (firstCompletePaint || becameComplete || movedCompleteStage) {
      setShowCompletionTransition(true);
      if (completionTransitionTimerRef.current) {
        window.clearTimeout(completionTransitionTimerRef.current);
      }
      completionTransitionTimerRef.current = window.setTimeout(() => {
        setShowCompletionTransition(false);
        completionTransitionTimerRef.current = null;
      }, 1200);
    }
    if (currentStatus !== "complete") {
      setShowCompletionTransition(false);
    }

    previousStatusRef.current = currentStatus;
    previousCheckoutStageRef.current = currentCheckoutStage;
  }, [data?.checkoutStage, data?.status]);

  useEffect(() => {
    return () => {
      if (completionTransitionTimerRef.current) {
        window.clearTimeout(completionTransitionTimerRef.current);
      }
    };
  }, []);

  const status = data?.status ?? "waiting";
  const isWaiting = status === "waiting";
  const isServing = status === "serving";
  const isComplete = status === "complete";
  const isSkipped = status === "skipped";
  const isHoldSlot = status === "stepped_out";
  const waitMins = Math.max(0, data?.queue.estimatedWaitMinutes ?? 0);
  const isReadySoon = isWaiting && waitMins === 0;
  const completionTheme = completionTone(data?.checkoutStage ?? null);

  const surfaceClass = useMemo(() => {
    if (isServing || isReadySoon) {
      return "bg-[#F0FDF4]";
    }
    if (isComplete) {
      return completionTheme.surfaceClass;
    }
    if (isSkipped) {
      return "bg-[#FFF8F7]";
    }
    if (isHoldSlot) {
      return "bg-[#F7F7FF]";
    }
    return "bg-[#FBFBFD]";
  }, [completionTheme.surfaceClass, isComplete, isHoldSlot, isReadySoon, isServing, isSkipped]);

  const auraClass = useMemo(() => {
    if (isServing || isReadySoon) {
      return "qcare-breathe h-[860px] w-[860px] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,rgba(16,185,129,0.24)_0%,rgba(187,247,208,0.5)_34%,rgba(255,255,255,0.9)_60%,rgba(255,255,255,0)_84%)]";
    }
    if (isComplete) {
      return completionTheme.auraClass;
    }
    return "h-[760px] w-[760px] top-[-12%] right-[-12%] bg-[radial-gradient(circle,rgba(99,102,241,0.12)_0%,rgba(255,255,255,0.98)_70%)]";
  }, [completionTheme.auraClass, isComplete, isReadySoon, isServing]);

  const isLongWait = waitMins >= 100;
  const waitDisplay = isLongWait ? formatLongWait(waitMins) : String(waitMins);
  const position = data?.queue.position;
  const ahead = Math.max(0, data?.queue.ahead ?? 0);
  const progressFill =
    ahead === 0 ? 100 : Math.max(8, Math.min(95, Math.round(100 / (ahead + 1))));

  const positionPill = position ? `${ordinal(position)} in line` : "Status updated";
  const positionText =
    ahead === 0
      ? "Please stay nearby; reception will call your token."
      : `${ahead} patient${ahead > 1 ? "s" : ""} ahead of you`;

  const consultingLabel = isServing
    ? data?.doctorRoom
      ? `Proceed to ${data.doctorRoom}`
      : "Proceed to consultation room"
    : `${data?.doctorSpecialty ?? "General Physician"}${data?.doctorRoom ? ` • ${data.doctorRoom}` : ""}`;
  const patientDisplayNameRaw = formatPatientName(data?.patientName);
  const patientDisplayName = truncateGraphemes(patientDisplayNameRaw, 24);
  const heroName = truncateGraphemes(patientDisplayNameRaw, 18);
  const heroNameLength = Array.from(heroName).length;
  const completionStep = completionNextStep(data?.checkoutStage ?? null);
  const completionSubtitle = completionHeroSubtitle(data?.checkoutStage ?? null);
  const showCompletionOverlay = isComplete && showCompletionTransition;
  const isPaymentDone = isComplete && data?.checkoutStage === "payment_done";
  const isVisitClosed = isComplete && data?.checkoutStage === "visit_closed";
  const isCompactComplete = isPaymentDone || isVisitClosed;
  const completeHeroLabel = isVisitClosed
    ? "Visit closed"
    : isPaymentDone
      ? "Payment confirmed"
      : "Consultation complete";
  const heroGreeting = isComplete
    ? patientDisplayNameRaw === "Patient"
      ? "All set"
      : `All set, ${heroName}`
    : patientDisplayNameRaw === "Patient"
      ? "Hello"
      : `Hi, ${heroName}`;
  const heroGreetingClass =
    heroNameLength > 14
      ? "text-[clamp(1.7rem,5.9vw,2.9rem)]"
      : heroNameLength > 10
        ? "text-[clamp(1.95rem,6.6vw,3.5rem)]"
        : "text-[clamp(2.15rem,7.4vw,4.2rem)]";
  const fallbackHeroTitle = null;
  const paymentDoneAt = data?.checkoutUpdatedAt ?? data?.now;

  return (
    <section
      className={cn(
        "relative flex h-[100dvh] items-center justify-center overflow-hidden px-6 py-3 sm:py-4 transition-colors duration-1000",
        surfaceClass
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute z-0 rounded-full transition-all duration-1000",
          auraClass
        )}
      />
      {showCompletionOverlay ? (
        <div
          className={cn(
            "pointer-events-none absolute inset-0 z-[1] qcare-complete-reveal",
            completionTheme.transitionOverlayClass
          )}
        />
      ) : null}

      <div
        className={cn(
          "z-10 w-full max-w-sm",
          isWaiting
            ? "space-y-6 sm:space-y-7"
            : isCompactComplete
              ? "space-y-5 sm:space-y-6"
              : isComplete
                ? "space-y-6 sm:space-y-7"
                : "space-y-8 sm:space-y-10"
        )}
      >
        <div className="flex items-center justify-between opacity-45">
          <span className="text-[10px] font-bold uppercase tracking-[0.3em]">QCare Live</span>
          <span className="text-[10px] font-bold uppercase tracking-[0.28em]">
            Token #{data?.tokenNumber ?? "--"}
          </span>
        </div>

        {error ? (
          <div className="rounded-[32px] border border-[#FECACA] bg-[#FFF1F2] px-6 py-5 text-sm font-medium text-[#B91C1C] shadow-[0_12px_30px_-22px_rgba(185,28,28,0.45)]">
            {error}
          </div>
        ) : null}

        {!data && !error ? (
          <div className="rounded-[32px] border border-[#E2E8F0] bg-white/90 px-6 py-5 text-sm text-[#64748B] shadow-[0_20px_40px_-28px_rgba(15,23,42,0.25)]">
            Loading your live queue status...
          </div>
        ) : null}

        {data ? (
          <>
            <div className={cn("relative text-center", isPaymentDone ? "py-1" : "py-3")}>
              {isWaiting ? (
                <>
                  <p
                    className={cn(
                      "mb-2 text-[10px] font-bold uppercase tracking-[0.2em]",
                      isReadySoon ? "text-[#059669]" : "text-[#4F46E5]"
                    )}
                  >
                    Estimated wait
                  </p>
                  <h1
                    className={cn(
                      "mx-auto max-w-[14ch] text-center font-extrabold leading-[0.98] tracking-[-0.04em] text-[#1A2550]",
                      heroGreetingClass
                    )}
                  >
                    {heroGreeting}
                  </h1>
                  <p className="mx-auto mt-3 max-w-[24ch] text-center text-sm font-semibold leading-tight text-[#6A7283]">
                    {statusMessage(status, waitMins, data?.checkoutStage ?? null)}
                  </p>
                  {isLongWait ? (
                    <p className="mt-4 text-[clamp(2.15rem,7.5vw,3.4rem)] font-extrabold leading-none tracking-[-0.04em] text-[#0B1840] tabular-nums">
                      {waitDisplay}
                    </p>
                  ) : (
                    <div className="mt-4 inline-flex items-end justify-center">
                      <span className="text-[clamp(2.75rem,9.5vw,4.1rem)] font-extrabold leading-none tracking-[-0.05em] text-[#0B1840] tabular-nums">
                        {waitDisplay}
                      </span>
                      <span className="mb-1.5 ml-2 text-2xl font-medium text-[#8A94A8]">min</span>
                    </div>
                  )}
                </>
              ) : null}

              {isServing ? (
                <>
                  <span className="qcare-breathe mb-6 inline-flex items-center rounded-full bg-[linear-gradient(135deg,#DCFCE7_0%,#BBF7D0_100%)] px-4 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#047857]">
                    <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-[#10B981]" />
                    It&apos;s your turn
                  </span>
                  <h1
                    className={cn(
                      "mx-auto max-w-[14ch] text-center font-extrabold leading-[0.98] tracking-[-0.04em] text-[#1A2550]",
                      heroGreetingClass
                    )}
                  >
                    {heroGreeting}
                  </h1>
                  <p className="mx-auto mt-3 max-w-[25ch] text-center text-sm font-semibold leading-tight text-[#5E6C88]">
                    {statusMessage(status, waitMins, data?.checkoutStage ?? null)}
                  </p>
                </>
              ) : null}

              {isComplete ? (
                <>
                  <span
                    className={cn(
                      "mb-5 inline-flex items-center rounded-full px-4 py-1 text-[10px] font-bold uppercase tracking-[0.16em]",
                      !isPaymentDone && "qcare-breathe",
                      completionTheme.heroChipClass
                    )}
                  >
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    {completeHeroLabel}
                  </span>
                  <h1
                    className={cn(
                      "mx-auto max-w-[14ch] text-center font-extrabold leading-[0.98] tracking-[-0.04em] text-[#1A2550]",
                      heroGreetingClass
                    )}
                  >
                    {heroGreeting}
                  </h1>
                  <p className="mt-4 text-sm font-semibold text-[#6A7283]">
                    {completionSubtitle}
                  </p>
                </>
              ) : null}

              {!isWaiting && !isServing && !isComplete ? (
                <>
                  <span
                    className={cn(
                      "mb-5 inline-flex items-center rounded-full px-4 py-1 text-[10px] font-bold uppercase tracking-[0.16em]",
                      isSkipped && "bg-[#FEE2E2] text-[#B91C1C]",
                      isHoldSlot && "bg-[#EDE9FE] text-[#6D28D9]"
                    )}
                  >
                    {isSkipped ? "Action needed" : "Hold slot"}
                  </span>
                  <h1
                    className={cn(
                      "mx-auto max-w-[14ch] text-center font-extrabold leading-[0.98] tracking-[-0.04em] text-[#1A2550]",
                      heroGreetingClass
                    )}
                  >
                    {heroGreeting}
                  </h1>
                  {fallbackHeroTitle ? (
                    <p className="mx-auto mt-3 max-w-[25ch] text-center text-sm font-semibold leading-tight text-[#5E6C88]">
                      {fallbackHeroTitle}
                    </p>
                  ) : null}
                  <p className={cn("text-sm font-semibold text-[#6A7283]", fallbackHeroTitle ? "mt-2" : "mt-3")}>
                    {statusMessage(status, waitMins, data?.checkoutStage ?? null)}
                  </p>
                </>
              ) : null}
            </div>

            {isComplete ? (
              isVisitClosed ? (
                <div
                  className={cn(
                    "space-y-5 rounded-[44px] border p-6 text-center shadow-[0_24px_44px_-30px_rgba(15,23,42,0.35)] backdrop-blur-xl sm:p-8",
                    completionTheme.panelClass
                  )}
                >
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#E6EDF7_0%,#DCE7F5_100%)] text-[#3E4C66] shadow-[0_16px_28px_-20px_rgba(71,85,105,0.45)]">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#5F6E91]">Visit complete</p>
                  <p className="text-2xl font-semibold leading-tight text-[#1E2A47]">{completionStep.title}</p>
                  <p className="mx-auto max-w-[32ch] text-sm font-medium text-[#4E5B75]">{completionStep.description}</p>
                  <div className="rounded-2xl border border-[#D7E1EF] bg-white/78 px-4 py-3 text-left">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#7A88A5]">Visit summary</p>
                    <p className="mt-1 text-sm font-semibold text-[#243252]">
                      Consulted with {data.doctorName}
                    </p>
                    <p className="mt-1 text-xs font-medium text-[#64748B]">Need invoice or records? Reception can help.</p>
                  </div>
                </div>
              ) : isPaymentDone ? (
                <div
                  className={cn(
                    "space-y-4 rounded-[40px] border p-5 text-center shadow-[0_24px_44px_-30px_rgba(15,23,42,0.35)] backdrop-blur-xl sm:space-y-5 sm:p-7",
                    completionTheme.panelClass
                  )}
                >
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(145deg,#E8F0FF_0%,#DCE8FF_100%)] text-[#1E40AF] shadow-[0_16px_28px_-20px_rgba(29,78,216,0.45)]">
                    <CheckCircle2 className="h-6 w-6" />
                  </div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#5A6B8F]">Billing complete</p>
                  <p className="text-[1.9rem] font-semibold leading-tight text-[#1E2A47]">{completionStep.title}</p>
                  <p className="mx-auto max-w-[32ch] text-sm font-medium text-[#4E5B75]">{completionStep.description}</p>
                  <div className="rounded-2xl border border-[#C8DAFC] bg-white/82 px-4 py-2.5 text-left">
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#6A7DA5]">Billing summary</p>
                    <p className="mt-1 text-sm font-semibold text-[#243252]">
                      Paid at {paymentDoneAt ? formatTime(paymentDoneAt) : "recently"}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-[#243252]">Consulted with {data.doctorName}</p>
                    <p className="mt-1 text-xs font-medium text-[#64748B]">Need invoice copy? Reception can help.</p>
                  </div>
                </div>
              ) : (
                <div
                  className={cn(
                    "space-y-4 rounded-[44px] border p-6 shadow-[0_24px_44px_-30px_rgba(15,23,42,0.35)] backdrop-blur-xl sm:p-8",
                    completionTheme.panelClass
                  )}
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#66749A]">Next step</p>
                  <p className="text-2xl font-semibold leading-tight text-[#1E2A47]">{completionStep.title}</p>
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em]",
                      completionTheme.badgeClass
                    )}
                  >
                    {completionStep.badge}
                  </span>
                  <p className="text-sm font-medium text-[#5C667D]">{completionStep.description}</p>
                  <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8B97AD]">
                    Consulted with {data.doctorName}
                  </p>
                </div>
              )
            ) : (
              <div className="space-y-7 rounded-[44px] border border-white bg-white/90 p-6 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.08)] backdrop-blur-xl sm:space-y-8 sm:p-8">
                {isWaiting ? (
                  <div>
                    <div className="mb-4 flex items-center justify-between">
                      <h3 className="text-[11px] font-bold uppercase tracking-tight text-[#8B97AD]">
                        Your position
                      </h3>
                      <span
                        className={cn(
                          "rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide",
                          isReadySoon
                            ? "qcare-breathe bg-[#DCFCE7] text-[#047857]"
                            : "bg-[#EEF2FF] text-[#4F46E5]"
                        )}
                      >
                        {positionPill}
                      </span>
                    </div>
                    <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-[#E8ECF5]">
                      <div
                        className={cn(
                          "h-full rounded-full transition-all duration-500",
                          isReadySoon ? "bg-[#10B981]" : "bg-[#6366F1]"
                        )}
                        style={{ width: `${progressFill}%` }}
                      />
                    </div>
                    <p className="text-center text-[11px] font-bold tracking-tight text-[#8B97AD]">
                      {positionText}
                    </p>
                  </div>
                ) : null}

                {isWaiting ? <div className="h-px w-full bg-[#EEF2F7]" /> : null}

                <div className="flex items-center space-x-5">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0B1840] text-lg font-extrabold text-white shadow-inner">
                    {initialsFromName(data.doctorName)}
                  </div>
                  <div className="flex-1">
                    <p className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8B97AD]">
                      Consulting with
                    </p>
                    <h2 className="text-lg font-bold leading-none text-[#0B1840]">{data.doctorName}</h2>
                    <p className="mt-1.5 text-xs font-medium text-[#6B7280]">
                      {isServing ? (
                        <>
                          Proceed to{" "}
                          <span className="font-bold text-[#059669]">
                            {data.doctorRoom ?? "Consultation Room"}
                          </span>
                        </>
                      ) : (
                        consultingLabel
                      )}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {isWaiting ? (
              <div className="pt-1 text-center">
                <button
                  className={cn(
                    "inline-flex items-center rounded-full border px-6 py-2 text-[10px] font-bold uppercase tracking-[0.16em] transition-all duration-150 hover:-translate-y-[1px] hover:brightness-105",
                    isReadySoon
                      ? "border-[#BBF7D0] bg-[linear-gradient(135deg,#DCFCE7_0%,#F0FDF4_100%)] text-[#047857] shadow-[0_8px_18px_-14px_rgba(16,185,129,0.65)]"
                      : "border-[#E0E7FF] bg-[linear-gradient(135deg,#EEF2FF_0%,#F8FAFF_100%)] text-[#4F46E5] shadow-[0_8px_18px_-14px_rgba(79,70,229,0.7)]"
                  )}
                  type="button"
                >
                  Notify me via SMS
                </button>
              </div>
            ) : null}

            <p className="text-center text-[10px] font-semibold uppercase tracking-[0.16em] text-[#95A0B5]">
              Live update · Last sync {formatTime(data.now)}
            </p>
          </>
        ) : null}
      </div>
    </section>
  );
}
