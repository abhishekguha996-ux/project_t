import Link from "next/link";
import { Activity, ShieldCheck, Waves } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { getServerEnv } from "@/lib/env/server";

const KICKER = "text-[10px] font-bold uppercase tracking-[0.22em] text-[#4F46E5]";
const SECTION_HEADING =
  "text-[10px] font-bold uppercase tracking-[0.22em] text-[#4F46E5]";

const pillars = [
  {
    title: "Clinic-ready groundwork",
    description:
      "Next.js, Tailwind, shadcn/ui, Clerk, Supabase, GlitchTip, and PostHog are organized for the queue workflow to land cleanly in later phases.",
    icon: ShieldCheck
  },
  {
    title: "Data contract first",
    description:
      "The schema, RLS policy pattern, token assignment RPC, and seed data are all defined now so feature work can build on stable primitives.",
    icon: Activity
  },
  {
    title: "Realtime prepared",
    description:
      "Typed Supabase wrappers, analytics hooks, and protected route scaffolding are in place for reception, doctor, and patient flows.",
    icon: Waves
  }
];

export default function HomePage() {
  const env = getServerEnv();
  const defaultCheckinClinicId =
    env.QCARE_DEFAULT_CLINIC_ID ?? "11111111-1111-4111-8111-111111111111";

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-10 sm:px-8 lg:px-12">
      <section className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
        <Card className="qcare-hero">
          <CardHeader className="space-y-4">
            <p className={KICKER}>QCare · Phase 1</p>
            <CardTitle className="max-w-2xl text-4xl font-extrabold leading-[1.05] tracking-[-0.04em] text-[#0B1840] sm:text-5xl">
              Foundation for a clinic-first queue platform that can replace the paper register.
            </CardTitle>
            <CardDescription className="max-w-2xl text-base font-medium text-[#5C667D]">
              This workspace is intentionally narrow: infrastructure, schema,
              auth, shared types, and observability. The patient and staff
              experiences build on top of this in the next phases.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Link
              className="inline-flex h-11 items-center justify-center rounded-full bg-[linear-gradient(135deg,#6366F1_0%,#4F46E5_55%,#4338CA_100%)] px-5 text-[13px] font-bold tracking-[0.01em] text-white shadow-[0_14px_28px_-14px_rgba(79,70,229,0.7)] transition hover:-translate-y-[1px] hover:brightness-105"
              href="/reception"
            >
              Open Reception Cockpit
            </Link>
            <Link
              className="inline-flex h-11 items-center justify-center rounded-full border border-[#C7D2FE] bg-[linear-gradient(135deg,#F5F7FF_0%,#EEF2FF_100%)] px-5 text-[13px] font-bold tracking-[0.01em] text-[#1E3A8A] shadow-[0_10px_22px_-16px_rgba(79,70,229,0.45)] transition hover:-translate-y-[1px] hover:border-[#A5B4FC] hover:bg-[#EEF2FF]"
              href="/doctor"
            >
              Open Doctor Placeholder
            </Link>
            <Link
              className="inline-flex h-11 items-center justify-center rounded-full border border-[#C7D2FE] bg-[linear-gradient(135deg,#F5F7FF_0%,#EEF2FF_100%)] px-5 text-[13px] font-bold tracking-[0.01em] text-[#1E3A8A] shadow-[0_10px_22px_-16px_rgba(79,70,229,0.45)] transition hover:-translate-y-[1px] hover:border-[#A5B4FC] hover:bg-[#EEF2FF]"
              href="/admin"
            >
              Open Admin Onboarding
            </Link>
            <Link
              className="inline-flex h-11 items-center justify-center rounded-full border border-[#C7D2FE] bg-[linear-gradient(135deg,#F5F7FF_0%,#EEF2FF_100%)] px-5 text-[13px] font-bold tracking-[0.01em] text-[#1E3A8A] shadow-[0_10px_22px_-16px_rgba(79,70,229,0.45)] transition hover:-translate-y-[1px] hover:border-[#A5B4FC] hover:bg-[#EEF2FF]"
              href={`/checkin/${defaultCheckinClinicId}` as never}
            >
              Open QR Check-in
            </Link>
          </CardContent>
        </Card>

        <Card className="qcare-panel-soft">
          <CardHeader>
            <p className={SECTION_HEADING}>Checklist</p>
            <CardTitle className="mt-1.5 text-2xl font-extrabold tracking-[-0.03em] text-[#0B1840]">
              Phase 1 scope
            </CardTitle>
            <CardDescription className="text-[#5C667D]">
              What this repo now owns before any feature-specific UI begins.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm font-medium text-[#5C667D]">
            <p>1. App shell and workspace conventions</p>
            <p>2. Supabase schema, RLS, cron, and seed data</p>
            <p>3. Clerk role contract and protected route scaffolding</p>
            <p>4. Shared TypeScript domain model</p>
            <p>5. GlitchTip and PostHog instrumentation baseline</p>
            <p>6. Invite-based staff onboarding and admin-doctor linkage</p>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-5 md:grid-cols-3">
        {pillars.map((pillar) => {
          const Icon = pillar.icon;

          return (
            <Card key={pillar.title} className="qcare-panel-soft">
              <CardHeader className="space-y-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#eef2ff_0%,#f8faff_100%)] text-[#4F46E5] shadow-[0_10px_22px_-16px_rgba(79,70,229,0.45)]">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle className="text-lg font-extrabold tracking-[-0.02em] text-[#0B1840]">
                  {pillar.title}
                </CardTitle>
                <CardDescription className="text-[13px] font-medium leading-relaxed text-[#5C667D]">
                  {pillar.description}
                </CardDescription>
              </CardHeader>
            </Card>
          );
        })}
      </section>
    </main>
  );
}
