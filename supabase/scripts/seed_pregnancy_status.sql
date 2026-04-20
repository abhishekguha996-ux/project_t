-- Realistic pregnancy_status backfill.
--
-- Policy (Indian OPD clinic norms):
--   • Males:             not_pregnant (deterministic)
--   • Females 20–40:     ~4% pregnant, ~2% prefer_not_to_say, rest not_pregnant
--   • Females elsewhere: not_pregnant
--   • Other / null:      unknown (default, left alone)
--
-- Uses a deterministic hash of patient_id so re-runs are idempotent.

UPDATE patients
SET pregnancy_status = 'not_pregnant'
WHERE gender = 'male';

UPDATE patients
SET pregnancy_status = CASE
  WHEN age IS NULL OR age < 20 OR age > 40 THEN 'not_pregnant'
  WHEN (abs(hashtextextended(id::text, 97)) % 100) < 8 THEN 'pregnant'
  WHEN (abs(hashtextextended(id::text, 131)) % 100) < 6 THEN 'prefer_not_to_say'
  ELSE 'not_pregnant'
END
WHERE gender = 'female';
