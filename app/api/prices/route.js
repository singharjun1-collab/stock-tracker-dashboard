import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

// Always evaluate at request time — this is live market data, never cache it.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Returns the latest known price for every ticker as a map:
//   { prices: { TSLA: { price: 388.90, previous_close: 377.22, price_date: "2026-04-16", updated_at: "..." }, ... },
//     as_of:  "2026-04-17T15:23:00Z" }
//
// `previous_close` is the prior session's close — used by the card UI to
// render "Today ±X.X%" (day-over-day change) separately from the
// "since alert" lifetime gain. May be null until the next daily job run.
//
// Portfolio and Leaderboard use this as the single source of truth for
// "current price" so P/L is consistent across all viewers, and so
// positions in dropped tickers keep getting fresh quotes (as long as the
// daily job fetches them — see scheduled-task SKILL for the updated ticker
// scope).
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (profile.status !== 'approved') {
    return NextResponse.json({ error: 'Pending approval' }, { status: 403 });
  }

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('current_prices')
    .select('ticker, price, previous_close, price_date, updated_at');

  if (error) {
    console.error('Error fetching current_prices:', error);
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 });
  }

  const prices = {};
  let freshest = null;
  for (const row of data || []) {
    prices[row.ticker] = {
      price: parseFloat(row.price),
      previous_close: row.previous_close != null ? parseFloat(row.previous_close) : null,
      price_date: row.price_date,
      updated_at: row.updated_at,
    };
    if (row.updated_at && (!freshest || new Date(row.updated_at) > new Date(freshest))) {
      freshest = row.updated_at;
    }
  }

  // Staleness signal so the dashboard can warn the user when the cron
  // is failing. "Stale" = the freshest row in current_prices is older
  // than the threshold below. We keep the threshold permissive (3h)
  // to avoid false alarms over lunch breaks; the dashboard itself
  // adds a tighter "during market hours" check.
  const STALE_THRESHOLD_MS = 3 * 60 * 60 * 1000;
  const staleMs = freshest ? Date.now() - new Date(freshest).getTime() : null;
  const stale = staleMs != null && staleMs > STALE_THRESHOLD_MS;

  return NextResponse.json({
    prices,
    as_of: new Date().toISOString(),
    freshest_at: freshest,
    stale,
    stale_ms: staleMs,
  });
}
