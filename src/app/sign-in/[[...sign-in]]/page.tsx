import { SignIn } from "@clerk/nextjs";
import { ShieldCheck, Stethoscope, TimerReset } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

const signInBenefits = [
  {
    title: "Reception flow",
    description: "Move quickly between walk-ins, queue state, and priority overrides."
  },
  {
    title: "Doctor readiness",
    description: "Keep the next-patient view and clinic context one click away."
  },
  {
    title: "Foundation access",
    description: "Use the Phase 1 environment with local Supabase and GlitchTip already wired."
  }
];

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ redirect_url?: string }>;
}) {
  const params = await searchParams;
  const redirectUrl = params.redirect_url ?? "/";

  return (
    <main className="mx-auto grid min-h-screen max-w-6xl gap-8 px-6 py-10 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:px-12">
      <section className="flex flex-col justify-between gap-8">
        <Card className="qcare-hero">
          <CardHeader className="space-y-4">
            <p className="qcare-kicker text-[11px]">
              QCare Access
            </p>
            <CardTitle className="max-w-xl text-4xl leading-tight sm:text-5xl">
              Sign in to enter the clinic operating console.
            </CardTitle>
            <CardDescription className="max-w-lg text-base text-muted-foreground">
              Reception, doctor, and clinic-admin paths all start here. We keep
              the sign-in experience simple so staff can get back to the queue
              fast.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="qcare-panel-soft p-4">
              <ShieldCheck className="h-6 w-6 text-primary" />
              <p className="mt-3 text-sm font-semibold">Secure staff access</p>
            </div>
            <div className="qcare-panel-soft p-4">
              <TimerReset className="h-6 w-6 text-primary" />
              <p className="mt-3 text-sm font-semibold">Fast local testing</p>
            </div>
            <div className="qcare-panel-soft p-4">
              <Stethoscope className="h-6 w-6 text-primary" />
              <p className="mt-3 text-sm font-semibold">Clinic-first workflow</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {signInBenefits.map((item) => (
            <Card key={item.title} className="qcare-panel-soft">
              <CardHeader className="space-y-2">
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="space-y-2">
            <CardTitle>Team sign in</CardTitle>
            <CardDescription>
              Continue to QCare and return to your destination after
              authentication.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="qcare-panel-soft rounded-2xl p-3">
              <SignIn
                path="/sign-in"
                routing="path"
                forceRedirectUrl={redirectUrl}
                signUpUrl="/sign-up"
                appearance={{
                  elements: {
                    card: "shadow-none border-0 bg-transparent",
                    rootBox: "w-full",
                    headerTitle: "hidden",
                    headerSubtitle: "hidden",
                    socialButtonsBlockButton:
                      "rounded-xl border border-border bg-white text-foreground shadow-none h-9 text-[13px]",
                    formButtonPrimary:
                      "rounded-full border border-[#4f46e5]/45 bg-[linear-gradient(135deg,#6366f1_0%,#4f46e5_55%,#4338ca_100%)] text-[hsl(var(--primary-foreground))] shadow-[0_1px_2px_rgba(16,24,40,0.06),0_12px_24px_-12px_rgba(79,70,229,0.65)] h-10 text-[13px] hover:brightness-105",
                    formFieldInput:
                      "rounded-xl border border-input bg-white text-foreground h-9 text-[13px]",
                    footerActionLink: "text-primary hover:text-primary/80"
                  }
                }}
              />
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
