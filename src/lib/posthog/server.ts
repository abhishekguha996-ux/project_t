import { analyticsEvents } from "@/lib/posthog/events";

export function getBootDiagnosticsPayload() {
  return {
    event: analyticsEvents.bootCheck,
    at: new Date().toISOString()
  };
}
