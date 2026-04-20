import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

// Runs on the server — never exposed to non-admin users.
export const runtime = 'nodejs';
// Don't cache — we want the banner to reflect the latest run.
export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!profile.is_admin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { profile };
}

// GET /api/source-health
// Returns: { sources: [{source, status, consecutive_failures, last_success_at,
//                       last_failure_at, last_error_code, last_error_message,
//                       updated_at}], anyDegraded: boolean, anyDown: boolean }
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const supabase = createSupabaseServerClient();
  const { data, error: dbErr } = await supabase
    .from('source_health')
    .select('*')
    .order('source');

  if (dbErr) {
    console.error('[source-health] db error:', dbErr);
    return NextResponse.json({ error: 'Failed to load source health' }, { status: 500 });
  }

  const rows = data || [];
  const anyDown = rows.some((r) => r.status === 'down');
  const anyDegraded = rows.some((r) => r.status === 'degraded');

  return NextResponse.json({
    sources: rows,
    anyDegraded,
    anyDown,
    summary: anyDown
      ? `${rows.filter((r) => r.status === 'down').length} source(s) down`
      : anyDegraded
      ? `${rows.filter((r) => r.status === 'degraded').length} source(s) degraded`
      : 'All sources healthy',
  });
}
