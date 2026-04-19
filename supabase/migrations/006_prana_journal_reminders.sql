-- Prāṇa: receptionist's journal + reminders.
--
-- Two small tables so Prāṇa can "remember for you" and "remind you later"
-- through natural language. Scoped per-clinic + per-actor so one receptionist
-- doesn't see another's private notes. No UI yet — Prāṇa interacts via tools.

CREATE TABLE IF NOT EXISTS prana_journal (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  actor_clerk_id text NOT NULL,
  actor_role  text NOT NULL
    CHECK (actor_role IN ('clinic_admin', 'receptionist', 'doctor')),
  -- Optional links — Prāṇa will try to attach a journal entry to the relevant
  -- patient or token when the receptionist mentions one.
  patient_id  uuid REFERENCES patients(id) ON DELETE SET NULL,
  token_id    uuid REFERENCES tokens(id) ON DELETE SET NULL,
  body        text NOT NULL,
  mood        text
    CHECK (mood IS NULL OR mood IN ('calm', 'rushed', 'stressed', 'proud', 'tired', 'curious')),
  tags        text[] DEFAULT '{}'::text[],
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prana_journal_actor_time
  ON prana_journal (clinic_id, actor_clerk_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prana_journal_patient
  ON prana_journal (clinic_id, patient_id, created_at DESC)
  WHERE patient_id IS NOT NULL;

ALTER TABLE prana_journal ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinic isolation prana_journal"
  ON prana_journal
  USING (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());


CREATE TABLE IF NOT EXISTS prana_reminders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  actor_clerk_id text NOT NULL,
  actor_role  text NOT NULL
    CHECK (actor_role IN ('clinic_admin', 'receptionist', 'doctor')),
  patient_id  uuid REFERENCES patients(id) ON DELETE SET NULL,
  token_id    uuid REFERENCES tokens(id) ON DELETE SET NULL,
  title       text NOT NULL,
  details     text,
  remind_at   timestamptz NOT NULL,
  status      text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'dismissed', 'snoozed')),
  completed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prana_reminders_pending
  ON prana_reminders (clinic_id, actor_clerk_id, remind_at)
  WHERE status = 'pending';

ALTER TABLE prana_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Clinic isolation prana_reminders"
  ON prana_reminders
  USING (clinic_id = current_clinic_id())
  WITH CHECK (clinic_id = current_clinic_id());
