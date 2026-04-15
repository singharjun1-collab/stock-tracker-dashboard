-- =====================================================================
-- Per-user Stock Tracker migration
-- Run this ONCE in the Supabase SQL Editor.
-- Safe to re-run: uses IF EXISTS / IF NOT EXISTS guards.
--
-- What this does:
--   1. ai_settings — each user gets their own row(s) + RLS
--   2. stock_alerts — picks are now scoped per-user
--   3. stock_prices — inherits scoping via alert_id
-- =====================================================================

-- =====================================================================
-- PART 1: ai_settings (per-user AI filters)
-- =====================================================================

alter table public.ai_settings
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'ai_settings_setting_key_key'
  ) then
    alter table public.ai_settings drop constraint ai_settings_setting_key_key;
  end if;
end $$;

create unique index if not exists ai_settings_user_key_unique
  on public.ai_settings (user_id, setting_key);

alter table public.ai_settings enable row level security;

drop policy if exists "ai_settings_select_own" on public.ai_settings;
create policy "ai_settings_select_own" on public.ai_settings for select using (auth.uid() = user_id);

drop policy if exists "ai_settings_insert_own" on public.ai_settings;
create policy "ai_settings_insert_own" on public.ai_settings for insert with check (auth.uid() = user_id);

drop policy if exists "ai_settings_update_own" on public.ai_settings;
create policy "ai_settings_update_own" on public.ai_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "ai_settings_delete_own" on public.ai_settings;
create policy "ai_settings_delete_own" on public.ai_settings for delete using (auth.uid() = user_id);

-- The scheduled scanner uses the service role (which bypasses RLS) but
-- we still want a permissive policy for reads so nothing breaks if we
-- ever swap keys. Allow reading all users' settings from the scanner:
drop policy if exists "ai_settings_service_read" on public.ai_settings;
create policy "ai_settings_service_read" on public.ai_settings for select
  using (auth.role() = 'service_role');


-- =====================================================================
-- PART 2: stock_alerts — per-user picks
-- =====================================================================

alter table public.stock_alerts
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

-- Helpful index for dashboard queries
create index if not exists stock_alerts_user_id_idx on public.stock_alerts (user_id);

-- BACKFILL: Attach all existing alerts to the admin (AJ) so the current
-- dashboard keeps showing picks after the migration. Replace the email
-- with your admin email if different.
update public.stock_alerts sa
  set user_id = p.id
from public.profiles p
where sa.user_id is null
  and p.email = 'singh.arjun1@gmail.com';

alter table public.stock_alerts enable row level security;

-- Users can only see their own picks
drop policy if exists "stock_alerts_select_own" on public.stock_alerts;
create policy "stock_alerts_select_own" on public.stock_alerts for select
  using (auth.uid() = user_id);

-- The scheduled scanner runs with the service role; it can write for any user.
drop policy if exists "stock_alerts_service_write" on public.stock_alerts;
create policy "stock_alerts_service_write" on public.stock_alerts for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');


-- =====================================================================
-- PART 3: stock_prices — tied to alerts, so scoped by alert_id
-- =====================================================================

alter table public.stock_prices enable row level security;

-- Users can see prices for alerts they own
drop policy if exists "stock_prices_select_own" on public.stock_prices;
create policy "stock_prices_select_own" on public.stock_prices for select
  using (
    exists (
      select 1 from public.stock_alerts sa
      where sa.id = stock_prices.alert_id
        and sa.user_id = auth.uid()
    )
  );

drop policy if exists "stock_prices_service_write" on public.stock_prices;
create policy "stock_prices_service_write" on public.stock_prices for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');


-- =====================================================================
-- PART 4: signal_changes — also per-alert
-- =====================================================================

alter table public.signal_changes enable row level security;

drop policy if exists "signal_changes_select_own" on public.signal_changes;
create policy "signal_changes_select_own" on public.signal_changes for select
  using (
    exists (
      select 1 from public.stock_alerts sa
      where sa.id = signal_changes.alert_id
        and sa.user_id = auth.uid()
    )
  );

drop policy if exists "signal_changes_service_write" on public.signal_changes;
create policy "signal_changes_service_write" on public.signal_changes for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');


-- =====================================================================
-- Done. Run the scanner task afterwards and it will start producing
-- per-user picks using each approved user's ai_settings.
-- =====================================================================
