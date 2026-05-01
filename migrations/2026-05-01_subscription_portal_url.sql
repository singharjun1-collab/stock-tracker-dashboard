-- ────────────────────────────────────────────────────────────────────
-- Stock Chatter / subscription customer-portal URL
-- Date: 2026-05-01
--
-- Purpose: Store the Lemon Squeezy customer-portal URL so the dashboard
-- can deep-link a "Manage subscription" CTA to the LS-hosted portal
-- where the user can update their card or cancel auto-renew without
-- having to email us.
--
-- LS sends both URLs on every subscription_* webhook event under
-- data.attributes.urls.{customer_portal, update_payment_method}.
-- We persist them on the matching subscriptions row.
-- ────────────────────────────────────────────────────────────────────

alter table public.subscriptions
  add column if not exists customer_portal_url        text,
  add column if not exists update_payment_method_url  text;

-- No new policies needed — table stays service-role only via RLS.
