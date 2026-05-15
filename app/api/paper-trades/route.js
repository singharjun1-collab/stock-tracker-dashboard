import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

async function requireApproved() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (profile.status !== 'approved') {
    return { error: NextResponse.json({ error: 'Pending approval' }, { status: 403 }) };
  }
  return { profile };
}

// GET current user's paper trades
export async function GET() {
  const { error, profile } = await requireApproved();
  if (error) return error;
  const supabase = createSupabaseServerClient();
  const { data, error: dbErr } = await supabase
    .from('paper_trades')
    .select('*')
    .eq('user_id', profile.id)
    .order('entry_date', { ascending: false });
  if (dbErr) return NextResponse.json({ error: 'Failed to fetch trades' }, { status: 500 });
  return NextResponse.json({ trades: data });
}

// POST — create a new paper trade (buy)
export async function POST(request) {
  const { error, profile } = await requireApproved();
  if (error) return error;

  try {
    const body = await request.json();
    const {
      ticker, company, alert_id, entry_price, entry_amount, shares: sharesIn,
      ai_recommendation_at_entry, signal_strength_at_entry, signal_type_at_entry, notes,
      // AI reasoning snapshot (frozen at entry for audit)
      recommendation_reason_at_entry,
      alert_reason_at_entry,
      forecast_sell_date_at_entry,
      market_cap_at_entry,
      source_at_entry,
    } = body;

    if (!ticker || !entry_price) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const price = parseFloat(entry_price);
    if (!(price > 0)) {
      return NextResponse.json({ error: 'Price must be positive' }, { status: 400 });
    }

    // The buy ticket now collects a share count + price per share directly,
    // so the dollar cost (entry_amount) is derived rather than typed. Legacy
    // callers that only send entry_amount still work — we back the share
    // count out of it so nothing breaks.
    let shares, amount;
    if (sharesIn != null && sharesIn !== '') {
      shares = parseFloat(sharesIn);
      if (!(shares > 0)) {
        return NextResponse.json({ error: 'Shares must be positive' }, { status: 400 });
      }
      amount = shares * price;
    } else {
      amount = parseFloat(entry_amount);
      if (!(amount > 0)) {
        return NextResponse.json({ error: 'Amount must be positive' }, { status: 400 });
      }
      shares = amount / price;
    }

    const supabase = createSupabaseServerClient();
    const { data, error: dbErr } = await supabase
      .from('paper_trades')
      .insert({
        user_id: profile.id,
        ticker: ticker.toUpperCase(),
        company: company || null,
        alert_id: alert_id || null,
        entry_price: price,
        entry_amount: amount,
        shares,
        ai_recommendation_at_entry: ai_recommendation_at_entry || null,
        signal_strength_at_entry: signal_strength_at_entry || null,
        signal_type_at_entry: signal_type_at_entry || null,
        notes: notes || null,
        recommendation_reason_at_entry: recommendation_reason_at_entry || null,
        alert_reason_at_entry: alert_reason_at_entry || null,
        forecast_sell_date_at_entry: forecast_sell_date_at_entry || null,
        market_cap_at_entry: market_cap_at_entry ?? null,
        source_at_entry: source_at_entry || null,
      })
      .select()
      .single();

    if (dbErr) throw dbErr;
    return NextResponse.json({ trade: data });
  } catch (e) {
    console.error('Error creating paper trade:', e);
    return NextResponse.json({ error: 'Failed to create trade' }, { status: 500 });
  }
}

// PATCH — close (sell) or update a paper trade
export async function PATCH(request) {
  const { error, profile } = await requireApproved();
  if (error) return error;

  try {
    const body = await request.json();
    const { id, exit_price, sell_shares, notes, ai_review_verdict, ai_review_notes } = body;
    if (!id) return NextResponse.json({ error: 'Missing trade id' }, { status: 400 });

    const supabase = createSupabaseServerClient();

    // Validate the review verdict once — used by both the sell path and the
    // review-only path below.
    if (ai_review_verdict !== undefined && ai_review_verdict !== null
        && !['right', 'wrong', 'partial', 'unclear'].includes(ai_review_verdict)) {
      return NextResponse.json({ error: 'Invalid review verdict' }, { status: 400 });
    }

    // ───────────────────────────────────────────────────────────────
    // SELL PATH — full close OR partial sell.
    //
    // Partial sells use a "split the lot" model: the original open row is
    // shrunk down to the shares still held, and a brand-new CLOSED row is
    // created for the portion that was sold. Because every row keeps its
    // own internally-consistent entry_amount / exit_amount, the Portfolio
    // P/L math and the Leaderboard keep working with zero special-casing.
    // ───────────────────────────────────────────────────────────────
    if (exit_price !== undefined && exit_price !== null) {
      const price = parseFloat(exit_price);
      if (!(price > 0)) {
        return NextResponse.json({ error: 'Exit price must be positive' }, { status: 400 });
      }

      const { data: existing, error: fetchErr } = await supabase
        .from('paper_trades')
        .select('*')
        .eq('id', id)
        .single();
      if (fetchErr) throw fetchErr;
      if (existing.user_id !== profile.id && !profile.is_admin) {
        return NextResponse.json({ error: 'Not your trade' }, { status: 403 });
      }
      if (existing.status === 'closed') {
        return NextResponse.json({ error: 'Trade already closed' }, { status: 400 });
      }

      const heldShares = parseFloat(existing.shares);
      const entryPrice = parseFloat(existing.entry_price);
      let sellShares = (sell_shares != null && sell_shares !== '')
        ? parseFloat(sell_shares)
        : heldShares;
      if (!(sellShares > 0)) {
        return NextResponse.json({ error: 'Shares to sell must be positive' }, { status: 400 });
      }
      // Clamp; anything within a hair of the whole position is a full close.
      if (sellShares > heldShares) sellShares = heldShares;
      const isPartial = sellShares < heldShares - 1e-9;
      const nowIso = new Date().toISOString();

      if (!isPartial) {
        // FULL CLOSE — unchanged behaviour.
        const update = {
          updated_at: nowIso,
          exit_price: price,
          exit_date: nowIso,
          exit_amount: price * heldShares,
          status: 'closed',
        };
        if (notes !== undefined) update.notes = notes;
        if (ai_review_verdict !== undefined) update.ai_review_verdict = ai_review_verdict || null;
        if (ai_review_notes !== undefined) update.ai_review_notes = ai_review_notes || null;
        if (ai_review_verdict !== undefined || ai_review_notes !== undefined) {
          update.ai_review_at = nowIso;
        }
        const { data, error: dbErr } = await supabase
          .from('paper_trades')
          .update(update)
          .eq('id', id)
          .select()
          .single();
        if (dbErr) throw dbErr;
        return NextResponse.json({ trade: data, partial: false });
      }

      // PARTIAL SELL — split the lot.
      const remainingShares = heldShares - sellShares;

      // 1. Shrink the original open row down to what's still held.
      const { data: updatedOpen, error: updErr } = await supabase
        .from('paper_trades')
        .update({
          shares: remainingShares,
          entry_amount: remainingShares * entryPrice,
          updated_at: nowIso,
          ...(notes !== undefined ? { notes } : {}),
        })
        .eq('id', id)
        .select()
        .single();
      if (updErr) throw updErr;

      // 2. Create a closed row for the sold portion, copying the frozen AI
      //    snapshot so the audit trail survives on the closed lot too.
      const soldRow = {
        user_id: existing.user_id,
        ticker: existing.ticker,
        company: existing.company,
        alert_id: existing.alert_id,
        entry_date: existing.entry_date,
        entry_price: entryPrice,
        entry_amount: sellShares * entryPrice,
        shares: sellShares,
        exit_date: nowIso,
        exit_price: price,
        exit_amount: sellShares * price,
        status: 'closed',
        ai_recommendation_at_entry: existing.ai_recommendation_at_entry,
        signal_strength_at_entry: existing.signal_strength_at_entry,
        signal_type_at_entry: existing.signal_type_at_entry,
        notes: existing.notes,
        recommendation_reason_at_entry: existing.recommendation_reason_at_entry,
        alert_reason_at_entry: existing.alert_reason_at_entry,
        forecast_sell_date_at_entry: existing.forecast_sell_date_at_entry,
        market_cap_at_entry: existing.market_cap_at_entry,
        source_at_entry: existing.source_at_entry,
        ai_review_verdict: ai_review_verdict !== undefined ? (ai_review_verdict || null) : null,
        ai_review_notes: ai_review_notes !== undefined ? (ai_review_notes || null) : null,
        ai_review_at: (ai_review_verdict !== undefined || ai_review_notes !== undefined) ? nowIso : null,
      };
      const { data: closedRow, error: insErr } = await supabase
        .from('paper_trades')
        .insert(soldRow)
        .select()
        .single();
      if (insErr) throw insErr;

      return NextResponse.json({ trade: updatedOpen, closed: closedRow, partial: true });
    }

    // ───────────────────────────────────────────────────────────────
    // REVIEW-ONLY / NOTES-ONLY PATH (no exit_price supplied)
    // ───────────────────────────────────────────────────────────────
    const update = { updated_at: new Date().toISOString() };
    if (notes !== undefined) update.notes = notes;
    if (ai_review_verdict !== undefined || ai_review_notes !== undefined) {
      if (ai_review_verdict !== undefined) update.ai_review_verdict = ai_review_verdict || null;
      if (ai_review_notes !== undefined) update.ai_review_notes = ai_review_notes || null;
      update.ai_review_at = new Date().toISOString();
    }

    // Guard: require at least one actual field change beyond updated_at
    if (Object.keys(update).length === 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const { data, error: dbErr } = await supabase
      .from('paper_trades')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (dbErr) throw dbErr;
    return NextResponse.json({ trade: data });
  } catch (e) {
    console.error('Error updating paper trade:', e);
    return NextResponse.json({ error: 'Failed to update trade' }, { status: 500 });
  }
}

// DELETE — remove a trade
export async function DELETE(request) {
  const { error, profile } = await requireApproved();
  if (error) return error;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const supabase = createSupabaseServerClient();
    const { error: dbErr } = await supabase
      .from('paper_trades')
      .delete()
      .eq('id', id)
      .eq('user_id', profile.id);

    if (dbErr) throw dbErr;
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Error deleting paper trade:', e);
    return NextResponse.json({ error: 'Failed to delete trade' }, { status: 500 });
  }
}
