-- Replaces every patient + token in the demo clinic with 100 fresh patients
-- carrying real, regionally-diverse Indian names (incl. long compound names),
-- then regenerates today's 100-token queue distributed across 3 doctors with
-- exactly 1 serving each. Idempotent — re-run any time.

do $$
declare
  v_clinic_id uuid := '11111111-1111-4111-8111-111111111111'::uuid;
  v_d1 uuid := '22222222-2222-4222-8222-222222222222'::uuid; -- Dr. Meera Shah, GP
  v_d2 uuid := '22222222-2222-4222-8222-222222222223'::uuid; -- Dr. Arjun Mehta, Pediatrician
  v_d3 uuid := '22222222-2222-4222-8222-222222222224'::uuid; -- Dr. Priya Nair, Dermatologist
begin
  -- Ensure the 2 extra doctors exist (idempotent).
  insert into public.doctors (
    id, clinic_id, clerk_user_id, name, specialty, room,
    max_patients_per_day, avg_consult_minutes, status
  ) values
    (v_d2, v_clinic_id, null, 'Dr. Arjun Mehta', 'Pediatrician',   'Room 3', 50, 10, 'active'),
    (v_d3, v_clinic_id, null, 'Dr. Priya Nair',  'Dermatologist',  'Room 4', 40,  9, 'active')
  on conflict (id) do update set
    name = excluded.name, specialty = excluded.specialty,
    room = excluded.room, status = excluded.status;

  -- Wipe everything patient-adjacent for this clinic.
  delete from public.message_log where token_id in (
    select id from public.tokens where clinic_id = v_clinic_id
  );
  delete from public.consult_time_log where token_id in (
    select id from public.tokens where clinic_id = v_clinic_id
  );
  delete from public.token_event_log where token_id in (
    select id from public.tokens where clinic_id = v_clinic_id
  );
  delete from public.token_checkout where token_id in (
    select id from public.tokens where clinic_id = v_clinic_id
  );
  delete from public.tokens where clinic_id = v_clinic_id;
  delete from public.patients where clinic_id = v_clinic_id;

  -- 100 real Indian names, diverse regions, mix of short and long.
  with roster(seq, full_name, phone, age, gender, lang, allergies) as (
    values
      -- North Indian / Hindi belt
      ( 1, 'Aarav Sharma',                          '9000000001', 34, 'male',   'hi', '{}'::text[]),
      ( 2, 'Vivaan Patel',                          '9000000002', 29, 'male',   'hi', '{}'),
      ( 3, 'Aditya Kumar',                          '9000000003', 42, 'male',   'hi', '{"Penicillin"}'),
      ( 4, 'Arjun Verma',                           '9000000004', 55, 'male',   'hi', '{}'),
      ( 5, 'Reyansh Gupta',                         '9000000005', 23, 'male',   'hi', '{}'),
      ( 6, 'Ananya Agarwal',                        '9000000006', 28, 'female', 'hi', '{}'),
      ( 7, 'Diya Kapoor',                           '9000000007', 31, 'female', 'hi', '{"Dust"}'),
      ( 8, 'Neha Chauhan',                          '9000000008', 44, 'female', 'hi', '{}'),
      ( 9, 'Pooja Saxena',                          '9000000009', 36, 'female', 'hi', '{}'),
      (10, 'Rakesh Yadav',                          '9000000010', 60, 'male',   'hi', '{}'),
      (11, 'Kavita Tripathi',                       '9000000011', 51, 'female', 'hi', '{}'),
      (12, 'Anil Sinha',                            '9000000012', 47, 'male',   'hi', '{"Peanuts"}'),
      (13, 'Shalini Rathore',                       '9000000013', 39, 'female', 'hi', '{}'),
      (14, 'Deepak Chopra',                         '9000000014', 52, 'male',   'en', '{}'),
      (15, 'Sunita Bansal',                         '9000000015', 38, 'female', 'hi', '{}'),

      -- South Indian — Tamil, Telugu, Kannada, Malayalam (some long compound names)
      (16, 'Lakshminarayanan Venkatesan',           '9000000016', 65, 'male',   'ta', '{}'),
      (17, 'Balasubramaniam Chidambaram',           '9000000017', 58, 'male',   'ta', '{}'),
      (18, 'Meenakshisundaram Raghavachari',        '9000000018', 72, 'male',   'ta', '{"Sulfa"}'),
      (19, 'Padmanabhan Ramachandran',              '9000000019', 61, 'male',   'ta', '{}'),
      (20, 'Hariharasudhan Kaliappan',              '9000000020', 49, 'male',   'ta', '{}'),
      (21, 'Thirumalaikumar Subramanian',           '9000000021', 44, 'male',   'ta', '{}'),
      (22, 'Swaminathan Gopalakrishnan',            '9000000022', 67, 'male',   'ta', '{}'),
      (23, 'Jayalakshmi Viswanathan',               '9000000023', 55, 'female', 'ta', '{}'),
      (24, 'Rajeshwari Krishnamoorthy',             '9000000024', 48, 'female', 'ta', '{}'),
      (25, 'Priya Sundari Ramaswamy',               '9000000025', 33, 'female', 'ta', '{}'),
      (26, 'Aishwarya Lakshmi Narayan',             '9000000026', 27, 'female', 'ta', '{}'),
      (27, 'Venkataramana Srinivasan',              '9000000027', 59, 'male',   'te', '{}'),
      (28, 'Chandrasekhar Venugopalan',             '9000000028', 63, 'male',   'te', '{}'),
      (29, 'Bhairavi Satyanarayanan',               '9000000029', 41, 'female', 'te', '{"Aspirin"}'),
      (30, 'Radha Krishna Murthy',                  '9000000030', 57, 'male',   'te', '{}'),
      (31, 'Naga Lakshmi Prasad',                   '9000000031', 46, 'female', 'te', '{}'),
      (32, 'Anantha Padmanabha Rao',                '9000000032', 68, 'male',   'kn', '{}'),
      (33, 'Shivaramakrishnan Bhat',                '9000000033', 54, 'male',   'kn', '{}'),
      (34, 'Chandramouli Hegde',                    '9000000034', 37, 'male',   'kn', '{}'),
      (35, 'Rukmini Ananthapadmanabhan',            '9000000035', 71, 'female', 'kn', '{}'),
      (36, 'Deepika Udupa',                         '9000000036', 32, 'female', 'kn', '{}'),
      (37, 'Unnikrishnan Pillai',                   '9000000037', 50, 'male',   'ml', '{}'),
      (38, 'Sreelatha Mohanakumari',                '9000000038', 43, 'female', 'ml', '{}'),
      (39, 'Gopalakrishnan Nair',                   '9000000039', 62, 'male',   'ml', '{}'),
      (40, 'Parvathy Ramachandran Menon',           '9000000040', 45, 'female', 'ml', '{}'),
      (41, 'Sajeev Kurup',                          '9000000041', 39, 'male',   'ml', '{}'),
      (42, 'Rajagopal Krishnan',                    '9000000042', 66, 'male',   'ml', '{}'),
      (43, 'Reddy Venkata Subba Rao',               '9000000043', 70, 'male',   'te', '{}'),
      (44, 'Satyanarayana Murty',                   '9000000044', 64, 'male',   'te', '{}'),

      -- Bengali / Odia / East
      (45, 'Subroto Mukherjee',                     '9000000045', 58, 'male',   'en', '{}'),
      (46, 'Tapan Kumar Ghosh',                     '9000000046', 61, 'male',   'en', '{}'),
      (47, 'Bidisha Chakraborty',                   '9000000047', 35, 'female', 'en', '{}'),
      (48, 'Souvik Bhattacharya',                   '9000000048', 29, 'male',   'en', '{}'),
      (49, 'Ayan Das',                              '9000000049', 26, 'male',   'en', '{}'),
      (50, 'Reshma Dutta',                          '9000000050', 33, 'female', 'en', '{}'),
      (51, 'Partha Sarathi Sengupta',               '9000000051', 54, 'male',   'en', '{}'),
      (52, 'Priyanka Mitra',                        '9000000052', 31, 'female', 'en', '{}'),
      (53, 'Jagadish Chandra Mukhopadhyay',         '9000000053', 67, 'male',   'en', '{}'),
      (54, 'Sathyanarayana Bhattacharjee',          '9000000054', 59, 'male',   'en', '{}'),
      (55, 'Debabrata Chattopadhyay',               '9000000055', 62, 'male',   'en', '{}'),
      (56, 'Bibhuti Bhushan Panda',                 '9000000056', 53, 'male',   'en', '{}'),

      -- Maharashtrian / Gujarati / West
      (57, 'Anjali Deshmukh',                       '9000000057', 40, 'female', 'hi', '{}'),
      (58, 'Rohan Kulkarni',                        '9000000058', 28, 'male',   'hi', '{}'),
      (59, 'Sakshi Pawar',                          '9000000059', 34, 'female', 'hi', '{}'),
      (60, 'Mahesh Bhosale',                        '9000000060', 56, 'male',   'hi', '{}'),
      (61, 'Tejas Gaikwad',                         '9000000061', 25, 'male',   'hi', '{}'),
      (62, 'Rutuja Shinde',                         '9000000062', 30, 'female', 'hi', '{}'),
      (63, 'Snehal Jadhav',                         '9000000063', 36, 'female', 'hi', '{}'),
      (64, 'Ganesh Naik',                           '9000000064', 48, 'male',   'hi', '{}'),
      (65, 'Vaibhav More',                          '9000000065', 37, 'male',   'hi', '{}'),
      (66, 'Madhuri Patil',                         '9000000066', 52, 'female', 'hi', '{}'),
      (67, 'Kishore Joshi',                         '9000000067', 49, 'male',   'hi', '{}'),
      (68, 'Hiteshkumar Kothari',                   '9000000068', 44, 'male',   'en', '{}'),
      (69, 'Jagdishbhai Bhavsar',                   '9000000069', 58, 'male',   'en', '{}'),
      (70, 'Ketankumar Chokshi',                    '9000000070', 41, 'male',   'en', '{}'),

      -- Punjabi / Sikh
      (71, 'Harpreet Kaur',                         '9000000071', 39, 'female', 'hi', '{}'),
      (72, 'Gurmeet Singh',                         '9000000072', 55, 'male',   'hi', '{}'),
      (73, 'Simranjit Kaur Ahluwalia',              '9000000073', 33, 'female', 'hi', '{}'),
      (74, 'Baljeet Singh Gill',                    '9000000074', 47, 'male',   'hi', '{}'),
      (75, 'Manpreet Kaur Bajwa',                   '9000000075', 29, 'female', 'hi', '{}'),
      (76, 'Rajbir Singh Chahal',                   '9000000076', 63, 'male',   'hi', '{}'),
      (77, 'Kulwinder Kaur Sidhu',                  '9000000077', 50, 'female', 'hi', '{}'),
      (78, 'Parminder Singh Rai',                   '9000000078', 54, 'male',   'hi', '{}'),
      (79, 'Amarjeet Singh Grewal',                 '9000000079', 61, 'male',   'hi', '{}'),

      -- Muslim / Urdu
      (80, 'Abdul Rahman Khan',                     '9000000080', 45, 'male',   'hi', '{}'),
      (81, 'Mohammed Farooq Ansari',                '9000000081', 38, 'male',   'hi', '{}'),
      (82, 'Ayesha Begum',                          '9000000082', 32, 'female', 'hi', '{}'),
      (83, 'Imran Qureshi',                         '9000000083', 41, 'male',   'hi', '{}'),
      (84, 'Fatima Zahra Siddiqui',                 '9000000084', 27, 'female', 'hi', '{}'),
      (85, 'Zoya Sheikh',                           '9000000085', 24, 'female', 'hi', '{}'),
      (86, 'Tariq Hussain',                         '9000000086', 57, 'male',   'hi', '{}'),
      (87, 'Nadia Pathan',                          '9000000087', 35, 'female', 'hi', '{}'),
      (88, 'Salman Hashmi',                         '9000000088', 43, 'male',   'hi', '{}'),
      (89, 'Rukhsar Mirza',                         '9000000089', 30, 'female', 'hi', '{}'),

      -- Goan / Mangalorean Catholic
      (90, 'Sheldon Pereira',                       '9000000090', 33, 'male',   'en', '{}'),
      (91, 'Angela D''Costa',                       '9000000091', 29, 'female', 'en', '{}'),
      (92, 'Rebecca Fernandes',                     '9000000092', 46, 'female', 'en', '{}'),
      (93, 'Neil Gonsalves',                        '9000000093', 37, 'male',   'en', '{}'),
      (94, 'Lourdes Mascarenhas',                   '9000000094', 62, 'female', 'en', '{}'),
      (95, 'Joseph Rodrigues',                      '9000000095', 54, 'male',   'en', '{}'),
      (96, 'Clara Pinto',                           '9000000096', 48, 'female', 'en', '{}'),

      -- NE / misc
      (97, 'Lalhmingthanga Sailo',                  '9000000097', 31, 'male',   'en', '{}'),
      (98, 'Mongkhosang Chanu',                     '9000000098', 26, 'female', 'en', '{}'),
      (99, 'Temjenzulu Ao',                         '9000000099', 40, 'male',   'en', '{}'),
      (100,'Diki Wangmo Bhutia',                    '9000000100', 34, 'female', 'en', '{}')
  )
  insert into public.patients (
    clinic_id, phone, name, age, gender, allergies, language_preference
  )
  select v_clinic_id, phone, full_name, age, gender, allergies, lang
  from roster;

  -- Build seq → patient_id map by phone (phone is unique per clinic in practice).
  create temporary table tmp_pmap (
    seq int primary key,
    patient_id uuid not null
  ) on commit drop;

  insert into tmp_pmap (seq, patient_id)
  select
    gs as seq,
    p.id
  from generate_series(1, 100) as gs
  join public.patients p
    on p.clinic_id = v_clinic_id
   and p.phone = format('90000%s', lpad(gs::text, 5, '0'));

  -- Recreate the 100-token day from the original loader's distribution
  -- (1 serving, waiting, stepped_out, skipped, complete) …
  insert into public.tokens (
    clinic_id, doctor_id, patient_id, token_number, date, status, type,
    urgency, checkin_channel, checked_in_at, serving_started_at, completed_at,
    raw_complaint, ai_summary, consult_duration_seconds, hold_until,
    hold_note, hold_set_by_role, hold_set_by_clerk_id
  )
  select
    v_clinic_id,
    v_d1, -- placeholder, reassigned below
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
    case
      when m.seq % 11 = 0 then 'Chest pain since this morning'
      when m.seq % 7 = 0 then 'High fever and body ache'
      when m.seq % 5 = 0 then 'Skin rash for 3 days'
      when m.seq % 4 = 0 then 'Child with cough and cold'
      when m.seq % 3 = 0 then 'Follow-up on BP medication'
      else 'General consultation — fatigue and headache'
    end,
    jsonb_build_object(
      'language_detected', 'english',
      'category', case when m.seq % 4 = 0 then 'respiratory' else 'general' end,
      'clinical_summary', format('Initial summary for patient %s', m.seq)
    ),
    case when m.seq > 50 then 480 else null end,
    case
      when m.seq between 26 and 37
        then now() + (((m.seq - 25) % 6 + 1)::text || ' minutes')::interval
      else null
    end,
    case when m.seq between 26 and 37 then 'Patient stepped out briefly' else null end,
    case when m.seq between 26 and 37 then 'receptionist' else null end,
    case when m.seq between 26 and 37 then 'demo-receptionist' else null end
  from tmp_pmap m
  order by m.seq;

  -- Distribute tokens across 3 doctors round-robin by token_number % 3.
  update public.tokens t
  set doctor_id = case (t.token_number % 3)
    when 0 then v_d1
    when 1 then v_d2
    else        v_d3
  end
  where t.clinic_id = v_clinic_id and t.date = current_date;

  -- Ensure ≤1 serving per doctor; demote extras to waiting.
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

  -- Promote an earliest waiting to serving for any doctor without one.
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

  -- Checkout distribution for completed tokens.
  insert into public.token_checkout (
    token_id, clinic_id, doctor_id, checkout_stage, payment_status,
    pharmacy_status, lab_status, notes, closed_at, updated_at
  )
  select
    t.id, t.clinic_id, t.doctor_id,
    case
      when t.token_number between 51 and 64 then 'awaiting_payment'
      when t.token_number between 65 and 74 then 'payment_done'
      when t.token_number between 75 and 84 then 'pharmacy_pickup'
      when t.token_number between 85 and 92 then 'referred_for_lab'
      else 'visit_closed'
    end,
    case when t.token_number between 51 and 64 then 'pending' else 'done' end,
    case
      when t.token_number between 51 and 74 then 'pending'
      when t.token_number between 75 and 84 then 'picked_up'
      when t.token_number between 85 and 92 then 'not_required'
      else 'picked_up'
    end,
    case
      when t.token_number between 51 and 84 then 'pending'
      when t.token_number between 85 and 92 then 'referred'
      else 'not_required'
    end,
    'Auto-distributed checkout stage',
    case when t.token_number between 93 and 100 then now() - interval '2 minutes' else null end,
    now()
  from public.tokens t
  where t.clinic_id = v_clinic_id and t.date = current_date and t.status = 'complete';
end $$;

-- Summary for sanity.
select d.name, t.status, count(*)
from public.tokens t
join public.doctors d on d.id = t.doctor_id
where t.clinic_id = '11111111-1111-4111-8111-111111111111'
  and t.date = current_date
group by d.name, t.status
order by d.name, t.status;
