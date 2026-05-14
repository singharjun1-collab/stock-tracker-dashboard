-- riding_state: add 6th recommendation value + trail-stop columns
--
-- BACKGROUND (2026-05-14):
-- The five-state rec enum (BUY/HOLD/TRIM/EXIT/SELL) used an arbitrary
-- +20% upside cap to flip winners to EXIT. This left real momentum on
-- the table — e.g. AMD ran $321 → $445 (+38.7%) with signal still
-- STRONG and WSB chatter firing 11x, but the card showed EXIT because
-- the +20% cap had been hit weeks earlier.
--
-- New design: a 6th state `RIDING` replaces the arbitrary cap with
-- signal-aware exits. When a pick crosses its target zone AND signals
-- are still firing AND no bearish catalyst, we flip to `RIDING` and
-- write a trailing stop instead of an EXIT. The trail stop ratchets
-- up as new highs are made (8% below recent high, AJ-chosen), never
-- moves down, and the system only flips to EXIT when:
--    • signal_strength drops below 40, OR
--    • price hits trail_stop, OR
--    • a bearish catalyst lands.
--
-- All new columns are NULLABLE — existing rows don't need backfilling.
-- The trail-stop ratchet runs in the existing /api/refresh-prices cron
-- (every 30 min Mon-Fri 12-23 UTC) so it gets evaluated on every price
-- tick. The scan SKILL (Section 4a) writes the initial trail_stop and
-- recent_high values when it first promotes an alert to RIDING.
--
-- RLS: no changes. stock_alerts policies already gate by user_id and
-- the helper functions are SECURITY DEFINER (no self-recursion).

-- ─────────────────────────────────────────────────────────────
-- 1. New per-pick columns on stock_alerts
-- ─────────────────────────────────────────────────────────────
ALTER TABLE stock_alerts
  ADD COLUMN IF NOT EXISTS trail_stop        numeric(16, 4),
  ADD COLUMN IF NOT EXISTS recent_high       numeric(16, 4),
  ADD COLUMN IF NOT EXISTS riding_entered_at timestamptz;

COMMENT ON COLUMN stock_alerts.trail_stop        IS 'Trailing stop price for RIDING state — 8% below recent_high, only ratchets up';
COMMENT ON COLUMN stock_alerts.recent_high       IS 'Highest price observed since entering RIDING; drives trail_stop';
COMMENT ON COLUMN stock_alerts.riding_entered_at IS 'When this alert first flipped to RIDING (NULL if never rode)';

-- ─────────────────────────────────────────────────────────────
-- 2. Expand the recommendation check constraint to include RIDING
-- ─────────────────────────────────────────────────────────────
-- Drop ANY existing recommendation check (defensive — same idiom as
-- 2026-04-17 card_redesign so we don't collide on constraint names).
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'stock_alerts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%recommendation%'
  LOOP
    EXECUTE 'ALTER TABLE stock_alerts DROP CONSTRAINT ' || quote_ident(r.conname);
  END LOOP;
END $$;

ALTER TABLE stock_alerts
  ADD CONSTRAINT stock_alerts_recommendation_check
  CHECK (recommendation IS NULL OR recommendation IN ('BUY','HOLD','SELL','TRIM','EXIT','RIDING'));

-- ─────────────────────────────────────────────────────────────
-- 3. Indexes — keep the Riding tab + ratchet job fast
-- ─────────────────────────────────────────────────────────────
-- The Riding tab filters on (user_id, recommendation='RIDING', status='active'),
-- and the trail-stop ratchet job loads exactly that set every 30 min.
CREATE INDEX IF NOT EXISTS idx_stock_alerts_riding
  ON stock_alerts(user_id, recommendation, status)
  WHERE recommendation = 'RIDING';

-- ─────────────────────────────────────────────────────────────
-- 4. Sanity verification
-- ─────────────────────────────────────────────────────────────
-- Confirm the constraint accepts RIDING. If this raises, the
-- migration left the table in a bad state and Vercel deploys will
-- start rejecting RIDING writes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stock_alerts'::regclass
      AND conname  = 'stock_alerts_recommendation_check'
      AND pg_get_constraintdef(oid) ILIKE '%RIDING%'
  ) THEN
    RAISE EXCEPTION 'riding_state migration: recommendation_check constraint did not include RIDING';
  END IF;
END $$;
