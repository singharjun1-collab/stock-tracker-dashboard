-- 2026-04-17 — Per-user saved preference for the global "Collapse all / Expand all"
-- toggle on the dashboard. Defaults to 'expanded' so existing users see no change.
--
-- Added as part of the nav redesign (5 primary tabs + ⋯ kebab menu).
-- Read on profile load in app/dashboard/page.js and written by a PATCH
-- to /api/profile whenever the user clicks the Collapse-all / Expand-all button.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS card_expand_default TEXT
    DEFAULT 'expanded'
    CHECK (card_expand_default IN ('expanded', 'compact'));
