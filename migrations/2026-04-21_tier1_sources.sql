-- Migration: Tier 1 source upgrade
-- Date: 2026-04-21
-- Owner: AJ
-- Context: the existing 6 sources were all lagging indicators — by the time
-- WSB/Yahoo-trending surfaced a catalyst-driven runner (e.g. ENVB +128%,
-- TOVX +82% on 2026-04-20), the stock had already blown past our +20%
-- anti-surge cap. This migration adds 4 leading-indicator sources plus one
-- bonus (NASDAQ halt feed), retires one dead source (google_finance), and
-- prepares stock_alerts for FDA/PDUFA catalyst metadata.

BEGIN;

-- 1. Drop retired google_finance row
DELETE FROM source_health WHERE source = 'google_finance';

-- 2. Seed 5 new source_health rows (start 'ok' pending first scan)
INSERT INTO source_health (source, status, consecutive_failures, last_success_at)
VALUES
  ('yahoo_premarket',  'ok', 0, now()),
  ('sec_edgar',        'ok', 0, now()),
  ('biopharmcatalyst', 'ok', 0, now()),
  ('apewisdom',        'ok', 0, now()),
  ('nasdaq_halt',      'ok', 0, now())
ON CONFLICT (source) DO NOTHING;

-- 3. Add catalyst metadata columns to stock_alerts
--    (used by the new Section 3e FDA calendar scan to store look-ahead dates)
ALTER TABLE stock_alerts
  ADD COLUMN IF NOT EXISTS catalyst_date date;
ALTER TABLE stock_alerts
  ADD COLUMN IF NOT EXISTS catalyst_type text;  -- 'PDUFA' | 'ADCOM' | 'PHASE3' | 'EARNINGS' | '8K'

COMMIT;

-- Verification query (informational; safe to run post-commit):
--   SELECT source, status FROM source_health ORDER BY source;
-- Expected 10 rows:
--   apewisdom, biopharmcatalyst, kalshi, nasdaq_halt, polymarket,
--   sec_edgar, stooq, wsb, yahoo, yahoo_premarket
