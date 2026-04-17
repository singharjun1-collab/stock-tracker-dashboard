-- current_prices: one row per ticker with the latest known quote.
--
-- Why this exists
--   Before this table, Portfolio and Leaderboard looked up "current price"
--   by scanning the last element of alerts[].prices[] in the logged-in
--   user's alert feed. That coupled pricing to the viewer's per-user alert
--   rows, which caused two bugs:
--     1. Positions in tickers that had been 'dropped' from the scanner
--        never got fresh prices (the daily job only refreshes new/active).
--     2. The Leaderboard priced every user's open positions using the
--        VIEWER's alerts list, so per-user timing variance silently
--        produced wrong P/L (e.g. Andy S showing $0.00 because AJ's
--        alert snapshot happened to match Andy's entry prices).
--
-- New flow
--   - One shared ticker->price table, readable by all approved users.
--   - Scheduled job keeps it fresh via a trigger on stock_prices, so no
--     duplicate write-paths.
--   - Portfolio + Leaderboard read from /api/prices instead of walking
--     alerts[].prices[].

CREATE TABLE IF NOT EXISTS current_prices (
  ticker      varchar(16) PRIMARY KEY,
  price       numeric(16, 4) NOT NULL,
  price_date  date NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_current_prices_updated_at
  ON current_prices(updated_at DESC);

-- RLS: every approved user can SELECT; writes are via service role only.
ALTER TABLE current_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "approved users can read current prices" ON current_prices;
CREATE POLICY "approved users can read current prices"
  ON current_prices
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.status = 'approved'
    )
  );

-- Trigger: whenever stock_prices gets a new/updated row for a ticker,
-- upsert it into current_prices so Portfolio/Leaderboard always see the
-- latest quote without needing to join through alerts.
CREATE OR REPLACE FUNCTION sync_current_prices() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_ticker varchar(16);
BEGIN
  SELECT sa.ticker INTO v_ticker
  FROM stock_alerts sa
  WHERE sa.id = NEW.alert_id;

  IF v_ticker IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO current_prices (ticker, price, price_date, updated_at)
  VALUES (v_ticker, NEW.price, NEW.price_date, NOW())
  ON CONFLICT (ticker) DO UPDATE
    SET price      = EXCLUDED.price,
        price_date = EXCLUDED.price_date,
        updated_at = NOW()
    -- Only overwrite if the incoming row is newer than what's stored.
    WHERE EXCLUDED.price_date >  current_prices.price_date
       OR (EXCLUDED.price_date = current_prices.price_date
           AND NOW() >= current_prices.updated_at);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stock_prices_sync_current ON stock_prices;
CREATE TRIGGER trg_stock_prices_sync_current
  AFTER INSERT OR UPDATE ON stock_prices
  FOR EACH ROW EXECUTE FUNCTION sync_current_prices();

-- Backfill: populate current_prices with the most-recent price per ticker
-- from existing stock_prices history. DISTINCT ON keeps the latest row
-- (ORDER BY price_date DESC, created_at DESC) per ticker.
INSERT INTO current_prices (ticker, price, price_date, updated_at)
SELECT DISTINCT ON (sa.ticker)
  sa.ticker,
  sp.price,
  sp.price_date,
  sp.created_at
FROM stock_prices sp
JOIN stock_alerts sa ON sa.id = sp.alert_id
ORDER BY sa.ticker, sp.price_date DESC, sp.created_at DESC
ON CONFLICT (ticker) DO UPDATE
  SET price      = EXCLUDED.price,
      price_date = EXCLUDED.price_date,
      updated_at = EXCLUDED.updated_at
  WHERE EXCLUDED.price_date >  current_prices.price_date
     OR (EXCLUDED.price_date = current_prices.price_date
         AND EXCLUDED.updated_at >= current_prices.updated_at);
