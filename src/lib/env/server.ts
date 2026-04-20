import { z } from "zod";

const optionalUrl = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().url().optional()
);
const optionalEmail = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().email().optional()
);
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional()
);
const optionalBooleanWithDefault = (defaultValue: boolean) =>
  z.preprocess((value) => {
    if (value === "" || value === undefined) {
      return defaultValue;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      return value.toLowerCase() === "true";
    }
    return defaultValue;
  }, z.boolean());
const optionalNotificationMode = z.preprocess(
  (value) => (value === "" || value === undefined ? "dry_run" : value),
  z.enum(["live", "dry_run"])
);
const optionalIntWithDefault = (defaultValue: number) =>
  z.preprocess((value) => {
    if (value === "" || value === undefined) {
      return defaultValue;
    }
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : defaultValue;
    }
    return defaultValue;
  }, z.number().int().min(1).max(240));

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
  TWILIO_ACCOUNT_SID: optionalString,
  TWILIO_AUTH_TOKEN: optionalString,
  QCARE_WHATSAPP_FROM: optionalString,
  QCARE_SMS_FROM: optionalString,
  QCARE_NOTIFICATIONS_ENABLED: optionalBooleanWithDefault(true),
  QCARE_NOTIFICATION_MODE: optionalNotificationMode,
  QCARE_DEFAULT_PHONE_COUNTRY_CODE: optionalString.default("+91"),
  QCARE_DEFAULT_DOCTOR_PAUSE_MINUTES: optionalIntWithDefault(20),
  QCARE_DEFAULT_HOLD_SLOT_MINUTES: optionalIntWithDefault(5),
  QCARE_DEFAULT_CLINIC_ID: z.string().uuid().optional(),
  QCARE_DEFAULT_DOCTOR_ID: z.string().uuid().optional(),
  // Prāṇa — Google Gemini API
  GEMINI_API_KEY: optionalString,
  PRANA_MODEL: optionalString.default("gemini-2.5-flash")
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
