-- card_redesign: data columns to support the new Stock Card UI.
--
-- The dashboard card is getting a visual overhaul that adds:
--   • a full trade plan (entry zone, take-profit target, stop loss)
--   • a plain-English "AI read" of the current call
--   • TRIM / EXIT recommendations (in addition to BUY / HOLD / SELL)
--   • volume-spike + 52-week-range indicators
--   • WSB chatter trend (up/down vs prior run)
--   • per-user private notes
--   • per-user dismiss/archive state
--
-- All new fields are NULLABLE so existing rows don't need backfilling —
-- the card treats missing fields as "not yet known" and hides those chips.
-- The scheduled job will start populating these on its next run.
--
-- No RLS self-recursion here. user_notes has its own simple policies
-- gated on profiles.status via SECURITY DEFINER (not shown — policy is
-- auth.uid()-scoped which is already recursion-safe).

-- ─────────────────────────────────────────────────────────────
-- 1. New per-pick columns on stock_alerts
-- ─────────────────────────────────────────────────────────────
ALTER TABLE stock_alerts
  ADD COLUMN IF NOT EXISTS entry_low        numeric(16, 4),
  ADD COLUMN IF NOT EXISTS entry_high       numeric(16, 4),
  ADD COLUMN IF NOT EXISTS target_low       numeric(16, 4),
  ADD COLUMN IF NOT EXISTS target_high      numeric(16, 4),
  ADD COLUMN IF NOT EXISTS stop_loss        numeric(16, 4),
  ADD COLUMN IF NOT EXISTS ai_read          text,
  ADD COLUMN IF NOT EXISTS volume_ratio     numeric(10, 2),
  ADD COLUMN IF NOT EXISTS week52_low       numeric(16, 4),
  ADD COLUMN IF NOT EXISTS week52_high      numeric(16, 4),
  ADD COLUMN IF NOT EXISTS wsb_trend        varchar(8),   -- 'up' | 'down' | 'flat' | null
  ADD COLUMN IF NOT EXISTS dismissed_at     timestamptz;

COMMENT ON COLUMN stock_alerts.entry_low      IS 'AI-suggested entry zone low bound';
COMMENT ON COLUMN stock_alerts.entry_high     IS 'AI-suggested entry zone high bound';
COMMENT ON COLUMN stock_alerts.target_low     IS 'AI-suggested take-profit zone low bound';
COMMENT ON COLUMN stock_alerts.target_high    IS 'AI-suggested take-profit zone high bound';
COMMENT ON COLUMN stock_alerts.stop_loss      IS 'AI-suggested stop-loss price';
COMMENT ON COLUMN stock_alerts.ai_read        IS 'One-line plain-English read on the current call, e.g. "Approaching target, consider trimming"';
COMMENT ON COLUMN stock_alerts.volume_ratio   IS 'Current day volume divided by 30-day avg volume';
COMMENT ON COLUMN stock_alerts.week52_low     IS '52-week low';
COMMENT ON COLUMN stock_alerts.week52_high    IS '52-week high';
COMMENT ON COLUMN stock_alerts.wsb_trend      IS 'Direction of WSB mention count vs prior run: up/down/flat';
COMMENT ON COLUMN stock_alerts.dismissed_at   IS 'User-set timestamp; non-null means hidden from the default view';

-- ─────────────────────────────────────────────────────────────
-- 2. Relax the recommendation check constraint so the scheduled
--    job can emit TRIM and EXIT states. If the old constraint
--    exists we drop it; then add one that covers all five values.
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
BEGIN
  -- Drop any existing check on recommendation (name-agnostic)
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
  CHECK (recommendation IS NULL OR recommendation IN ('BUY','HOLD','SELL','TRIM','EXIT'));

-- Helpful index: filter dismissed rows fast
CREATE INDEX IF NOT EXISTS idx_stock_alerts_dismissed_at
  ON stock_alerts(user_id, dismissed_at);

-- ─────────────────────────────────────────────────────────────
-- 3. user_notes: per-user, per-ticker private notes
-- ─────────────────────────────────────────────────────────────
-- One note per (user, ticker). Ticker-scoped (not alert-scoped) so the
-- same note follows a ticker across multiple alert cycles.
CREATE TABLE IF NOT EXISTS user_notes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  ticker      varchar(16) NOT NULL,
  note        text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, ticker)
);

CREATE INDEX IF NOT EXISTS idx_user_notes_user
  ON user_notes(user_id);

ALTER TABLE user_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users manage their own notes" ON user_notes;
CREATE POLICY "users manage their own notes"
  ON user_notes
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Auto-touch updated_at on UPDATE
CREATE OR REPLACE FUNCTION touch_user_notes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_notes_touch ON user_notes;
CREATE TRIGGER trg_user_notes_touch
  BEFORE UPDATE ON user_notes
  FOR EACH ROW
  EXECUTE FUNCTION touch_user_notes_updated_at();
