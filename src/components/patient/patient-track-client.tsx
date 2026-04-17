"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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

function statusMessage(status: TokenStatus, waitMins: number) {
  if (status === "waiting") {
    return waitingMessage(waitMins);
  }
  if (status === "serving") {
    return "Please proceed to the doctor now.";
  }
  if (status === "complete") {
    return "Your consultation is complete.";
  }
  if (status === "skipped") {
    return "Your turn was missed. Please check with reception.";
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
      badge: "Payment done",
      title: "Payment is recorded.",
      description: "Please follow reception guidance for any final instructions."
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
      title: "All set. Thank you for visiting QCare.",
      description: "You can close this page now. We wish you a speedy recovery."
    };
  }
  return {
    badge: "Awaiting payment",
    title: "Please proceed to billing desk.",
    description: "Reception will help complete payment and finish your visit checkout."
  };
}

export function PatientTrackClient({ tokenId }: { tokenId: string }) {
  const [data, setData] = useState<TrackPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const status = data?.status ?? "waiting";
  const isWaiting = status === "waiting";
  const isServing = status === "serving";
  const isComplete = status === "complete";
  const isSkipped = status === "skipped";
  const isHoldSlot = status === "stepped_out";

  const surfaceClass = useMemo(() => {
    if (isServing) {
      return "bg-[#F0FDF4]";
    }
    if (isComplete) {
      return "bg-[#F8FAFF]";
    }
    if (isSkipped) {
      return "bg-[#FFF8F7]";
    }
    if (isHoldSlot) {
      return "bg-[#F7F7FF]";
    }
    return "bg-[#FBFBFD]";
  }, [isComplete, isHoldSlot, isServing, isSkipped]);

  const auraClass = useMemo(() => {
    if (isServing) {
      return "top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(circle,rgba(16,185,129,0.15)_0%,rgba(255,255,255,0.98)_70%)]";
    }
    if (isComplete) {
      return "top-[8%] left-1/2 -translate-x-1/2 bg-[radial-gradient(circle,rgba(99,102,241,0.14)_0%,rgba(255,255,255,0.98)_70%)]";
    }
    return "top-[-12%] right-[-12%] bg-[radial-gradient(circle,rgba(99,102,241,0.12)_0%,rgba(255,255,255,0.98)_70%)]";
  }, [isComplete, isServing]);

  const waitMins = Math.max(0, data?.queue.estimatedWaitMinutes ?? 0);
  const isLongWait = waitMins >= 100;
  const waitDisplay = isLongWait ? formatLongWait(waitMins) : String(waitMins);
  const position = data?.queue.position;
  const ahead = Math.max(0, data?.queue.ahead ?? 0);
  const progressFill =
    ahead === 0 ? 100 : Math.max(8, Math.min(95, Math.round(100 / (ahead + 1))));

  const positionPill = position ? `${ordinal(position)} in line` : "Status updated";
  const positionText =
    ahead === 0 ? "You are next in line" : `${ahead} patient${ahead > 1 ? "s" : ""} ahead of you`;

  const consultingLabel = isServing
    ? data?.doctorRoom
      ? `Proceed to ${data.doctorRoom}`
      : "Proceed to consultation room"
    : `${data?.doctorSpecialty ?? "General Physician"}${data?.doctorRoom ? ` • ${data.doctorRoom}` : ""}`;
  const completionStep = completionNextStep(data?.checkoutStage ?? null);

  return (
    <section
      className={cn(
        "relative flex min-h-screen items-center justify-center overflow-hidden px-6 py-10 transition-colors duration-700",
        surfaceClass
      )}
    >
      <div
        className={cn(
          "pointer-events-none absolute z-0 h-[640px] w-[640px] rounded-full transition-all duration-1000",
          auraClass
        )}
      />

      <div className="z-10 w-full max-w-sm space-y-10">
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
            <div className="relative py-3 text-center">
              {isWaiting ? (
                <>
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#4F46E5]">
                    Estimated wait
                  </p>
                  {isLongWait ? (
                    <h1 className="mx-auto whitespace-nowrap text-center leading-none text-[84px] font-extrabold tracking-[-0.05em] text-[#0B1840] tabular-nums">
                      {waitDisplay}
                    </h1>
                  ) : (
                    <div className="flex items-end justify-center">
                      <h1 className="min-w-[2.3ch] text-right leading-none text-[118px] font-extrabold tracking-[-0.06em] text-[#0B1840] tabular-nums">
                        {waitDisplay}
                      </h1>
                      <span className="mb-6 ml-2 text-4xl font-medium text-[#8A94A8]">min</span>
                    </div>
                  )}
                  <p className="mx-auto mt-3 max-w-[24ch] text-center text-sm font-semibold leading-tight text-[#6A7283]">
                    {statusMessage(status, waitMins)}
                  </p>
                </>
              ) : null}

              {isServing ? (
                <>
                  <span className="mb-6 inline-flex items-center rounded-full bg-[#D1FAE5] px-4 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[#047857]">
                    <span className="mr-2 h-2 w-2 animate-pulse rounded-full bg-[#10B981]" />
                    It&apos;s your turn
                  </span>
                  <h1 className="leading-none text-[160px] font-extrabold tracking-[-0.07em] text-[#0B1840]">
                    {data.tokenNumber}
                  </h1>
                </>
              ) : null}

              {isComplete ? (
                <>
                  <span className="mb-5 inline-flex items-center rounded-full bg-[#E9EEFF] px-4 py-1 text-[10px] font-bold uppercase tracking-[0.16em] text-[#4338CA]">
                    <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                    Consultation complete
                  </span>
                  <h1 className="leading-none text-[104px] font-extrabold tracking-[-0.05em] text-[#1A2550]">
                    {data.tokenNumber}
                  </h1>
                  <p className="mt-4 text-sm font-semibold text-[#6A7283]">{statusMessage(status, waitMins)}</p>
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
                  <h1 className="leading-none text-[132px] font-extrabold tracking-[-0.06em] text-[#0B1840]">
                    {data.tokenNumber}
                  </h1>
                  <p className="mt-4 text-sm font-semibold text-[#6A7283]">{statusMessage(status, waitMins)}</p>
                </>
              ) : null}
            </div>

            <div className="space-y-8 rounded-[44px] border border-white bg-white/90 p-8 shadow-[0_25px_50px_-12px_rgba(0,0,0,0.08)] backdrop-blur-xl">
              {isWaiting ? (
                <div>
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-[11px] font-bold uppercase tracking-tight text-[#8B97AD]">
                      Your position
                    </h3>
                    <span className="rounded-full bg-[#EEF2FF] px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-[#4F46E5]">
                      {positionPill}
                    </span>
                  </div>
                  <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-[#E8ECF5]">
                    <div
                      className="h-full rounded-full bg-[#6366F1] transition-all duration-500"
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

            {isComplete ? (
              <div className="rounded-3xl border border-[#DBE3FF] bg-[#F8FAFF] p-5 shadow-[0_20px_40px_-28px_rgba(79,70,229,0.45)]">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#66749A]">Next step</p>
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-[#1E2A47]">{completionStep.title}</p>
                  <span className="rounded-full bg-[#EEF2FF] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.12em] text-[#4F46E5]">
                    {completionStep.badge}
                  </span>
                </div>
                <p className="mt-2 text-xs font-medium text-[#6A7283]">{completionStep.description}</p>
              </div>
            ) : null}

            {isWaiting ? (
              <div className="pt-2 text-center">
                <button
                  className="inline-flex items-center rounded-full border border-[#E0E7FF] bg-[linear-gradient(135deg,#EEF2FF_0%,#F8FAFF_100%)] px-6 py-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#4F46E5] shadow-[0_8px_18px_-14px_rgba(79,70,229,0.7)] transition-all duration-150 hover:-translate-y-[1px] hover:brightness-105"
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
