import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

/**
 * /api/watchlist
 *
 * GET     — list current user's watchlist, enriched with latest AI alert and current price per ticker
 * POST    — add a ticker to the user's watchlist (idempotent; snapshots AI data if provided)
 * DELETE  — remove a ticker from the user's watchlist
 *
 * Auth: requires an approved profile (same gate as paper_trades).
 * Multi-user: every row is scoped by user_id and protected by RLS.
 */

async function requireApproved() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (profile.status !== 'approved') {
    return { error: NextResponse.json({ error: 'Pending approval' }, { status: 403 }) };
  }
  return { profile };
}

// GET — list current user's watchlist with enriched AI / price data per ticker
export async function GET() {
  const { error, profile } = await requireApproved();
  if (error) return error;

  const supabase = createSupabaseServerClient();

  // Fetch raw watchlist rows for this user
  const { data: rows, error: dbErr } = await supabase
    .from('watchlist')
    .select('*')
    .eq('user_id', profile.id)
    .order('added_at', { ascending: false });

  if (dbErr) {
    console.error('Watchlist GET error:', dbErr);
    return NextResponse.json({ error: 'Failed to fetch watchlist' }, { status: 500 });
  }

  if (!rows || rows.length === 0) {
    return NextResponse.json({ watchlist: [] });
  }

  const tickers = Array.from(new Set(rows.map((r) => r.ticker)));

  // Enrich: get latest non-dismissed stock_alerts row per ticker (if AI is currently covering it)
  // and current_prices row (for price display).
  const [{ data: alerts }, { data: prices }] = await Promise.all([
    supabase
      .from('stock_alerts')
      .select(
        'id, ticker, company, recommendation, recommendation_reason, entry_low, entry_high, target_low, target_high, stop_loss, ai_read, signal_type, price_at_alert, alert_date, status, market_cap, week52_low, week52_high, signal_history, dismissed_at'
      )
      .in('ticker', tickers)
      .is('dismissed_at', null)
      .order('alert_date', { ascending: false }),
    supabase
      .from('current_prices')
      .select('ticker, price, previous_close, pre_market_price, pre_market_change_pct, post_market_price, post_market_change_pct, updated_at')
      .in('ticker', tickers),
  ]);

  // Pick the most-recent alert per ticker (the .order above guarantees descending)
  const latestAlertByTicker = {};
  (alerts || []).forEach((a) => {
    if (!latestAlertByTicker[a.ticker]) latestAlertByTicker[a.ticker] = a;
  });
  const priceByTicker = {};
  (prices || []).forEach((p) => { priceByTicker[p.ticker] = p; });

  const watchlist = rows.map((row) => {
    const alert = latestAlertByTicker[row.ticker] || null;
    const price = priceByTicker[row.ticker] || null;

    // Compute today's % change if we have current and previous close
    let today_pct = null;
    if (price && price.price != null && price.previous_close != null && price.previous_close > 0) {
      today_pct = ((parseFloat(price.price) - parseFloat(price.previous_close)) / parseFloat(price.previous_close)) * 100;
    }

    return {
      ...row,
      ai_coverage: alert ? 'active' : 'monitor', // 'active' = AI is currently flagging this; 'monitor' = no current AI signal
      current_alert: alert,
      current_price: price ? parseFloat(price.price) : null,
      previous_close: price ? (price.previous_close != null ? parseFloat(price.previous_close) : null) : null,
      today_pct,
      pre_market_price: price?.pre_market_price ? parseFloat(price.pre_market_price) : null,
      pre_market_change_pct: price?.pre_market_change_pct ? parseFloat(price.pre_market_change_pct) : null,
      post_market_price: price?.post_market_price ? parseFloat(price.post_market_price) : null,
      post_market_change_pct: price?.post_market_change_pct ? parseFloat(price.post_market_change_pct) : null,
    };
  });

  return NextResponse.json({ watchlist });
}

// POST — add a ticker to the user's watchlist (idempotent upsert)
export async function POST(request) {
  const { error, profile } = await requireApproved();
  if (error) return error;

  try {
    const body = await request.json();
    const ticker = (body.ticker || '').trim().toUpperCase();
    if (!ticker || !/^[A-Z0-9.\-]{1,12}$/.test(ticker)) {
      return NextResponse.json({ error: 'Invalid ticker' }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();

    // Check if already in watchlist (idempotent — return success without re-adding)
    const { data: existing } = await supabase
      .from('watchlist')
      .select('id, ticker')
      .eq('user_id', profile.id)
      .eq('ticker', ticker)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ watchlist: existing, already_watching: true });
    }

    // Build snapshot from request body (set when added via "+ Track" on an AI card)
    const insertRow = {
      user_id: profile.id,
      ticker,
      company: body.company || null,
      source: body.source || 'manual',
      alert_id: body.alert_id || null,
      ai_rec_at_add: body.ai_rec_at_add || null,
      entry_low_at_add: body.entry_low_at_add ?? null,
      entry_high_at_add: body.entry_high_at_add ?? null,
      target_low_at_add: body.target_low_at_add ?? null,
      target_high_at_add: body.target_high_at_add ?? null,
      stop_loss_at_add: body.stop_loss_at_add ?? null,
      notes: body.notes || null,
    };

    const { data, error: dbErr } = await supabase
      .from('watchlist')
      .insert(insertRow)
      .select()
      .single();

    if (dbErr) {
      console.error('Watchlist POST error:', dbErr);
      return NextResponse.json({ error: 'Failed to add to watchlist' }, { status: 500 });
    }

    return NextResponse.json({ watchlist: data, already_watching: false });
  } catch (e) {
    console.error('Watchlist POST exception:', e);
    return NextResponse.json({ error: 'Failed to add to watchlist' }, { status: 500 });
  }
}

// DELETE — remove a ticker from the user's watchlist (by ticker OR by id)
export async function DELETE(request) {
  const { error, profile } = await requireApproved();
  if (error) return error;

  try {
    const { searchParams } = new URL(request.url);
    const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();
    const id = searchParams.get('id');

    if (!ticker && !id) {
      return NextResponse.json({ error: 'Missing ticker or id' }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const q = supabase.from('watchlist').delete().eq('user_id', profile.id);
    const { error: dbErr } = id ? await q.eq('id', id) : await q.eq('ticker', ticker);

    if (dbErr) {
      console.error('Watchlist DELETE error:', dbErr);
      return NextResponse.json({ error: 'Failed to remove from watchlist' }, { status: 500 });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Watchlist DELETE exception:', e);
    return NextResponse.json({ error: 'Failed to remove from watchlist' }, { status: 500 });
  }
}
