import * as Sentry from "@sentry/nextjs";

export function initSentry(options?: Partial<Sentry.NodeOptions>) {
  if (Sentry.getClient()) {
    return;
  }

  const dsn =
    process.env.GLITCHTIP_DSN ?? process.env.NEXT_PUBLIC_GLITCHTIP_DSN;
  const tunnel =
    process.env.GLITCHTIP_SECURITY_ENDPOINT ??
    process.env.NEXT_PUBLIC_GLITCHTIP_SECURITY_ENDPOINT;

  Sentry.init({
    dsn,
    tunnel,
    tracesSampleRate: 0.1,
    debug: false,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
    initialScope: {
      tags: {
        monitor_provider: "glitchtip",
        app_name: "qcare"
      }
    },
    ...options
  });
}
