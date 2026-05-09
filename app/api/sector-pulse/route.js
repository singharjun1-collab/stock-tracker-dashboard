import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

export const dynamic = 'force-dynamic';

// Returns the latest pulse row per sector via the sector_pulse_latest view.
// Approved-user gate to match /api/alerts.
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (profile.status !== 'approved') return NextResponse.json({ error: 'Pending approval' }, { status: 403 });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('sector_pulse_latest')
    .select('*')
    .order('sector_label');

  if (error) {
    console.error('[sector-pulse] db error:', error);
    return NextResponse.json({ error: 'Failed to load sector pulse' }, { status: 500 });
  }

  return NextResponse.json({ sectors: data || [] });
}
