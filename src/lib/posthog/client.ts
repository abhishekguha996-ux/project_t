"use client";

import posthog from "posthog-js";

let initialized = false;

export function initPostHog() {
  if (initialized) {
    return posthog;
  }

  const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const posthogHost =
    process.env.NEXT_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

  if (!posthogKey) {
    return posthog;
  }

  posthog.init(posthogKey, {
    api_host: posthogHost,
    person_profiles: "identified_only",
    capture_pageview: false,
    capture_pageleave: true,
    loaded: () => {
      initialized = true;
    }
  });

  return posthog;
}
