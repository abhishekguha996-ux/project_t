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
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-10 px-6 py-10 sm:px-8 lg:px-12">
      <section className="grid gap-6 lg:grid-cols-[1.35fr_0.9fr]">
        <Card className="overflow-hidden border-primary/20 bg-[linear-gradient(135deg,rgba(19,78,74,0.96),rgba(26,95,90,0.88))] text-primary-foreground">
          <CardHeader className="space-y-4">
            <p className="text-sm uppercase tracking-[0.25em] text-primary-foreground/70">
              QCare / Phase 1
            </p>
            <CardTitle className="max-w-2xl text-4xl leading-tight sm:text-5xl">
              Foundation for a clinic-first queue platform that can replace the paper register.
            </CardTitle>
            <CardDescription className="max-w-2xl text-base text-primary-foreground/80">
              This workspace is intentionally narrow: infrastructure, schema,
              auth, shared types, and observability. The patient and staff
              experiences build on top of this in the next phases.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20">
              <Link href="/reception">Open Reception Placeholder</Link>
            </Button>
            <Button asChild className="bg-accent text-accent-foreground hover:bg-accent/90">
              <Link href="/doctor">Open Doctor Placeholder</Link>
            </Button>
            <Button asChild variant="outline" className="border-white/30 bg-white/10 text-white hover:bg-white/20">
              <Link href="/admin">Open Admin Onboarding</Link>
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-card/80">
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
            <Card key={pillar.title} className="bg-card/75">
              <CardHeader className="space-y-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-primary">
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
