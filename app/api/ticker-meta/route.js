import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Returns the ticker_meta lookup map for the dashboard.
// Used by the SectorPulseBar to:
//   - know which industry each card belongs to (for the sector chip badge)
//   - filter cards by sector when the user picks one
//
// Approved-user gate (same as /api/alerts). Trial-pending users don't see
// dashboard cards anyway, so this endpoint can mirror that.
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (profile.status !== 'approved') return NextResponse.json({ error: 'Pending approval' }, { status: 403 });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('ticker_meta')
    .select('ticker, sector, industry, display_name, classified_at');

  if (error) {
    console.error('[ticker-meta] db error:', error);
    return NextResponse.json({ error: 'Failed to load ticker meta' }, { status: 500 });
  }

  return NextResponse.json({ items: data || [] });
}
