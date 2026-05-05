import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/app/lib/supabase/admin';
import { getCurrentProfile } from '@/app/lib/supabase/server';
import { fetchYahooQuotes } from '@/app/lib/yahoo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Yahoo fetch + DB write across ~75 tickers can take ~25s. Vercel's
// default function timeout is 10s on Hobby and 15s on Pro; bump.
export const maxDuration = 60;

// Why this endpoint exists
//   The dashboard's "current price" is read from `current_prices`, which is
//   populated by the daily Claude scheduled task. That task runs 7x per
//   weekday and has been unreliable (silent skips on Friday afternoon, etc.)
//   This endpoint is a self-contained price-refresh path that's *independent*
//   of the daily AI scan: a Vercel Cron hits it every 30 min during US
//   market hours, and the dashboard's manual Refresh button hits it too.
//
// Auth model
//   - Vercel Cron sends `Authorization: Bearer <CRON_SECRET>` — we accept it.
//   - Approved users (logged in, profiles.status='approved') can also POST
//     to manually refresh. Anyone else gets 401/403.
//
// What it does
//   1. Build the ticker set = (paper_trades.open distinct tickers)
//      ∪ (stock_alerts where status in ('new','active','dropped') distinct tickers)
//      Note: 'dropped' alerts are included so the card's headline price,
//      "since alert" %, and chart all stay in sync after a stock is dropped
//      (a dropped pick may still rebound, and we want the UI to reflect that).
//   2. Fetch each ticker's latest quote from Yahoo (with stagger + backoff)
//   3. Upsert price + previous_close into `current_prices` using the
//      service role (current_prices RLS only allows writes from service)
//   4. Return a summary so the dashboard can surface successes/failures
async function authorize(req) {
  // Vercel Cron path
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true, source: 'cron' };
  }

  // Authenticated-user path
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, status: 401, error: 'Unauthorized' };
  if (profile.status !== 'approved') {
    return { ok: false, status: 403, error: 'Pending approval' };
  }
  return { ok: true, source: 'user', userId: profile.id };
}

async function refresh() {
  const admin = createSupabaseAdminClient();

  // 1. Build ticker set
  const [tradesRes, alertsRes] = await Promise.all([
    admin
      .from('paper_trades')
      .select('ticker')
      .eq('status', 'open'),
    admin
      .from('stock_alerts')
      .select('ticker')
      .in('status', ['new', 'active', 'dropped']),
  ]);

  if (tradesRes.error) {
    return { ok: false, error: `paper_trades: ${tradesRes.error.message}` };
  }
  if (alertsRes.error) {
    return { ok: false, error: `stock_alerts: ${alertsRes.error.message}` };
  }

  const tickerSet = new Set();
  for (const r of tradesRes.data || []) {
    if (r.ticker) tickerSet.add(String(r.ticker).toUpperCase());
  }
  for (const r of alertsRes.data || []) {
    if (r.ticker) tickerSet.add(String(r.ticker).toUpperCase());
  }
  const tickers = [...tickerSet];

  if (tickers.length === 0) {
    return {
      ok: true,
      tickers: 0,
      refreshed: 0,
      failed: 0,
      errors: [],
      note: 'no tickers to refresh',
    };
  }

  // 2. Fetch quotes
  const { results, ok_count, fail_count, abort_reason } = await fetchYahooQuotes(tickers);

  // 3. Upsert successes
  const successRows = results
    .filter((r) => r.ok)
    .map((r) => ({
      ticker: r.ticker,
      price: r.price,
      previous_close: r.previous_close ?? null,
      price_date: r.price_date,
      // Extended-hours fields (added 2026-05-05). Yahoo only returns these
      // during pre/post-market windows; outside those windows they're null
      // and the card just hides the AH chip.
      post_market_price: r.post_market_price ?? null,
      post_market_change_pct: r.post_market_change_pct ?? null,
      post_market_time: r.post_market_time ?? null,
      pre_market_price: r.pre_market_price ?? null,
      pre_market_change_pct: r.pre_market_change_pct ?? null,
      pre_market_time: r.pre_market_time ?? null,
      updated_at: new Date().toISOString(),
    }));

  let writeError = null;
  if (successRows.length > 0) {
    const { error } = await admin
      .from('current_prices')
      .upsert(successRows, { onConflict: 'ticker' });
    if (error) writeError = error.message;
  }

  // 4. Compose summary
  const failures = results
    .filter((r) => !r.ok)
    .map((r) => ({ ticker: r.ticker, code: r.error_code, msg: r.error_message }));

  return {
    ok: !writeError,
    tickers: tickers.length,
    refreshed: writeError ? 0 : successRows.length,
    failed: fail_count,
    errors: failures,
    abort_reason: abort_reason,
    write_error: writeError,
    refreshed_at: new Date().toISOString(),
  };
}

export async function GET(req) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const summary = await refresh();
    const status = summary.ok ? 200 : 500;
    return NextResponse.json({ ...summary, source: auth.source }, { status });
  } catch (e) {
    console.error('refresh-prices fatal:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || 'refresh failed' },
      { status: 500 }
    );
  }
}

// POST is the path the dashboard's Refresh button uses (it's idempotent
// either way — semantically a refresh-trigger, not a read).
export async function POST(req) {
  return GET(req);
}
