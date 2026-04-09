"use client";

import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { useEffect, useState } from "react";
import { create } from "zustand";

import { initPostHog } from "@/lib/posthog/client";
import { analyticsEvents } from "@/lib/posthog/events";

type AppStore = {
  bootedAt: string | null;
  setBootedAt: (bootedAt: string) => void;
};

const useAppStore = create<AppStore>((set) => ({
  bootedAt: null,
  setBootedAt: (bootedAt) => set({ bootedAt })
}));

function AnalyticsBootTracker() {
  const { userId } = useAuth();
  const setBootedAt = useAppStore((state) => state.setBootedAt);

  useEffect(() => {
    posthog.capture(analyticsEvents.appLoaded, {
      source: "root-layout"
    });
    setBootedAt(new Date().toISOString());
  }, [setBootedAt]);

  useEffect(() => {
    if (userId) {
      posthog.capture(analyticsEvents.signedIn, { userId });
    } else {
      posthog.capture(analyticsEvents.signedOut);
    }
  }, [userId]);

  return null;
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const posthogClient = initPostHog();
  const hasClerk = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

  const appTree = (
    <PostHogProvider client={posthogClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </PostHogProvider>
  );

  if (!hasClerk) {
    return appTree;
  }

  return (
    <ClerkProvider>
      <PostHogProvider client={posthogClient}>
        <QueryClientProvider client={queryClient}>
          <AnalyticsBootTracker />
          {children}
        </QueryClientProvider>
      </PostHogProvider>
    </ClerkProvider>
  );
}
