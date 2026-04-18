-- Add previous_close to current_prices so each card can show
-- "Today ±X.X%" (current price vs. prior session's close) in addition
-- to the existing "since alert" lifetime gain.
--
-- Why this exists
--   The card header previously showed two copies of the same
--   since-alert % — once under the ticker and once in the BUY box.
--   That redundancy was replaced with a day-over-day daily change,
--   which needs a per-ticker "previous close" reference point.
--
-- Populated by
--   The daily scheduled task fetches `regularMarketPreviousClose` from
--   Yahoo Finance alongside the live quote and upserts both fields into
--   current_prices. Nullable so existing rows work until the next refresh.

ALTER TABLE current_prices
  ADD COLUMN IF NOT EXISTS previous_close numeric(16, 4);

-- No index needed; this column is only read via the PK ticker lookup.
