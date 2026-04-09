import { initSentry } from "@/lib/observability/sentry";

export async function register() {
  initSentry();
}
