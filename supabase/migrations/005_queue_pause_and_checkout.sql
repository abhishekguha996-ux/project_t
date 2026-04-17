alter table public.tokens
  add column if not exists hold_until timestamptz,
  add column if not exists hold_note text,
  add column if not exists hold_set_by_role text
    check (hold_set_by_role in ('clinic_admin', 'receptionist', 'doctor')),
  add column if not exists hold_set_by_clerk_id text;

create index if not exists idx_tokens_hold_active
  on public.tokens(clinic_id, doctor_id, date, hold_until)
  where status = 'stepped_out';

create table if not exists public.doctor_queue_pauses (
  id uuid default gen_random_uuid() primary key,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  reason text not null default 'personal_emergency'
    check (reason in ('personal_emergency', 'medical_emergency', 'other')),
  note text,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  is_active boolean not null default true,
  created_by_clerk_id text not null,
  created_by_role text not null
    check (created_by_role in ('clinic_admin', 'receptionist', 'doctor')),
  ended_at timestamptz,
  ended_by_clerk_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_queue_pause_active
  on public.doctor_queue_pauses(clinic_id, doctor_id, is_active, ends_at desc);

create unique index if not exists idx_queue_pause_one_active_per_doctor
  on public.doctor_queue_pauses(doctor_id)
  where is_active;

create table if not exists public.token_checkout (
  token_id uuid primary key references public.tokens(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  checkout_stage text not null default 'awaiting_payment'
    check (
      checkout_stage in (
        'awaiting_payment',
        'payment_done',
        'pharmacy_pickup',
        'referred_for_lab',
        'visit_closed'
      )
    ),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'done', 'not_required')),
  pharmacy_status text not null default 'pending'
    check (pharmacy_status in ('pending', 'picked_up', 'not_required')),
  lab_status text not null default 'pending'
    check (lab_status in ('pending', 'referred', 'not_required')),
  notes text,
  closed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_token_checkout_clinic_stage
  on public.token_checkout(clinic_id, checkout_stage, updated_at desc);

create table if not exists public.token_event_log (
  id uuid default gen_random_uuid() primary key,
  token_id uuid not null references public.tokens(id) on delete cascade,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  doctor_id uuid not null references public.doctors(id) on delete cascade,
  actor_clerk_id text,
  actor_role text check (actor_role in ('clinic_admin', 'receptionist', 'doctor')),
  action text not null,
  from_state text,
  to_state text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_token_event_log_token
  on public.token_event_log(token_id, created_at desc);
create index if not exists idx_token_event_log_clinic
  on public.token_event_log(clinic_id, created_at desc);

insert into public.token_checkout (
  token_id,
  clinic_id,
  doctor_id,
  checkout_stage,
  payment_status,
  pharmacy_status,
  lab_status
)
select
  t.id,
  t.clinic_id,
  t.doctor_id,
  'awaiting_payment',
  'pending',
  'pending',
  'pending'
from public.tokens t
where t.status = 'complete'
on conflict (token_id) do nothing;

alter table public.doctor_queue_pauses enable row level security;
alter table public.token_checkout enable row level security;
alter table public.token_event_log enable row level security;

create policy "Clinic isolation doctor queue pauses"
  on public.doctor_queue_pauses
  for all
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

create policy "Clinic isolation token checkout"
  on public.token_checkout
  for all
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

create policy "Clinic isolation token event log"
  on public.token_event_log
  for all
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());
