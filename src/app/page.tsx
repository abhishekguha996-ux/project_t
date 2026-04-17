import Link from "next/link";
import { Activity, ShieldCheck, Waves } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { getServerEnv } from "@/lib/env/server";

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
            <p className="qcare-kicker text-[11px]">
              QCare / Phase 1
            </p>
            <CardTitle className="max-w-2xl text-4xl leading-tight sm:text-5xl">
              Foundation for a clinic-first queue platform that can replace the paper register.
            </CardTitle>
            <CardDescription className="max-w-2xl text-base text-muted-foreground">
              This workspace is intentionally narrow: infrastructure, schema,
              auth, shared types, and observability. The patient and staff
              experiences build on top of this in the next phases.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href="/reception">Open Reception Placeholder</Link>
            </Button>
            <Button asChild>
              <Link href="/doctor">Open Doctor Placeholder</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/admin">Open Admin Onboarding</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/checkin/${defaultCheckinClinicId}` as never}>
                Open QR Check-in
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="qcare-panel-soft">
          <CardHeader>
            <CardTitle>Phase 1 checklist</CardTitle>
            <CardDescription>
              What this repo now owns before any feature-specific UI begins.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
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
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[linear-gradient(135deg,#eef2ff_0%,#f8faff_100%)] text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <CardTitle>{pillar.title}</CardTitle>
                <CardDescription>{pillar.description}</CardDescription>
              </CardHeader>
            </Card>
          );
        })}
      </section>
    </main>
  );
}
