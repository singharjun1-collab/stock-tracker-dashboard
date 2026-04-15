import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

// Returns every approved user's public portfolio summary, plus (optionally)
// their full trade list when ?userId= is passed.
export async function GET(request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (profile.status !== 'approved') {
    return NextResponse.json({ error: 'Pending approval' }, { status: 403 });
  }

  const supabase = createSupabaseServerClient();
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');

  // List all approved profiles
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, display_name, avatar_url, email, is_admin, created_at')
    .eq('status', 'approved');
  if (pErr) return NextResponse.json({ error: 'Failed to load profiles' }, { status: 500 });

  // All trades across approved users (RLS already allows this for approved users)
  let tradesQuery = supabase.from('paper_trades').select('*');
  if (userId) tradesQuery = tradesQuery.eq('user_id', userId);
  const { data: trades, error: tErr } = await tradesQuery;
  if (tErr) return NextResponse.json({ error: 'Failed to load trades' }, { status: 500 });

  // Group trades by user and compute summary stats
  const summaryByUser = {};
  for (const p of profiles) summaryByUser[p.id] = {
    profile: p,
    openCount: 0, closedCount: 0,
    totalInvested: 0, realizedPL: 0, winRate: null, wins: 0, losses: 0,
  };

  for (const t of trades) {
    const s = summaryByUser[t.user_id];
    if (!s) continue;
    s.totalInvested += parseFloat(t.entry_amount) || 0;
    if (t.status === 'closed') {
      s.closedCount += 1;
      const pl = (parseFloat(t.exit_amount) || 0) - (parseFloat(t.entry_amount) || 0);
      s.realizedPL += pl;
      if (pl > 0) s.wins += 1; else if (pl < 0) s.losses += 1;
    } else {
      s.openCount += 1;
    }
  }

  const leaderboard = Object.values(summaryByUser).map(s => {
    const decided = s.wins + s.losses;
    return {
      ...s,
      winRate: decided > 0 ? s.wins / decided : null,
    };
  });

  return NextResponse.json({
    leaderboard,
    trades: userId ? trades : null,
  });
}
