-- Reset checked_in_at for today's active tokens to a random interval of 1–4
-- hours ago. Demo only — avoids the "24h14m waited" display caused by stale
-- tokens rolling over past midnight.
--
-- Scope: tokens dated today that are still in flight (not already closed out).

UPDATE tokens
SET checked_in_at = now() - (1 + random() * 3) * interval '1 hour'
WHERE date = CURRENT_DATE
  AND status IN ('waiting', 'serving', 'held', 'on_hold');

-- For any currently-serving token, also freshen serving_started_at so elapsed
-- consultation time stays believable (0–8 minutes in).
UPDATE tokens
SET serving_started_at = now() - (random() * 8) * interval '1 minute'
WHERE date = CURRENT_DATE
  AND status = 'serving'
  AND serving_started_at IS NOT NULL;
