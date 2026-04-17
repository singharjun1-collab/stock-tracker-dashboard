import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

// User-scoped private notes on a ticker.
// One note per (user_id, ticker). Ticker-scoped so the note follows
// the ticker across alert cycles.

async function requireUser() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: 'Unauthorized', status: 401 };
  if (profile.status !== 'approved') return { error: 'Pending approval', status: 403 };
  return { profile };
}

// GET — return all this user's notes as a { ticker: note } map
export async function GET() {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('user_notes')
    .select('ticker, note, updated_at')
    .eq('user_id', auth.profile.id);

  if (error) {
    console.error('notes GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch notes' }, { status: 500 });
  }

  const byTicker = {};
  (data || []).forEach(r => { byTicker[r.ticker] = { note: r.note, updated_at: r.updated_at }; });
  return NextResponse.json({ notes: byTicker });
}

// POST — upsert a note. Body: { ticker, note }
// Empty string/null note deletes the row.
export async function POST(request) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const ticker = (body.ticker || '').toString().trim().toUpperCase();
  const note = (body.note || '').toString().trim();

  if (!ticker) return NextResponse.json({ error: 'ticker required' }, { status: 400 });
  if (note.length > 500) return NextResponse.json({ error: 'note too long (max 500 chars)' }, { status: 400 });

  const supabase = createSupabaseServerClient();

  if (note.length === 0) {
    // Empty note → delete
    const { error } = await supabase
      .from('user_notes')
      .delete()
      .eq('user_id', auth.profile.id)
      .eq('ticker', ticker);
    if (error) {
      console.error('notes DELETE error:', error);
      return NextResponse.json({ error: 'Failed to clear note' }, { status: 500 });
    }
    return NextResponse.json({ success: true, deleted: true });
  }

  const { data, error } = await supabase
    .from('user_notes')
    .upsert(
      { user_id: auth.profile.id, ticker, note },
      { onConflict: 'user_id,ticker' }
    )
    .select()
    .single();

  if (error) {
    console.error('notes POST error:', error);
    return NextResponse.json({ error: 'Failed to save note' }, { status: 500 });
  }

  return NextResponse.json({ note: data });
}
