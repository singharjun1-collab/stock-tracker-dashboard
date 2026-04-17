import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

// Always evaluate at request time — this is live market data, never cache it.
export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Returns the latest known price for every ticker as a map:
//   { prices: { TSLA: { price: 388.90, price_date: "2026-04-16", updated_at: "..." }, ... },
//     as_of:  "2026-04-17T15:23:00Z" }
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
    .select('ticker, price, price_date, updated_at');

  if (error) {
    console.error('Error fetching current_prices:', error);
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 });
  }

  const prices = {};
  for (const row of data || []) {
    prices[row.ticker] = {
      price: parseFloat(row.price),
      price_date: row.price_date,
      updated_at: row.updated_at,
    };
  }

  return NextResponse.json({
    prices,
    as_of: new Date().toISOString(),
  });
}
