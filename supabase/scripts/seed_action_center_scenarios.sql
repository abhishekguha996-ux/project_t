-- Seed eight India-flavoured dummy patients, each scripted to light up a
-- different Action Center call-to-action for the receptionist:
--
--   1. Rakesh Kumar    — Red-flag chest pain (25 min waited, Star Health)
--   2. Savita Devi     — Red-flag stroke-ish (Hindi complaint, Sulfa allergy)
--   3. Ananya Iyer     — Red-flag breathing (Tamil speaker, HDFC ERGO)
--   4. Vijay Reddy     — QR check-in whose SMS failed (needs a call)
--   5. Kavya Nair      — Held MID-consult (returning from bathroom) — resume
--   6. Harish Menon    — Routine hold EXPIRED — skip or return
--   7. Lakshmi Pillai  — Routine hold ACTIVE — waiting for family
--   8. Dr. Priya Nair  — queue paused (tea break, 20 min)
--
-- All tokens dated CURRENT_DATE; token_number range 201..220 to avoid
-- colliding with the main seed.

DO $$
DECLARE
  v_clinic    uuid := '11111111-1111-4111-8111-111111111111';
  v_meera     uuid := '22222222-2222-4222-8222-222222222222';
  v_arjun     uuid := '22222222-2222-4222-8222-222222222223';
  v_priya     uuid := '22222222-2222-4222-8222-222222222224';

  v_rakesh    uuid;
  v_savita    uuid;
  v_ananya    uuid;
  v_vijay     uuid;
  v_kavya     uuid;
  v_harish    uuid;
  v_lakshmi   uuid;

  v_tok_rakesh   uuid;
  v_tok_savita   uuid;
  v_tok_ananya   uuid;
  v_tok_vijay    uuid;
  v_tok_kavya    uuid;
  v_tok_harish   uuid;
  v_tok_lakshmi  uuid;
BEGIN
  /* ============ Patients ============ */

  INSERT INTO patients (clinic_id, phone, name, age, gender, language_preference, allergies, insurance_provider, insurance_policy_number)
  VALUES
    (v_clinic, '+919900011101', 'Rakesh Kumar',    58, 'male',   'hi', ARRAY['Penicillin']::text[],  'Star Health',     'STR-4471082'),
    (v_clinic, '+919900011102', 'Savita Devi',     62, 'female', 'hi', ARRAY['Sulfa drugs']::text[], NULL,              NULL),
    (v_clinic, '+919900011103', 'Ananya Iyer',     45, 'female', 'ta', ARRAY[]::text[],              'HDFC ERGO',       'HDF-2209551'),
    (v_clinic, '+919900011104', 'Vijay Reddy',     40, 'male',   'te', ARRAY[]::text[],              NULL,              NULL),
    (v_clinic, '+919900011105', 'Kavya Nair',      35, 'female', 'ml', ARRAY[]::text[],              'ICICI Lombard',   'ICL-7782014'),
    (v_clinic, '+919900011106', 'Harish Menon',    50, 'male',   'en', ARRAY[]::text[],              NULL,              NULL),
    (v_clinic, '+919900011107', 'Lakshmi Pillai',  48, 'female', 'hi', ARRAY[]::text[],              'Bajaj Allianz',   'BAJ-3356190')
  ON CONFLICT (clinic_id, phone, name) DO UPDATE
    SET age = EXCLUDED.age,
        gender = EXCLUDED.gender,
        language_preference = EXCLUDED.language_preference,
        allergies = EXCLUDED.allergies,
        insurance_provider = EXCLUDED.insurance_provider,
        insurance_policy_number = EXCLUDED.insurance_policy_number;

  SELECT id INTO v_rakesh   FROM patients WHERE clinic_id = v_clinic AND phone = '+919900011101' AND name = 'Rakesh Kumar';
  SELECT id INTO v_savita   FROM patients WHERE clinic_id = v_clinic AND phone = '+919900011102' AND name = 'Savita Devi';
  SELECT id INTO v_ananya   FROM patients WHERE clinic_id = v_clinic AND phone = '+919900011103' AND name = 'Ananya Iyer';
  SELECT id INTO v_vijay    FROM patients WHERE clinic_id = v_clinic AND phone = '+919900011104' AND name = 'Vijay Reddy';
  SELECT id INTO v_kavya    FROM patients WHERE clinic_id = v_clinic AND phone = '+919900011105' AND name = 'Kavya Nair';
  SELECT id INTO v_harish   FROM patients WHERE clinic_id = v_clinic AND phone = '+919900011106' AND name = 'Harish Menon';
  SELECT id INTO v_lakshmi  FROM patients WHERE clinic_id = v_clinic AND phone = '+919900011107' AND name = 'Lakshmi Pillai';

  /* ============ Tokens for today ============ */

  INSERT INTO tokens (clinic_id, doctor_id, patient_id, token_number, date, status, type, checkin_channel, checked_in_at, raw_complaint, proximity_status)
  VALUES
    -- Red flag — chest pain, 25 min waited (priority should climb high)
    (v_clinic, v_meera,  v_rakesh,   201, CURRENT_DATE, 'waiting', 'walkin', 'qr',        now() - interval '25 minutes',
      'Sudden chest pain since morning, pain radiating to left arm, cold sweat', 'in_clinic'),
    -- Red flag — Hindi complaint with stroke-ish keywords
    (v_clinic, v_arjun,  v_savita,   202, CURRENT_DATE, 'waiting', 'walkin', 'reception', now() - interval '12 minutes',
      'Face drooping, right arm numb, chhati mein bhaari since morning', 'in_clinic'),
    -- Red flag — breathing, Tamil speaker
    (v_clinic, v_priya,  v_ananya,   203, CURRENT_DATE, 'waiting', 'walkin', 'qr',        now() - interval '18 minutes',
      'Breathless since yesterday, dum ghut raha hai, worse when lying down', 'nearby'),
    -- SMS failed QR patient
    (v_clinic, v_meera,  v_vijay,    204, CURRENT_DATE, 'waiting', 'walkin', 'qr',        now() - interval '32 minutes',
      'Fever for 3 days with body ache and mild cough', 'unknown'),
    -- Held mid-consult (stepped out during serving) — needs full event_log trail
    (v_clinic, v_arjun,  v_kavya,    205, CURRENT_DATE, 'stepped_out', 'walkin', 'reception', now() - interval '45 minutes',
      'Acidity follow-up, PPI tablets finishing this week', 'in_clinic'),
    -- Expired routine hold from waiting
    (v_clinic, v_priya,  v_harish,   206, CURRENT_DATE, 'stepped_out', 'walkin', 'reception', now() - interval '55 minutes',
      'BP review, tablet reorder', 'in_clinic'),
    -- Active routine hold from waiting
    (v_clinic, v_meera,  v_lakshmi,  207, CURRENT_DATE, 'stepped_out', 'walkin', 'reception', now() - interval '22 minutes',
      'Knee joint pain, physiotherapy follow-up', 'in_clinic')
  ON CONFLICT (clinic_id, doctor_id, date, token_number) DO NOTHING;

  -- Fetch the token IDs we just inserted (or found)
  SELECT id INTO v_tok_rakesh   FROM tokens WHERE clinic_id = v_clinic AND doctor_id = v_meera AND date = CURRENT_DATE AND token_number = 201;
  SELECT id INTO v_tok_savita   FROM tokens WHERE clinic_id = v_clinic AND doctor_id = v_arjun AND date = CURRENT_DATE AND token_number = 202;
  SELECT id INTO v_tok_ananya   FROM tokens WHERE clinic_id = v_clinic AND doctor_id = v_priya AND date = CURRENT_DATE AND token_number = 203;
  SELECT id INTO v_tok_vijay    FROM tokens WHERE clinic_id = v_clinic AND doctor_id = v_meera AND date = CURRENT_DATE AND token_number = 204;
  SELECT id INTO v_tok_kavya    FROM tokens WHERE clinic_id = v_clinic AND doctor_id = v_arjun AND date = CURRENT_DATE AND token_number = 205;
  SELECT id INTO v_tok_harish   FROM tokens WHERE clinic_id = v_clinic AND doctor_id = v_priya AND date = CURRENT_DATE AND token_number = 206;
  SELECT id INTO v_tok_lakshmi  FROM tokens WHERE clinic_id = v_clinic AND doctor_id = v_meera AND date = CURRENT_DATE AND token_number = 207;

  /* ============ Hold window timing ============ */

  -- Kavya: held mid-consult, 15 min left
  UPDATE tokens
  SET hold_until = now() + interval '15 minutes',
      hold_note = 'Bathroom break',
      hold_set_by_role = 'receptionist',
      serving_started_at = now() - interval '18 minutes'
  WHERE id = v_tok_kavya;

  -- Harish: hold expired 10 min ago
  UPDATE tokens
  SET hold_until = now() - interval '10 minutes',
      hold_note = 'Stepped out for paperwork',
      hold_set_by_role = 'receptionist'
  WHERE id = v_tok_harish;

  -- Lakshmi: hold active, 8 min left
  UPDATE tokens
  SET hold_until = now() + interval '8 minutes',
      hold_note = 'Waiting for family member to arrive',
      hold_set_by_role = 'receptionist'
  WHERE id = v_tok_lakshmi;

  /* ============ Event log (drives held_from_state) ============ */

  -- Kavya: start_consultation (waiting → serving), then hold_slot (serving → stepped_out)
  INSERT INTO token_event_log (token_id, clinic_id, doctor_id, action, from_state, to_state, actor_role, created_at)
  VALUES
    (v_tok_kavya, v_clinic, v_arjun, 'start_consultation', 'waiting', 'serving',     'receptionist', now() - interval '20 minutes'),
    (v_tok_kavya, v_clinic, v_arjun, 'hold_slot',          'serving', 'stepped_out', 'receptionist', now() - interval '2 minutes');

  -- Harish: hold_slot from waiting
  INSERT INTO token_event_log (token_id, clinic_id, doctor_id, action, from_state, to_state, actor_role, created_at)
  VALUES
    (v_tok_harish, v_clinic, v_priya, 'hold_slot', 'waiting', 'stepped_out', 'receptionist', now() - interval '25 minutes');

  -- Lakshmi: hold_slot from waiting
  INSERT INTO token_event_log (token_id, clinic_id, doctor_id, action, from_state, to_state, actor_role, created_at)
  VALUES
    (v_tok_lakshmi, v_clinic, v_meera, 'hold_slot', 'waiting', 'stepped_out', 'receptionist', now() - interval '7 minutes');

  /* ============ SMS delivery log — Vijay failed ============ */

  INSERT INTO message_log (token_id, patient_phone, message_type, message_body, delivery_status, sent_at)
  VALUES
    (v_tok_vijay, '+919900011104', 'checkin_confirm',
      'Hi Vijay, check-in received. Token #204 — you will be called soon.',
      'failed', now() - interval '30 minutes');

  /* ============ Queue pause for Dr. Priya ============ */

  UPDATE doctor_queue_pauses SET is_active = false, ended_at = now()
  WHERE doctor_id = v_priya AND is_active = true;

  INSERT INTO doctor_queue_pauses (clinic_id, doctor_id, reason, note, starts_at, ends_at, is_active, created_by_clerk_id, created_by_role)
  VALUES
    (v_clinic, v_priya, 'personal_emergency', 'Tea break', now() - interval '2 minutes',
      now() + interval '18 minutes', true, 'seed-script', 'receptionist');

  /* ============ Prior visits — make Rakesh, Kavya & Harish "Returning" ============ */

  INSERT INTO tokens (clinic_id, doctor_id, patient_id, token_number, date, status, type, checkin_channel, checked_in_at, serving_started_at, completed_at, raw_complaint)
  VALUES
    (v_clinic, v_meera, v_rakesh, 301, CURRENT_DATE - 14,
      'complete', 'walkin', 'reception',
      (CURRENT_DATE - 14)::timestamp + interval '10 hour',
      (CURRENT_DATE - 14)::timestamp + interval '10 hour 5 minutes',
      (CURRENT_DATE - 14)::timestamp + interval '10 hour 18 minutes',
      'Routine BP review, ECG requested'),
    (v_clinic, v_meera, v_rakesh, 302, CURRENT_DATE - 45,
      'complete', 'walkin', 'reception',
      (CURRENT_DATE - 45)::timestamp + interval '11 hour',
      (CURRENT_DATE - 45)::timestamp + interval '11 hour 3 minutes',
      (CURRENT_DATE - 45)::timestamp + interval '11 hour 14 minutes',
      'Hypertension follow-up, tablet reorder'),
    (v_clinic, v_arjun, v_kavya, 303, CURRENT_DATE - 9,
      'complete', 'walkin', 'qr',
      (CURRENT_DATE - 9)::timestamp + interval '9 hour 30 minute',
      (CURRENT_DATE - 9)::timestamp + interval '9 hour 35 minute',
      (CURRENT_DATE - 9)::timestamp + interval '9 hour 50 minute',
      'Acidity since last week, started on PPI'),
    (v_clinic, v_priya, v_harish, 304, CURRENT_DATE - 22,
      'complete', 'walkin', 'reception',
      (CURRENT_DATE - 22)::timestamp + interval '12 hour',
      (CURRENT_DATE - 22)::timestamp + interval '12 hour 4 minutes',
      (CURRENT_DATE - 22)::timestamp + interval '12 hour 15 minutes',
      'BP tablet refill, mild dizziness in mornings')
  ON CONFLICT (clinic_id, doctor_id, date, token_number) DO NOTHING;
END $$;
