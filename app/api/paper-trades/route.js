import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

function checkAuth(request) {
  const authCookie = request.cookies.get('stock_auth');
  return authCookie && authCookie.value === 'authenticated';
}

// GET all paper trades
export async function GET(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
      .from('paper_trades')
      .select('*')
      .order('entry_date', { ascending: false });
    if (error) throw error;
    return NextResponse.json({ trades: data });
  } catch (error) {
    console.error('Error fetching paper trades:', error);
    return NextResponse.json({ error: 'Failed to fetch trades' }, { status: 500 });
  }
}

// POST - create a new paper trade (buy)
export async function POST(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      ticker,
      company,
      alert_id,
      entry_price,
      entry_amount,
      ai_recommendation_at_entry,
      signal_strength_at_entry,
      signal_type_at_entry,
      notes,
    } = body;

    if (!ticker || !entry_price || !entry_amount) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
    }
    const price = parseFloat(entry_price);
    const amount = parseFloat(entry_amount);
    if (price <= 0 || amount <= 0) {
      return NextResponse.json({ error: 'Price and amount must be positive' }, { status: 400 });
    }
    const shares = amount / price;

    const { data, error } = await supabase
      .from('paper_trades')
      .insert({
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
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ trade: data });
  } catch (error) {
    console.error('Error creating paper trade:', error);
    return NextResponse.json({ error: 'Failed to create trade' }, { status: 500 });
  }
}

// PATCH - close (sell) or update a paper trade
export async function PATCH(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { id, exit_price, notes } = body;

    if (!id) {
      return NextResponse.json({ error: 'Missing trade id' }, { status: 400 });
    }

    const update = { updated_at: new Date().toISOString() };

    if (exit_price !== undefined && exit_price !== null) {
      const price = parseFloat(exit_price);
      if (price <= 0) {
        return NextResponse.json({ error: 'Exit price must be positive' }, { status: 400 });
      }
      // Fetch the trade to compute exit_amount
      const { data: existing, error: fetchErr } = await supabase
        .from('paper_trades')
        .select('shares, status')
        .eq('id', id)
        .single();
      if (fetchErr) throw fetchErr;
      if (existing.status === 'closed') {
        return NextResponse.json({ error: 'Trade already closed' }, { status: 400 });
      }
      update.exit_price = price;
      update.exit_date = new Date().toISOString();
      update.exit_amount = price * parseFloat(existing.shares);
      update.status = 'closed';
    }

    if (notes !== undefined) update.notes = notes;

    const { data, error } = await supabase
      .from('paper_trades')
      .update(update)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ trade: data });
  } catch (error) {
    console.error('Error updating paper trade:', error);
    return NextResponse.json({ error: 'Failed to update trade' }, { status: 500 });
  }
}

// DELETE - remove a trade entirely
export async function DELETE(request) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    }

    const { error } = await supabase
      .from('paper_trades')
      .delete()
      .eq('id', id);

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting paper trade:', error);
    return NextResponse.json({ error: 'Failed to delete trade' }, { status: 500 });
  }
}
