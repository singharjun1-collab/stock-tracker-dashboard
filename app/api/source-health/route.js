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

  const allRows = data || [];
  // Retired sources — flagged via last_error_code starting with `RETIRED_`.
  // The row stays in source_health for audit/history, but it's hidden from
  // the admin banner so we don't pretend a deliberately-disabled source
  // is "broken." When the replacement ships, the new source's row will
  // start populating its own status independently.
  const isRetired = (r) =>
    typeof r.last_error_code === 'string' && r.last_error_code.startsWith('RETIRED_');
  const rows = allRows.filter((r) => !isRetired(r));
  const retired = allRows.filter(isRetired);

  const anyDown = rows.some((r) => r.status === 'down');
  const anyDegraded = rows.some((r) => r.status === 'degraded');

  return NextResponse.json({
    sources: rows,
    retired, // surfaced separately so admin pages can document them
    anyDegraded,
    anyDown,
    summary: anyDown
      ? `${rows.filter((r) => r.status === 'down').length} source(s) down`
      : anyDegraded
      ? `${rows.filter((r) => r.status === 'degraded').length} source(s) degraded`
      : 'All sources healthy',
  });
}
