-- Seed prior-date tokens so roughly half of today's patients appear as
-- "Returning" in the dossier (totalVisits > 1, lastToken populated).

WITH today_patients AS (
  SELECT DISTINCT patient_id, clinic_id, doctor_id
  FROM tokens
  WHERE date = CURRENT_DATE
),
picked AS (
  SELECT *
  FROM today_patients
  WHERE (abs(hashtextextended(patient_id::text, 42)) % 100) < 55
),
visit_counts AS (
  SELECT
    patient_id,
    clinic_id,
    doctor_id,
    (1 + (abs(hashtextextended(patient_id::text, 7)) % 3))::int AS n_visits
  FROM picked
),
expanded AS (
  SELECT
    vc.patient_id,
    vc.clinic_id,
    vc.doctor_id,
    gs AS visit_idx,
    (CURRENT_DATE
      - ((7 + (abs(hashtextextended(vc.patient_id::text || gs::text, 11)) % 174))::int))
      AS visit_date
  FROM visit_counts vc
  CROSS JOIN LATERAL generate_series(1, vc.n_visits) AS gs
),
complaints AS (
  SELECT row_number() OVER () - 1 AS idx, text
  FROM unnest(ARRAY[
    'Follow-up for hypertension',
    'Recurring headache, asked about BP',
    'Diabetic review, HbA1c report',
    'Cough and cold, mild fever',
    'Back pain since last week',
    'Acidity, heartburn after meals',
    'Joint pain, knee discomfort',
    'Skin rash on forearm',
    'Persistent cough, dry',
    'Routine BP and sugar check',
    'Fatigue, feeling run down',
    'Mild chest tightness, resolved',
    'Thyroid review, TSH report',
    'Ear pain, right side',
    'Sore throat and body ache',
    'Menstrual irregularities',
    'Anxiety and sleep disturbance',
    'Shoulder stiffness',
    'Allergic rhinitis flare-up',
    'Routine annual checkup'
  ]) AS text
)
INSERT INTO tokens (
  clinic_id,
  doctor_id,
  patient_id,
  token_number,
  date,
  status,
  type,
  checkin_channel,
  checked_in_at,
  serving_started_at,
  completed_at,
  raw_complaint
)
SELECT
  e.clinic_id,
  e.doctor_id,
  e.patient_id,
  (1 + (abs(hashtextextended(e.patient_id::text || e.visit_date::text, 17)) % 60))::int AS token_number,
  e.visit_date,
  'complete',
  'walkin',
  CASE WHEN (abs(hashtextextended(e.patient_id::text || e.visit_idx::text, 19)) % 2) = 0
    THEN 'qr' ELSE 'reception' END,
  e.visit_date::timestamp + interval '10 hour' + (random() * interval '7 hour'),
  e.visit_date::timestamp + interval '10 hour' + (random() * interval '7 hour'),
  e.visit_date::timestamp + interval '10 hour' + (random() * interval '7 hour') + interval '8 minute',
  (SELECT text FROM complaints
   WHERE idx = (abs(hashtextextended(e.patient_id::text || e.visit_idx::text, 23)) % 20)
   LIMIT 1)
FROM expanded e
ON CONFLICT (clinic_id, doctor_id, date, token_number) DO NOTHING;
