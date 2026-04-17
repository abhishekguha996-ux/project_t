do $$
declare
  v_clinic_id uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  v_doctor_id uuid;
begin
  select coalesce(
    (
      select d.id
      from public.doctors d
      where d.clinic_id = v_clinic_id
        and d.status <> 'offline'
      order by d.name
      limit 1
    ),
    '22222222-2222-4222-8222-222222222222'::uuid
  )
  into v_doctor_id;

  -- Clear today's queue state for the selected doctor.
  delete from public.message_log ml
  where ml.token_id in (
    select t.id
    from public.tokens t
    where t.clinic_id = v_clinic_id
      and t.doctor_id = v_doctor_id
      and t.date = current_date
  );

  delete from public.consult_time_log ctl
  where ctl.token_id in (
    select t.id
    from public.tokens t
    where t.clinic_id = v_clinic_id
      and t.doctor_id = v_doctor_id
      and t.date = current_date
  );

  delete from public.token_event_log tel
  where tel.token_id in (
    select t.id
    from public.tokens t
    where t.clinic_id = v_clinic_id
      and t.doctor_id = v_doctor_id
      and t.date = current_date
  );

  delete from public.token_checkout tc
  where tc.token_id in (
    select t.id
    from public.tokens t
    where t.clinic_id = v_clinic_id
      and t.doctor_id = v_doctor_id
      and t.date = current_date
  );

  delete from public.tokens t
  where t.clinic_id = v_clinic_id
    and t.doctor_id = v_doctor_id
    and t.date = current_date;

  delete from public.patients p
  where p.clinic_id = v_clinic_id
    and p.name like 'Demo Patient %'
    and not exists (
      select 1
      from public.tokens t
      where t.patient_id = p.id
    );

  -- Upsert 100 deterministic demo patients.
  insert into public.patients (
    clinic_id,
    phone,
    name,
    age,
    gender,
    allergies,
    language_preference
  )
  select
    v_clinic_id,
    format('91000%s', lpad(gs::text, 5, '0')),
    format('Demo Patient %s', lpad(gs::text, 3, '0')),
    18 + (gs % 55),
    (array['male', 'female', 'other'])[(gs % 3) + 1]::text,
    case when gs % 5 = 0 then array['Penicillin']::text[] else '{}'::text[] end,
    (array['en', 'hi'])[(gs % 2) + 1]::text
  from generate_series(1, 100) as gs
  on conflict (clinic_id, phone, name) do update
    set
      age = excluded.age,
      gender = excluded.gender,
      allergies = excluded.allergies,
      language_preference = excluded.language_preference;

  create temporary table tmp_demo_patient_map (
    seq int primary key,
    patient_id uuid not null
  ) on commit drop;

  insert into tmp_demo_patient_map (seq, patient_id)
  select
    gs as seq,
    p.id as patient_id
  from generate_series(1, 100) as gs
  join public.patients p
    on p.clinic_id = v_clinic_id
   and p.phone = format('91000%s', lpad(gs::text, 5, '0'))
   and p.name = format('Demo Patient %s', lpad(gs::text, 3, '0'));

  -- Insert 100 tokens with exactly 1 in consultation (serving).
  insert into public.tokens (
    clinic_id,
    doctor_id,
    patient_id,
    token_number,
    date,
    status,
    type,
    urgency,
    checkin_channel,
    checked_in_at,
    serving_started_at,
    completed_at,
    raw_complaint,
    ai_summary,
    consult_duration_seconds,
    hold_until,
    hold_note,
    hold_set_by_role,
    hold_set_by_clerk_id
  )
  select
    v_clinic_id,
    v_doctor_id,
    m.patient_id,
    m.seq,
    current_date,
    case
      when m.seq = 1 then 'serving'
      when m.seq between 2 and 25 then 'waiting'
      when m.seq between 26 and 37 then 'stepped_out'
      when m.seq between 38 and 50 then 'skipped'
      else 'complete'
    end,
    'walkin',
    case when m.seq % 17 = 0 then 'emergency' else 'normal' end,
    case when m.seq % 3 = 0 then 'qr' else 'reception' end,
    now() - (((101 - m.seq) * 2)::text || ' minutes')::interval,
    case
      when m.seq = 1 then now() - interval '4 minutes'
      when m.seq > 50 then now() - (((101 - m.seq) * 2 - 12)::text || ' minutes')::interval
      else null
    end,
    case
      when m.seq > 50 then now() - (((101 - m.seq) * 2 - 4)::text || ' minutes')::interval
      else null
    end,
    format('Demo complaint %s: fever/cough follow-up', m.seq),
    jsonb_build_object(
      'language_detected', 'english',
      'category', case when m.seq % 4 = 0 then 'respiratory' else 'general' end,
      'clinical_summary', format('Demo clinical summary for patient %s', m.seq)
    ),
    case when m.seq > 50 then 480 else null end,
    case
      when m.seq between 26 and 37
        then now() + (((m.seq - 25) % 6 + 1)::text || ' minutes')::interval
      else null
    end,
    case when m.seq between 26 and 37 then 'Hold slot demo note' else null end,
    case when m.seq between 26 and 37 then 'receptionist' else null end,
    case when m.seq between 26 and 37 then 'demo-receptionist' else null end
  from tmp_demo_patient_map m
  order by m.seq;

  -- Spread completed tokens across checkout lanes.
  insert into public.token_checkout (
    token_id,
    clinic_id,
    doctor_id,
    checkout_stage,
    payment_status,
    pharmacy_status,
    lab_status,
    notes,
    closed_at,
    updated_at
  )
  select
    t.id as token_id,
    t.clinic_id,
    t.doctor_id,
    case
      when t.token_number between 51 and 64 then 'awaiting_payment'
      when t.token_number between 65 and 74 then 'payment_done'
      when t.token_number between 75 and 84 then 'pharmacy_pickup'
      when t.token_number between 85 and 92 then 'referred_for_lab'
      else 'visit_closed'
    end as checkout_stage,
    case
      when t.token_number between 51 and 64 then 'pending'
      else 'done'
    end as payment_status,
    case
      when t.token_number between 51 and 74 then 'pending'
      when t.token_number between 75 and 84 then 'picked_up'
      when t.token_number between 85 and 92 then 'not_required'
      else 'picked_up'
    end as pharmacy_status,
    case
      when t.token_number between 51 and 84 then 'pending'
      when t.token_number between 85 and 92 then 'referred'
      else 'not_required'
    end as lab_status,
    'Demo checkout lane distribution data' as notes,
    case
      when t.token_number between 93 and 100 then now() - interval '2 minutes'
      else null
    end as closed_at,
    now() as updated_at
  from public.tokens t
  where t.clinic_id = v_clinic_id
    and t.doctor_id = v_doctor_id
    and t.date = current_date
    and t.status = 'complete';
end $$;
