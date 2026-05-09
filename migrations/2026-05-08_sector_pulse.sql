-- sector_pulse: tables to support the new "Sector Pulse" feature.
--
-- The dashboard is getting a horizontally-scrolling Sector Pulse row + filter
-- chips + an AI-generated macro read per sector. To support that without
-- touching any existing card columns, we add two new tables:
--
--   1. ticker_meta   — canonical sector/industry per ticker (one row per ticker)
--                       Same ticker reappears in many stock_alerts rows across
--                       cycles + users; sector is a property of the ticker,
--                       not the alert. Mirrors how user_notes is ticker-scoped.
--
--   2. sector_pulse  — daily AI macro read per sector. Append-only history so
--                       we can trend buzz/sentiment over time. UI reads the
--                       latest row per sector.
--
-- Everything here is purely ADDITIVE. No existing column is changed, dropped,
-- or renamed. The card UI continues to work unchanged if these tables are
-- empty — the new pulse row only renders when ENABLE_SECTOR_PULSE is on AND
-- ticker_meta has at least one row.
--
-- RLS notes:
--   • Both tables are GLOBAL (not per-user) — sector data is the same for
--     everyone. Read = any authenticated user. Write = service role only.
--   • No self-recursion (we never query these tables from inside their own
--     policies — feedback_supabase_rls_no_self_recursion).

-- ─────────────────────────────────────────────────────────────
-- 1. ticker_meta — canonical sector/industry per ticker
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ticker_meta (
  ticker          varchar(16) PRIMARY KEY,
  sector          varchar(64),                -- broad: "Technology", "Energy", ...
  industry        varchar(96),                -- finer: "Semiconductors", "Computer Hardware", ...
  display_name    varchar(128),               -- friendly company name from Yahoo
  source          varchar(32) DEFAULT 'yahoo',-- where classification came from
  classified_at   timestamptz,                -- last successful classification
  last_attempt_at timestamptz,                -- last attempt (success or fail)
  last_error      text,                       -- non-null if last attempt failed
  created_at      timestamptz NOT NULL DEFAULT NOW(),
  updated_at      timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE  ticker_meta              IS 'Canonical sector/industry classification per ticker. Populated by /api/classify-sectors.';
COMMENT ON COLUMN ticker_meta.sector       IS 'Broad sector from Yahoo (Technology, Energy, Healthcare, etc). NULL until classified.';
COMMENT ON COLUMN ticker_meta.industry     IS 'Finer industry from Yahoo (Semiconductors, etc). Used as the primary grouping in the UI.';
COMMENT ON COLUMN ticker_meta.last_error   IS 'Set when classification fails so /api/source-health can surface it in the admin banner.';

CREATE INDEX IF NOT EXISTS idx_ticker_meta_industry ON ticker_meta(industry);
CREATE INDEX IF NOT EXISTS idx_ticker_meta_sector   ON ticker_meta(sector);

ALTER TABLE ticker_meta ENABLE ROW LEVEL SECURITY;

-- Read: any authenticated, approved user. We do NOT query stock_alerts here
-- (that would create cross-table recursion risk). We trust the profiles.status
-- check that wraps every API route — if a user reaches the /api layer they're
-- approved. RLS is a defence-in-depth, not the primary gate.
DROP POLICY IF EXISTS "ticker_meta read" ON ticker_meta;
CREATE POLICY "ticker_meta read"
  ON ticker_meta
  FOR SELECT
  TO authenticated
  USING (true);

-- Writes happen only via service role (CRON_SECRET-gated /api/classify-sectors).
-- No INSERT/UPDATE policy for `authenticated` — service role bypasses RLS.

-- Auto-touch updated_at. search_path pinned so the function can't be tricked
-- by a hostile schema (advisor lint 0011_function_search_path_mutable).
CREATE OR REPLACE FUNCTION touch_ticker_meta_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ticker_meta_touch ON ticker_meta;
CREATE TRIGGER trg_ticker_meta_touch
  BEFORE UPDATE ON ticker_meta
  FOR EACH ROW
  EXECUTE FUNCTION touch_ticker_meta_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 2. sector_pulse — daily AI macro read per sector
-- ─────────────────────────────────────────────────────────────
-- Append-only history. UI fetches the latest row per sector via DISTINCT ON.
-- 7d sentiment trend = the seven most recent rows for that sector.
--
-- "sector" here means "industry" by default (the fine-grained Yahoo bucket)
-- because that's how the UI groups cards. Storing as a flexible string lets
-- us also pulse on broad sectors or custom themes (e.g. "AI") later without
-- a schema change.
CREATE TABLE IF NOT EXISTS sector_pulse (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_key       varchar(96) NOT NULL,        -- canonical key, e.g. "semiconductors"
  sector_label     varchar(96) NOT NULL,        -- display label, e.g. "Semiconductors"
  scope            varchar(16) NOT NULL DEFAULT 'industry'
                                                CHECK (scope IN ('industry','sector','theme')),
  summary          text NOT NULL,               -- AI-generated 2-line read (sources cited)
  sentiment_label  varchar(16)
                   CHECK (sentiment_label IS NULL
                          OR sentiment_label IN ('v_bull','bull','neutral','mixed','bear','v_bear')),
  sentiment_score  numeric(4, 3),               -- -1.000 to 1.000
  news_count       integer DEFAULT 0,
  social_count     integer DEFAULT 0,           -- combined Reddit upvote-weighted count
  buzz_label       varchar(16)
                   CHECK (buzz_label IS NULL
                          OR buzz_label IN ('low','medium','high','v_high')),
  pct_today        numeric(6, 2),               -- % move of constituent tickers, equal-weighted
  pct_7d           numeric(6, 2),               -- 7d %, same weighting
  top_tickers      jsonb,                       -- [{ticker, pct_today, pct_7d}], up to 5
  sources          jsonb,                       -- {yahoo:[urls], reddit:[urls]} for transparency
  ai_model         varchar(64),                 -- which model produced the summary
  generated_at     timestamptz NOT NULL DEFAULT NOW(),
  last_error       text                         -- non-null if generation failed
);

COMMENT ON TABLE  sector_pulse                  IS 'Daily AI macro read per sector. Append-only; UI uses latest row per sector_key.';
COMMENT ON COLUMN sector_pulse.scope            IS 'Which level: industry (default), sector (broader), theme (custom cross-sector tag like AI).';
COMMENT ON COLUMN sector_pulse.summary          IS 'AI-generated 2-line plain-English read pulling from news + Reddit. Always cites which sources were used in `sources`.';
COMMENT ON COLUMN sector_pulse.sources          IS 'JSONB pointer back to the source URLs that fed this summary. For transparency + debugging.';
COMMENT ON COLUMN sector_pulse.last_error       IS 'Set when AI generation or source fetch failed. Surfaced in admin source_health banner.';

CREATE INDEX IF NOT EXISTS idx_sector_pulse_key_recent
  ON sector_pulse(sector_key, generated_at DESC);

CREATE INDEX IF NOT EXISTS idx_sector_pulse_recent
  ON sector_pulse(generated_at DESC);

ALTER TABLE sector_pulse ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sector_pulse read" ON sector_pulse;
CREATE POLICY "sector_pulse read"
  ON sector_pulse
  FOR SELECT
  TO authenticated
  USING (true);

-- Writes via service role only (CRON_SECRET-gated /api/sector-pulse-refresh).

-- ─────────────────────────────────────────────────────────────
-- 3. Convenience view: latest pulse per sector
-- ─────────────────────────────────────────────────────────────
-- Saves the dashboard from doing a DISTINCT ON in JS.
-- security_invoker = true so the RLS on sector_pulse applies to the caller's
-- role (advisor lint 0010_security_definer_view). Without this, views default
-- to SECURITY DEFINER on Postgres and bypass row-level security.
CREATE OR REPLACE VIEW sector_pulse_latest
  WITH (security_invoker = true) AS
  SELECT DISTINCT ON (sector_key)
    sector_key,
    sector_label,
    scope,
    summary,
    sentiment_label,
    sentiment_score,
    news_count,
    social_count,
    buzz_label,
    pct_today,
    pct_7d,
    top_tickers,
    sources,
    ai_model,
    generated_at,
    last_error
  FROM sector_pulse
  ORDER BY sector_key, generated_at DESC;

COMMENT ON VIEW sector_pulse_latest IS 'Latest pulse row per sector_key. Used by /api/sector-pulse and the dashboard.';
