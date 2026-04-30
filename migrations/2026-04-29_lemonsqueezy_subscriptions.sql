-- ────────────────────────────────────────────────────────────────────
-- Stock Chatter / Lemon Squeezy subscriptions table
-- Date: 2026-04-29
--
-- Purpose: Track who has paid via Lemon Squeezy. Keyed by email so the
-- webhook can record a subscription BEFORE the user ever signs in.
-- /auth/callback then matches the new Google user's email against this
-- table and auto-flips profiles.status to 'approved' if active.
--
-- This table is service-role only — RLS denies all access by default,
-- the webhook + callback both use the service-role client.
-- ────────────────────────────────────────────────────────────────────

create table if not exists public.subscriptions (
  email                text primary key,
  customer_id          text,
  subscription_id      text,
  order_id             text,
  product_id           text,
  variant_id           text,
  status               text not null default 'pending',          -- 'active' | 'past_due' | 'cancelled' | 'expired' | 'paused' | 'pending'
  renews_at            timestamptz,
  ends_at              timestamptz,
  trial_ends_at        timestamptz,
  last_event_id        text,                                      -- Lemon Squeezy event id, for idempotency
  last_event_name      text,
  raw_payload          jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_subscriptions_status      on public.subscriptions (status);
create index if not exists idx_subscriptions_renews_at   on public.subscriptions (renews_at);

-- RLS: deny all by default (service-role bypasses).
alter table public.subscriptions enable row level security;
-- No policies = no row visibility through anon/authenticated roles.

-- Helper: bump updated_at on every row change.
create or replace function public.subscriptions_set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_subscriptions_updated_at on public.subscriptions;
create trigger trg_subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.subscriptions_set_updated_at();
