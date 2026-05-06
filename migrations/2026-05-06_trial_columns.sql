-- ────────────────────────────────────────────────────────────────────
-- Stock Chatter — 7-day no-CC trial timestamps
-- Date: 2026-05-06
--
-- Adds two timestamp columns to public.profiles so we can grant new
-- signups a 7-day free trial without requiring a credit card upfront.
--
-- The trial is enforced ENTIRELY in our app (auth callback + dashboard
-- gate + /upgrade paywall). We do NOT use Lemon Squeezy's built-in
-- trial — that requires a card at checkout, which is exactly what
-- we want to avoid. Lemon Squeezy is only involved when the user
-- actually pays at the end of the trial.
--
--   trial_started_at   — when the user signed up. NULL for users that
--                        existed before this migration (so they don't
--                        get a retroactive trial gate).
--   trial_ends_at      — trial_started_at + 7 days. NULL for legacy
--                        users + admin-approved users (no expiry).
--
-- Gate logic (server-side, in /app/dashboard and middleware):
--
--     has_paid_subscription      → ✅ full access
--   else if trial_ends_at IS NULL → ✅ full access (legacy / admin-approved)
--   else if now() < trial_ends_at → ✅ trial access (banner shows countdown)
--   else                           → 🚫 redirect to /upgrade
--
-- Backfill choice (per AJ on 2026-05-06):
--   - Existing pending users: leave alone, AJ approves manually as before.
--   - Existing approved users: trial_ends_at stays NULL → no trial gate
--     ever applies → they keep full access.
-- ────────────────────────────────────────────────────────────────────

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_started_at timestamptz;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

-- Helpful index for the daily trial-reminder cron, which queries by
-- trial_ends_at to find users hitting day 5 / day 7.
CREATE INDEX IF NOT EXISTS idx_profiles_trial_ends_at
  ON profiles (trial_ends_at)
  WHERE trial_ends_at IS NOT NULL;

-- Track which trial reminder emails have already been sent so the daily
-- cron is idempotent (safe to run multiple times per day).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_welcome_sent_at  timestamptz;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_day5_sent_at     timestamptz;
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS trial_day7_sent_at     timestamptz;
