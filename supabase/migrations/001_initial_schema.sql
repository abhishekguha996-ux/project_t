create extension if not exists pgcrypto;

create table if not exists public.clinics (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  address text,
  phone text,
  subscription_tier text default 'free'
    check (subscription_tier in ('free', 'starter', 'pro', 'enterprise')),
  opening_time time,
  closing_time time,
  created_at timestamptz default now()
);

create table if not exists public.doctors (
  id uuid default gen_random_uuid() primary key,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  clerk_user_id text,
  name text not null,
  specialty text,
  room text,
  max_patients_per_day int default 50,
  avg_consult_minutes int default 8,
  status text default 'active'
    check (status in ('active', 'break', 'paused', 'offline')),
  break_return_time timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_doctors_clinic on public.doctors(clinic_id);

create table if not exists public.patients (
  id uuid default gen_random_uuid() primary key,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  phone text not null,
  name text not null,
  age int,
  gender text check (gender in ('male', 'female', 'other')),
  allergies text[],
  language_preference text default 'en',
  created_at timestamptz default now(),
  unique(clinic_id, phone, name)
);

create index if not exists idx_patients_phone on public.patients(clinic_id, phone);

create table if not exists public.tokens (
  id uuid default gen_random_uuid() primary key,
  clinic_id uuid not null references public.clinics(id),
  doctor_id uuid not null references public.doctors(id),
  patient_id uuid not null references public.patients(id),
  token_number int not null,
  date date not null default current_date,
  status text default 'waiting'
    check (status in ('waiting', 'serving', 'complete', 'skipped', 'stepped_out')),
  type text default 'walkin' check (type in ('walkin', 'booked')),
  urgency text default 'normal' check (urgency in ('normal', 'emergency')),
  checkin_channel text default 'reception'
    check (checkin_channel in ('qr', 'reception')),
  checked_in_at timestamptz default now(),
  serving_started_at timestamptz,
  completed_at timestamptz,
  raw_complaint text,
  ai_summary jsonb,
  consult_duration_seconds int,
  created_at timestamptz default now(),
  unique(clinic_id, doctor_id, date, token_number)
);

create index if not exists idx_tokens_queue
  on public.tokens(clinic_id, doctor_id, date, status);
create index if not exists idx_tokens_patient on public.tokens(patient_id);

create or replace function public.assign_next_token(
  p_clinic_id uuid,
  p_doctor_id uuid,
  p_patient_id uuid,
  p_raw_complaint text,
  p_ai_summary jsonb,
  p_checkin_channel text default 'reception'
)
returns public.tokens
language plpgsql
as $$
declare
  next_number int;
  new_token public.tokens;
begin
  perform pg_advisory_xact_lock(
    hashtext(p_clinic_id::text || p_doctor_id::text || current_date::text)
  );

  select coalesce(max(token_number), 0) + 1
  into next_number
  from public.tokens
  where clinic_id = p_clinic_id
    and doctor_id = p_doctor_id
    and date = current_date;

  insert into public.tokens (
    clinic_id,
    doctor_id,
    patient_id,
    token_number,
    raw_complaint,
    ai_summary,
    checkin_channel
  )
  values (
    p_clinic_id,
    p_doctor_id,
    p_patient_id,
    next_number,
    p_raw_complaint,
    p_ai_summary,
    p_checkin_channel
  )
  returning * into new_token;

  return new_token;
end;
$$;

create table if not exists public.message_log (
  id uuid default gen_random_uuid() primary key,
  token_id uuid references public.tokens(id),
  patient_phone text not null,
  message_type text not null
    check (
      message_type in (
        'checkin_confirm',
        'three_ahead',
        'your_turn',
        'doctor_break',
        'emergency_delay',
        'skipped_noshow',
        'stepped_out_check'
      )
    ),
  message_body text not null,
  twilio_sid text,
  delivery_status text default 'queued'
    check (delivery_status in ('queued', 'sent', 'delivered', 'failed', 'undelivered')),
  cost_inr numeric(6, 2),
  sent_at timestamptz default now(),
  delivered_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_msg_token on public.message_log(token_id);
create index if not exists idx_msg_status
  on public.message_log(delivery_status)
  where delivery_status in ('queued', 'failed');

create table if not exists public.consult_time_log (
  id uuid default gen_random_uuid() primary key,
  clinic_id uuid not null references public.clinics(id),
  doctor_id uuid not null references public.doctors(id),
  token_id uuid not null references public.tokens(id),
  date date not null default current_date,
  duration_seconds int not null,
  created_at timestamptz default now()
);

create index if not exists idx_consult_doctor_date
  on public.consult_time_log(doctor_id, date desc);

create table if not exists public.clinic_daily_stats (
  id uuid default gen_random_uuid() primary key,
  clinic_id uuid not null references public.clinics(id) on delete cascade,
  doctor_id uuid references public.doctors(id) on delete cascade,
  date date not null,
  total_patients int default 0,
  walkin_patients int default 0,
  booked_patients int default 0,
  qr_checkins int default 0,
  reception_checkins int default 0,
  new_patients int default 0,
  returning_patients int default 0,
  avg_wait_time_seconds int,
  avg_consult_duration_seconds int,
  max_wait_time_seconds int,
  patients_skipped int default 0,
  patients_stepped_out int default 0,
  emergency_overrides int default 0,
  capacity_utilization numeric(5, 2),
  consultation_fee numeric(8, 2),
  estimated_revenue numeric(10, 2),
  patients_by_hour jsonb,
  categories jsonb,
  messages_sent int default 0,
  messages_delivered int default 0,
  messages_failed int default 0,
  created_at timestamptz default now(),
  unique(clinic_id, doctor_id, date)
);

create index if not exists idx_stats_clinic_date
  on public.clinic_daily_stats(clinic_id, date desc);
create index if not exists idx_stats_doctor_date
  on public.clinic_daily_stats(doctor_id, date desc);

create extension if not exists pg_cron;

do $$
begin
  if not exists (
    select 1
    from cron.job
    where jobname = 'nightly-stats-aggregation'
  ) then
    perform cron.schedule(
      'nightly-stats-aggregation',
      '29 18 * * *',
      $cron$
      insert into public.clinic_daily_stats (
        clinic_id,
        doctor_id,
        date,
        total_patients,
        walkin_patients,
        booked_patients,
        qr_checkins,
        reception_checkins,
        new_patients,
        returning_patients,
        avg_wait_time_seconds,
        avg_consult_duration_seconds,
        max_wait_time_seconds,
        patients_skipped,
        patients_stepped_out,
        patients_by_hour,
        categories,
        messages_sent,
        messages_delivered,
        messages_failed
      )
      select
        t.clinic_id,
        t.doctor_id,
        t.date,
        count(*) as total_patients,
        count(*) filter (where t.type = 'walkin') as walkin_patients,
        count(*) filter (where t.type = 'booked') as booked_patients,
        count(*) filter (where t.checkin_channel = 'qr') as qr_checkins,
        count(*) filter (where t.checkin_channel = 'reception') as reception_checkins,
        count(*) filter (where p.created_at::date = t.date) as new_patients,
        count(*) filter (where p.created_at::date < t.date) as returning_patients,
        avg(extract(epoch from (t.serving_started_at - t.checked_in_at)))::int as avg_wait_time_seconds,
        avg(t.consult_duration_seconds)::int as avg_consult_duration_seconds,
        max(extract(epoch from (t.serving_started_at - t.checked_in_at)))::int as max_wait_time_seconds,
        count(*) filter (where t.status = 'skipped') as patients_skipped,
        count(*) filter (where t.status = 'stepped_out') as patients_stepped_out,
        coalesce(
          (
            select jsonb_object_agg(hr::text, cnt)
            from (
              select extract(hour from t2.checked_in_at)::int as hr, count(*)::int as cnt
              from public.tokens t2
              where t2.clinic_id = t.clinic_id
                and t2.doctor_id = t.doctor_id
                and t2.date = t.date
              group by hr
            ) hourly
          ),
          '{}'::jsonb
        ) as patients_by_hour,
        coalesce(
          (
            select jsonb_object_agg(category, cnt)
            from (
              select coalesce(t3.ai_summary->>'category', 'unknown') as category, count(*)::int as cnt
              from public.tokens t3
              where t3.clinic_id = t.clinic_id
                and t3.doctor_id = t.doctor_id
                and t3.date = t.date
              group by category
            ) grouped_categories
          ),
          '{}'::jsonb
        ) as categories,
        (
          select count(*)
          from public.message_log ml
          where ml.token_id = any(array_agg(t.id))
        ) as messages_sent,
        (
          select count(*)
          from public.message_log ml
          where ml.token_id = any(array_agg(t.id))
            and ml.delivery_status = 'delivered'
        ) as messages_delivered,
        (
          select count(*)
          from public.message_log ml
          where ml.token_id = any(array_agg(t.id))
            and ml.delivery_status = 'failed'
        ) as messages_failed
      from public.tokens t
      join public.patients p on p.id = t.patient_id
      where t.date = current_date
      group by t.clinic_id, t.doctor_id, t.date
      on conflict (clinic_id, doctor_id, date)
      do update set
        total_patients = excluded.total_patients,
        walkin_patients = excluded.walkin_patients,
        booked_patients = excluded.booked_patients,
        qr_checkins = excluded.qr_checkins,
        reception_checkins = excluded.reception_checkins,
        new_patients = excluded.new_patients,
        returning_patients = excluded.returning_patients,
        avg_wait_time_seconds = excluded.avg_wait_time_seconds,
        avg_consult_duration_seconds = excluded.avg_consult_duration_seconds,
        max_wait_time_seconds = excluded.max_wait_time_seconds,
        patients_skipped = excluded.patients_skipped,
        patients_stepped_out = excluded.patients_stepped_out,
        patients_by_hour = excluded.patients_by_hour,
        categories = excluded.categories,
        messages_sent = excluded.messages_sent,
        messages_delivered = excluded.messages_delivered,
        messages_failed = excluded.messages_failed;
      $cron$
    );
  end if;
exception
  when undefined_table then
    raise notice 'pg_cron metadata unavailable in this environment; skipping cron registration';
end
$$;

create or replace function public.current_clinic_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() -> 'app_metadata' ->> 'clinic_id', '')::uuid
$$;

alter table public.clinics enable row level security;
alter table public.doctors enable row level security;
alter table public.patients enable row level security;
alter table public.tokens enable row level security;
alter table public.message_log enable row level security;
alter table public.consult_time_log enable row level security;
alter table public.clinic_daily_stats enable row level security;

create policy "Clinic isolation clinics"
  on public.clinics
  for all
  using (id = public.current_clinic_id())
  with check (id = public.current_clinic_id());

create policy "Clinic isolation doctors"
  on public.doctors
  for all
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

create policy "Clinic isolation patients"
  on public.patients
  for all
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

create policy "Clinic isolation tokens"
  on public.tokens
  for all
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

create policy "Clinic isolation consult log"
  on public.consult_time_log
  for all
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

create policy "Clinic isolation stats"
  on public.clinic_daily_stats
  for all
  using (clinic_id = public.current_clinic_id())
  with check (clinic_id = public.current_clinic_id());

create policy "Clinic isolation message log"
  on public.message_log
  for all
  using (
    exists (
      select 1
      from public.tokens t
      where t.id = message_log.token_id
        and t.clinic_id = public.current_clinic_id()
    )
  )
  with check (
    exists (
      select 1
      from public.tokens t
      where t.id = message_log.token_id
        and t.clinic_id = public.current_clinic_id()
    )
  );
