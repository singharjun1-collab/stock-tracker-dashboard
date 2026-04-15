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
      ticker, company, alert_id, entry_price, entry_amount,
      ai_recommendation_at_entry, signal_strength_at_entry, signal_type_at_entry, notes,
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
    const { id, exit_price, notes } = body;
    if (!id) return NextResponse.json({ error: 'Missing trade id' }, { status: 400 });

    const supabase = createSupabaseServerClient();
    const update = { updated_at: new Date().toISOString() };

    if (exit_price !== undefined && exit_price !== null) {
      const price = parseFloat(exit_price);
      if (price <= 0) return NextResponse.json({ error: 'Exit price must be positive' }, { status: 400 });
      const { data: existing, error: fetchErr } = await supabase
        .from('paper_trades')
        .select('shares, status, user_id')
        .eq('id', id)
        .single();
      if (fetchErr) throw fetchErr;
      if (existing.user_id !== profile.id && !profile.is_admin) {
        return NextResponse.json({ error: 'Not your trade' }, { status: 403 });
      }
      if (existing.status === 'closed') {
        return NextResponse.json({ error: 'Trade already closed' }, { status: 400 });
      }
      update.exit_price = price;
      update.exit_date = new Date().toISOString();
      update.exit_amount = price * parseFloat(existing.shares);
      update.status = 'closed';
    }

    if (notes !== undefined) update.notes = notes;

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
