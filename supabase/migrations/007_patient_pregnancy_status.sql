alter table public.patients
  add column if not exists pregnancy_status text not null default 'unknown';

update public.patients
set pregnancy_status = 'unknown'
where pregnancy_status is null;

alter table public.patients
  drop constraint if exists patients_pregnancy_status_check;

alter table public.patients
  add constraint patients_pregnancy_status_check
  check (
    pregnancy_status in ('unknown', 'pregnant', 'not_pregnant', 'prefer_not_to_say')
  );
