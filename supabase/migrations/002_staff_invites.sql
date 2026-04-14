create or replace function public.current_clinic_id()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(auth.jwt() -> 'app_metadata' ->> 'clinic_id', ''),
    nullif(auth.jwt() -> 'public_metadata' ->> 'clinic_id', '')
  )::uuid
$$;

create table if not exists public.staff_invites (
  id uuid default gen_random_uuid() primary key,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  invite_code text not null unique,
  role text not null check (role in ('doctor', 'receptionist')),
  invitee_name text,
  invitee_email text,
  invited_by_clerk_id text not null,
  doctor_id uuid references public.doctors(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'expired', 'revoked')),
  accepted_by_clerk_id text,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz default now(),
  check (
    (role = 'doctor' and doctor_id is not null) or
    (role = 'receptionist' and doctor_id is null)
  )
);

create index if not exists idx_staff_invites_clinic_created
  on public.staff_invites(clinic_id, created_at desc);

create index if not exists idx_staff_invites_pending_code
  on public.staff_invites(invite_code)
  where status = 'pending';

alter table public.staff_invites enable row level security;

create policy "Clinic isolation staff invites"
  on public.staff_invites
  for all
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());
