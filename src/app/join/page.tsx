import Link from "next/link";

import { JoinCodeForm } from "@/components/join/join-code-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function JoinPage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-5xl gap-8 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="flex flex-col justify-between gap-6">
        <Card className="qcare-hero">
          <CardHeader>
            <p className="qcare-kicker">Staff join</p>
            <CardTitle className="text-4xl leading-tight">
              Join your clinic workspace with a staff invite.
            </CardTitle>
            <CardDescription className="text-base text-muted-foreground">
              Paste the invite code your clinic admin shared with you, or open
              the invite link directly from WhatsApp or email.
            </CardDescription>
          </CardHeader>
        </Card>
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="qcare-panel-soft">
            <CardHeader>
              <CardTitle className="text-base">Invite link</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              If you received a full link, opening it will take you straight to
              your clinic invite.
            </CardContent>
          </Card>
          <Card className="qcare-panel-soft">
            <CardHeader>
              <CardTitle className="text-base">Manual backup</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              If the admin tells you the code verbally, type it here and
              continue.
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Enter invite code</CardTitle>
            <CardDescription>
              Six characters, uppercase letters and numbers.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <JoinCodeForm />
            <Button asChild variant="ghost">
              <Link href={"/sign-in" as never}>
                Already have an account? Sign in
              </Link>
            </Button>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
