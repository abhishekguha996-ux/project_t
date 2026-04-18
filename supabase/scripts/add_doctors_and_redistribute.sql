-- Adds two extra doctors (Pediatrician + Dermatologist) and redistributes today's
-- tokens across the three doctors for the demo clinic. Idempotent.

do $$
declare
  v_clinic_id uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  v_d1 uuid := '22222222-2222-4222-8222-222222222222'::uuid; -- existing: Dr. Meera Shah (GP)
  v_d2 uuid := '22222222-2222-4222-8222-222222222223'::uuid; -- new: Pediatrician
  v_d3 uuid := '22222222-2222-4222-8222-222222222224'::uuid; -- new: Dermatologist
begin
  insert into public.doctors (
    id, clinic_id, clerk_user_id, name, specialty, room,
    max_patients_per_day, avg_consult_minutes, status
  ) values
    (v_d2, v_clinic_id, null, 'Dr. Arjun Mehta', 'Pediatrician',   'Room 3', 50, 10, 'active'),
    (v_d3, v_clinic_id, null, 'Dr. Priya Nair',  'Dermatologist',  'Room 4', 40,  9, 'active')
  on conflict (id) do update set
    name = excluded.name,
    specialty = excluded.specialty,
    room = excluded.room,
    status = excluded.status;

  -- Redistribute today's tokens round-robin by token_number % 3:
  --   0 → Dr. Meera (GP), 1 → Pediatrician, 2 → Dermatologist
  update public.tokens t
  set doctor_id = case (t.token_number % 3)
    when 0 then v_d1
    when 1 then v_d2
    else        v_d3
  end
  where t.clinic_id = v_clinic_id
    and t.date = current_date;

  -- Guarantee exactly one 'serving' token per doctor (at most):
  -- demote every doctor's extra servings to waiting, then promote one waiting if none.
  with ranked as (
    select id, doctor_id,
           row_number() over (partition by doctor_id order by token_number) as rn
    from public.tokens
    where clinic_id = v_clinic_id and date = current_date and status = 'serving'
  )
  update public.tokens t
  set status = 'waiting', serving_started_at = null
  from ranked r
  where t.id = r.id and r.rn > 1;

  -- For any doctor that now has 0 serving, promote their earliest waiting token.
  with targets as (
    select d.id as doctor_id
    from public.doctors d
    where d.clinic_id = v_clinic_id and d.id in (v_d1, v_d2, v_d3)
      and not exists (
        select 1 from public.tokens t
        where t.clinic_id = v_clinic_id and t.date = current_date
          and t.doctor_id = d.id and t.status = 'serving'
      )
  ),
  picks as (
    select distinct on (t.doctor_id) t.id
    from public.tokens t
    join targets tg on tg.doctor_id = t.doctor_id
    where t.clinic_id = v_clinic_id and t.date = current_date and t.status = 'waiting'
    order by t.doctor_id, t.token_number
  )
  update public.tokens t
  set status = 'serving',
      serving_started_at = coalesce(t.serving_started_at, now() - interval '3 minutes')
  from picks p
  where t.id = p.id;

  -- Move token_checkout rows to follow their new doctor_id.
  update public.token_checkout tc
  set doctor_id = t.doctor_id
  from public.tokens t
  where tc.token_id = t.id
    and t.clinic_id = v_clinic_id
    and t.date = current_date;
end $$;

-- Summary for sanity-check:
select d.name, t.status, count(*)
from public.tokens t
join public.doctors d on d.id = t.doctor_id
where t.clinic_id = '11111111-1111-4111-8111-111111111111'
  and t.date = current_date
group by d.name, t.status
order by d.name, t.status;
