import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/app/lib/supabase/admin';
import { getCurrentProfile } from '@/app/lib/supabase/server';
import { pulseAllIndustries } from '@/app/lib/sector_pulse';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Worst case: 15 industries × (3 Yahoo calls @ 250ms + 1 Anthropic call ~3s)
// = ~60s. Bump to the platform max.
export const maxDuration = 300;

// Why this endpoint exists
//   The dashboard's new Sector Pulse row reads from `sector_pulse_latest`.
//   This endpoint produces those rows: for each industry that has 2+ active
//   picks, it pulls trusted news + Reddit, asks Claude Haiku for a 2-line
//   read, and inserts a fresh row into sector_pulse.
//
// Cadence
//   Vercel Cron at 08:00 UTC daily (4am ET, 6pm Sydney). That's after the
//   classify-sectors job (04:00 UTC) and well before the 6:30 AM ET digest.
//   Manual triggers via POST are admin-only.
//
// Auth model (mirrors /api/classify-sectors)
//   - CRON_SECRET bearer token → ok
//   - Admin user → ok
//   - Anyone else → 403
async function authorize(req) {
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true, source: 'cron' };
  }
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!profile.is_admin) return { ok: false, status: 403, error: 'Admin only' };
  return { ok: true, source: 'admin', userId: profile.id };
}

export async function GET(req) {
  const auth = await authorize(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const admin = createSupabaseAdminClient();
    const summary = await pulseAllIndustries(admin);
    return NextResponse.json(
      {
        ok: !summary.write_error,
        ...summary,
        source: auth.source,
        completed_at: new Date().toISOString(),
      },
      { status: summary.write_error ? 500 : 200 }
    );
  } catch (e) {
    console.error('sector-pulse-refresh fatal:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || 'pulse refresh failed' },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  return GET(req);
}
