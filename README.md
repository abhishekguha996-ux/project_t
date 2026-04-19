# QCare Phase 1 Foundation

This repository contains the Phase 1 foundation for QCare inside [`project_t`](./). The goal is to establish the app shell, shared schema, auth contract, seed data, and observability baseline before building patient check-in or clinic dashboards. TEST

## Included in this phase

- Next.js App Router workspace with TypeScript, Tailwind CSS, and shadcn/ui-compatible setup
- Clerk auth middleware and normalized clinic user helpers
- Supabase local configuration, initial schema migration, RLS policy pattern, and seed data
- Resend-backed staff invite emails with delivery tracking and resend support
- QR patient check-in, receptionist check-in, queue status board, and doctor workflow actions
- Patient live tracking with token lookup/re-entry support
- Shared TypeScript domain types for the Phase 1 entities
- GlitchTip and PostHog instrumentation baseline
- Protected placeholder routes for `/reception`, `/doctor`, and `/analytics`

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Fill in Clerk, Supabase, GlitchTip, PostHog, and invite email values.
3. Install dependencies:

```bash
npm install
```

4. Start the app:

```bash
npm run dev
```

5. Start Supabase locally when the CLI is available:

```bash
supabase start
supabase db reset
```

## Environment contract

Required for local boot:

- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Optional but recommended:

- `RESEND_API_KEY`
- `QCARE_INVITE_FROM_EMAIL`
- `QCARE_INVITE_REPLY_TO_EMAIL`
- `GLITCHTIP_DSN`
- `NEXT_PUBLIC_GLITCHTIP_DSN`
- `GLITCHTIP_SECURITY_ENDPOINT`
- `NEXT_PUBLIC_GLITCHTIP_SECURITY_ENDPOINT`
- `POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_HOST`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `QCARE_WHATSAPP_FROM`
- `QCARE_SMS_FROM`
- `QCARE_NOTIFICATIONS_ENABLED`
- `QCARE_NOTIFICATION_MODE`
- `QCARE_DEFAULT_PHONE_COUNTRY_CODE`
- `QCARE_DEFAULT_DOCTOR_PAUSE_MINUTES`
- `QCARE_DEFAULT_HOLD_SLOT_MINUTES`

## Clerk metadata contract

QCare expects Clerk metadata to include:

- `clinic_id`
- `role` with one of `clinic_admin`, `receptionist`, `doctor`

These values are normalized by `src/lib/auth/current-user.ts` before the app consumes them.

## Invite email setup

- QCare sends staff invites through Resend when `RESEND_API_KEY` and `QCARE_INVITE_FROM_EMAIL` are configured.
- The sender should be a verified address on a verified domain such as `invites@mail.yourclinicdomain.com`.
- In Resend, add the sending domain and complete the required SPF and DKIM DNS records before testing real delivery.
- `QCARE_INVITE_REPLY_TO_EMAIL` is optional if replies should go somewhere different from the sender.
- If Resend is not configured locally, QCare still creates the invite and logs the invite link for manual testing, leaving delivery status as `pending`.
- Invite acceptance is email-bound: the user must sign in to Clerk with the same email address the invite was sent to.

## Patient status notifications

- QCare sends patient status updates through Twilio with channel priority:
  1. WhatsApp first (`QCARE_WHATSAPP_FROM`)
  2. SMS fallback (`QCARE_SMS_FROM`)
- Supported events: check-in confirmation, your turn, consult complete, skipped, and stepped out.
- Every attempt is logged in `message_log` with delivery status and provider response id.
- Keep local development safe with:
  - `QCARE_NOTIFICATION_MODE=dry_run` (default) for log-only behavior.
  - `QCARE_NOTIFICATION_MODE=live` when Twilio credentials and senders are ready.

## Supabase notes

- The migration file lives at [`supabase/migrations/001_initial_schema.sql`](./supabase/migrations/001_initial_schema.sql).
- Invite email delivery fields are added in [`supabase/migrations/003_staff_invite_email_delivery.sql`](./supabase/migrations/003_staff_invite_email_delivery.sql).
- Queue pause + checkout workflow fields/tables are added in [`supabase/migrations/005_queue_pause_and_checkout.sql`](./supabase/migrations/005_queue_pause_and_checkout.sql).
- Seed data lives at [`supabase/seed.sql`](./supabase/seed.sql).
- The patient uniqueness model follows the implementation plan: `(clinic_id, phone, name)`.

## Reception workflow pages

- `/reception/board` full-screen lane board for consultation + checkout actions.
- `/reception/checkin` quick-add intake view.
- `/reception/control` operational control center for active holds/pauses and queue event logs.

## Queue model additions

- Doctor queue pause is separate from patient queue status.
- `Hold slot` uses token status `stepped_out` with hold metadata and expiry.
- Receptionist-triggered Hold slot requires a mandatory note.
- `Consultation done` automatically creates/updates checkout state and supports:
  - awaiting payment
  - payment done
  - pharmacy pickup
  - referred for lab
  - visit closed

## What is intentionally not here yet

- Patient check-in UI and API
- Queue operations
- Doctor workflow actions
- Messaging delivery workflows
- AI complaint processing
- Analytics dashboard UI

Those arrive in later phases once this foundation is verified locally and in staging.
