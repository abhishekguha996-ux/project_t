begin;

truncate table public.message_log restart identity cascade;
truncate table public.token_event_log restart identity cascade;
truncate table public.token_checkout restart identity cascade;
truncate table public.doctor_queue_pauses restart identity cascade;
truncate table public.consult_time_log restart identity cascade;
truncate table public.clinic_daily_stats restart identity cascade;
truncate table public.tokens restart identity cascade;
truncate table public.patients restart identity cascade;
truncate table public.doctors restart identity cascade;
truncate table public.clinics restart identity cascade;

insert into public.clinics (
  id,
  name,
  address,
  phone,
  subscription_tier,
  opening_time,
  closing_time
)
values (
  '11111111-1111-4111-8111-111111111111',
  'QCare Demo Clinic',
  '12 Residency Road, Bengaluru',
  '9876543210',
  'starter',
  '09:00',
  '18:00'
);

insert into public.doctors (
  id,
  clinic_id,
  clerk_user_id,
  name,
  specialty,
  room,
  max_patients_per_day,
  avg_consult_minutes,
  status
)
values (
  '22222222-2222-4222-8222-222222222222',
  '11111111-1111-4111-8111-111111111111',
  null,
  'Dr. Meera Shah',
  'General Physician',
  'Room 2',
  50,
  8,
  'active'
);

insert into public.patients (
  id,
  clinic_id,
  phone,
  name,
  age,
  gender,
  allergies,
  language_preference
)
values
  (
    '33333333-3333-4333-8333-333333333331',
    '11111111-1111-4111-8111-111111111111',
    '9998887771',
    'Ravi Kumar',
    42,
    'male',
    '{"Penicillin"}',
    'en'
  ),
  (
    '33333333-3333-4333-8333-333333333332',
    '11111111-1111-4111-8111-111111111111',
    '9998887772',
    'Lakshmi Devi',
    35,
    'female',
    '{"Dust"}',
    'hi'
  ),
  (
    '33333333-3333-4333-8333-333333333333',
    '11111111-1111-4111-8111-111111111111',
    '9998887773',
    'Arjun Rao',
    28,
    'male',
    '{}',
    'en'
  ),
  (
    '33333333-3333-4333-8333-333333333334',
    '11111111-1111-4111-8111-111111111111',
    '9998887774',
    'Sana Khan',
    31,
    'female',
    '{}',
    'en'
  ),
  (
    '33333333-3333-4333-8333-333333333335',
    '11111111-1111-4111-8111-111111111111',
    '9998887771',
    'Aarav Kumar',
    9,
    'male',
    '{"Peanuts"}',
    'en'
  );

insert into public.tokens (
  id,
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
  consult_duration_seconds
)
values
  (
    '44444444-4444-4444-8444-444444444441',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333331',
    1,
    current_date,
    'complete',
    'walkin',
    'normal',
    'reception',
    now() - interval '70 minutes',
    now() - interval '60 minutes',
    now() - interval '52 minutes',
    'Fever and weakness since yesterday',
    '{"language_detected":"english","primary_symptoms":["fever","weakness"],"duration":"1 day","red_flags":[],"clinical_summary":"Fever and generalized weakness since yesterday.","category":"general"}',
    480
  ),
  (
    '44444444-4444-4444-8444-444444444442',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333332',
    2,
    current_date,
    'serving',
    'walkin',
    'normal',
    'qr',
    now() - interval '35 minutes',
    now() - interval '5 minutes',
    null,
    'Headache and fever for 2 days',
    '{"language_detected":"english","primary_symptoms":["headache","fever"],"duration":"2 days","red_flags":[],"clinical_summary":"Headache and fever for two days.","category":"general"}',
    null
  ),
  (
    '44444444-4444-4444-8444-444444444443',
    '11111111-1111-4111-8111-111111111111',
    '22222222-2222-4222-8222-222222222222',
    '33333333-3333-4333-8333-333333333333',
    3,
    current_date,
    'waiting',
    'walkin',
    'normal',
    'reception',
    now() - interval '20 minutes',
    null,
    null,
    'Cough and sore throat for 3 days',
    '{"language_detected":"english","primary_symptoms":["cough","sore throat"],"duration":"3 days","red_flags":[],"clinical_summary":"Cough and sore throat for three days.","category":"respiratory"}',
    null
  );

insert into public.consult_time_log (
  id,
  clinic_id,
  doctor_id,
  token_id,
  date,
  duration_seconds
)
values (
  '55555555-5555-4555-8555-555555555551',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '44444444-4444-4444-8444-444444444441',
  current_date,
  480
);

insert into public.token_checkout (
  token_id,
  clinic_id,
  doctor_id,
  checkout_stage,
  payment_status,
  pharmacy_status,
  lab_status
)
values (
  '44444444-4444-4444-8444-444444444441',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  'awaiting_payment',
  'pending',
  'pending',
  'pending'
);

insert into public.message_log (
  id,
  token_id,
  patient_phone,
  message_type,
  message_body,
  delivery_status
)
values (
  '66666666-6666-4666-8666-666666666661',
  '44444444-4444-4444-8444-444444444442',
  '9998887772',
  'checkin_confirm',
  'QCare: Token #2. Est. wait: ~16 min.',
  'sent'
);

insert into public.clinic_daily_stats (
  id,
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
  emergency_overrides,
  capacity_utilization,
  consultation_fee,
  estimated_revenue,
  patients_by_hour,
  categories,
  messages_sent,
  messages_delivered,
  messages_failed
)
values (
  '77777777-7777-4777-8777-777777777771',
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  current_date,
  3,
  3,
  0,
  1,
  2,
  5,
  0,
  900,
  480,
  1800,
  0,
  0,
  0,
  6.00,
  500.00,
  1500.00,
  '{"9":1,"10":2}',
  '{"general":2,"respiratory":1}',
  1,
  0,
  0
);

commit;
