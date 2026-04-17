import { SignUp } from "@clerk/nextjs";
import { ClipboardCheck, Hospital, UserRoundPlus } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";

const onboardingPoints = [
  {
    title: "Invite-aware access",
    description: "Your clinic invite determines the role and clinic assignment."
  },
  {
    title: "Fast desktop setup",
    description: "Create your account once and keep using the same workstation."
  },
  {
    title: "Practice-ready routing",
    description: "Doctors and reception staff land in their own workspace automatically."
  }
];

export default async function SignUpPage({
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
              Staff onboarding
            </p>
            <CardTitle className="max-w-xl text-4xl leading-tight sm:text-5xl">
              Create your QCare account and enter the clinic workspace.
            </CardTitle>
            <CardDescription className="max-w-lg text-base text-muted-foreground">
              This sign-up flow is invite-backed, so the system already knows
              whether you should land as a receptionist or doctor.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="qcare-panel-soft p-4">
              <UserRoundPlus className="h-6 w-6 text-primary" />
              <p className="mt-3 text-sm font-semibold">Account creation</p>
            </div>
            <div className="qcare-panel-soft p-4">
              <ClipboardCheck className="h-6 w-6 text-primary" />
              <p className="mt-3 text-sm font-semibold">Role assignment</p>
            </div>
            <div className="qcare-panel-soft p-4">
              <Hospital className="h-6 w-6 text-primary" />
              <p className="mt-3 text-sm font-semibold">Clinic access</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {onboardingPoints.map((item) => (
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
            <CardTitle>Create staff account</CardTitle>
            <CardDescription>
              Finish sign-up and we will return you to your clinic invite flow.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="qcare-panel-soft rounded-2xl p-3">
              <SignUp
                path="/sign-up"
                routing="path"
                forceRedirectUrl={redirectUrl}
                signInUrl="/sign-in"
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
