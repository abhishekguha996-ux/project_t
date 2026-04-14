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
        <Card className="overflow-hidden border-primary/20 bg-[linear-gradient(160deg,rgba(19,78,74,0.97),rgba(27,111,103,0.88))] text-primary-foreground">
          <CardHeader className="space-y-4">
            <p className="text-sm uppercase tracking-[0.25em] text-primary-foreground/70">
              Staff onboarding
            </p>
            <CardTitle className="max-w-xl text-4xl leading-tight sm:text-5xl">
              Create your QCare account and enter the clinic workspace.
            </CardTitle>
            <CardDescription className="max-w-lg text-base text-primary-foreground/80">
              This sign-up flow is invite-backed, so the system already knows
              whether you should land as a receptionist or doctor.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-3xl border border-white/15 bg-white/10 p-4">
              <UserRoundPlus className="h-6 w-6 text-white" />
              <p className="mt-3 text-sm font-semibold">Account creation</p>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/10 p-4">
              <ClipboardCheck className="h-6 w-6 text-white" />
              <p className="mt-3 text-sm font-semibold">Role assignment</p>
            </div>
            <div className="rounded-3xl border border-white/15 bg-white/10 p-4">
              <Hospital className="h-6 w-6 text-white" />
              <p className="mt-3 text-sm font-semibold">Clinic access</p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {onboardingPoints.map((item) => (
            <Card key={item.title} className="bg-card/75">
              <CardHeader className="space-y-2">
                <CardTitle className="text-base">{item.title}</CardTitle>
                <CardDescription>{item.description}</CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      </section>

      <section className="flex items-center justify-center">
        <Card className="w-full max-w-md bg-card/90">
          <CardHeader className="space-y-2">
            <CardTitle>Create staff account</CardTitle>
            <CardDescription>
              Finish sign-up and we will return you to your clinic invite flow.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-2">
            <div className="rounded-[1.25rem] border border-border/70 bg-background/80 p-3">
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
                      "rounded-full border border-border bg-card text-foreground shadow-none",
                    formButtonPrimary:
                      "rounded-full bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))] shadow-none hover:bg-[hsl(var(--primary)/0.9)]",
                    formFieldInput:
                      "rounded-2xl border border-input bg-card text-foreground",
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
