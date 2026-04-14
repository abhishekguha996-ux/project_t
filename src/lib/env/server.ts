import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional()
);
const optionalEmail = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().email().optional()
);

const serverEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url(),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_DB_URL: z.string().min(1).optional(),
  RESEND_API_KEY: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().optional()
  ),
  QCARE_INVITE_FROM_EMAIL: optionalEmail,
  QCARE_INVITE_REPLY_TO_EMAIL: optionalEmail,
  GLITCHTIP_DSN: z.string().optional(),
  NEXT_PUBLIC_GLITCHTIP_DSN: z.string().optional(),
  GLITCHTIP_SECURITY_ENDPOINT: optionalUrl,
  NEXT_PUBLIC_GLITCHTIP_SECURITY_ENDPOINT: optionalUrl,
  POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_KEY: z.string().optional(),
  NEXT_PUBLIC_POSTHOG_HOST: optionalUrl.default("https://us.i.posthog.com"),
  QCARE_DEFAULT_CLINIC_ID: z.string().uuid().optional(),
  QCARE_DEFAULT_DOCTOR_ID: z.string().uuid().optional()
});

let cachedEnv: z.infer<typeof serverEnvSchema> | null = null;

export function getServerEnv() {
  if (cachedEnv) {
    return cachedEnv;
  }

  const parsed = serverEnvSchema.safeParse(process.env);

  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid server environment variables:\n${formatted}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
