# QCare Phase 1 Foundation

This repository contains the Phase 1 foundation for QCare inside [`project_t`](./). The goal is to establish the app shell, shared schema, auth contract, seed data, and observability baseline before building patient check-in or clinic dashboards.

## Included in this phase

- Next.js App Router workspace with TypeScript, Tailwind CSS, and shadcn/ui-compatible setup
- Clerk auth middleware and normalized clinic user helpers
- Supabase local configuration, initial schema migration, RLS policy pattern, and seed data
- Shared TypeScript domain types for the Phase 1 entities
- GlitchTip and PostHog instrumentation baseline
- Protected placeholder routes for `/reception`, `/doctor`, and `/analytics`

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Fill in Clerk, Supabase, GlitchTip, and PostHog values.
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

- `GLITCHTIP_DSN`
- `NEXT_PUBLIC_GLITCHTIP_DSN`
- `GLITCHTIP_SECURITY_ENDPOINT`
- `NEXT_PUBLIC_GLITCHTIP_SECURITY_ENDPOINT`
- `POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_KEY`
- `NEXT_PUBLIC_POSTHOG_HOST`

## Clerk metadata contract

QCare expects Clerk metadata to include:

- `clinic_id`
- `role` with one of `clinic_admin`, `receptionist`, `doctor`

These values are normalized by `src/lib/auth/current-user.ts` before the app consumes them.

## Supabase notes

- The migration file lives at [`supabase/migrations/001_initial_schema.sql`](./supabase/migrations/001_initial_schema.sql).
- Seed data lives at [`supabase/seed.sql`](./supabase/seed.sql).
- The patient uniqueness model follows the implementation plan: `(clinic_id, phone, name)`.

## What is intentionally not here yet

- Patient check-in UI and API
- Queue operations
- Doctor workflow actions
- Messaging delivery workflows
- AI complaint processing
- Analytics dashboard UI

Those arrive in later phases once this foundation is verified locally and in staging.
