"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";

export function JoinCodeForm() {
  const router = useRouter();
  const [code, setCode] = useState("");

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (!code.trim()) {
          return;
        }

        router.push(`/join/${code.trim().toUpperCase()}`);
      }}
    >
      <label className="grid gap-2 text-sm">
        <span className="font-medium">Invite code</span>
        <input
          className="h-12 rounded-2xl border border-input bg-white px-4 uppercase tracking-[0.25em]"
          maxLength={6}
          onChange={(event) => setCode(event.target.value)}
          placeholder="ABC12X"
          value={code}
        />
      </label>
      <Button type="submit">Continue</Button>
    </form>
  );
}
