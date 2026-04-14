"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function AcceptInviteClient({ code }: { code: string }) {
  const router = useRouter();
  const [state, setState] = useState<{
    status: "loading" | "success" | "error";
    message: string;
  }>({
    status: "loading",
    message: "Joining clinic workspace..."
  });

  useEffect(() => {
    let active = true;

    async function run() {
      const response = await fetch("/api/invites/accept", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ code })
      });

      const payload = (await response.json()) as {
        ok?: boolean;
        destination?: string;
        error?: string;
      };

      if (!active) {
        return;
      }

      if (!response.ok || !payload.ok || !payload.destination) {
        setState({
          status: "error",
          message: payload.error ?? "We could not finish accepting this invite."
        });
        return;
      }

      setState({
        status: "success",
        message: "Invite accepted. Redirecting to your workspace..."
      });

      window.setTimeout(() => {
        router.replace((payload.destination ?? "/") as never);
      }, 1200);
    }

    void run();

    return () => {
      active = false;
    };
  }, [code, router]);

  return (
    <Card className="w-full max-w-xl bg-card/90">
      <CardHeader>
        <CardTitle>
          {state.status === "loading"
            ? "Preparing your workspace"
            : state.status === "success"
              ? "Welcome to QCare"
              : "Invite issue"}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        {state.message}
        {state.status === "error" ? (
          <div className="mt-4">
            <Button asChild type="button" variant="outline">
              <Link href={`/join/${code}`}>Back to invite</Link>
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
