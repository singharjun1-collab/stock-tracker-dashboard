import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

// Dismiss / un-dismiss a pick. Sets stock_alerts.dismissed_at = NOW() (or null).
// RLS on stock_alerts already scopes the UPDATE to the current user, but we
// also explicitly filter by user_id for clarity/safety.

async function requireUser() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: 'Unauthorized', status: 401 };
  if (profile.status !== 'approved') return { error: 'Pending approval', status: 403 };
  return { profile };
}

// POST — dismiss (archive) an alert. Body: { alert_id }
export async function POST(request) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = await request.json().catch(() => ({}));
  const alertId = parseInt(body.alert_id, 10);
  if (!alertId) return NextResponse.json({ error: 'alert_id required' }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const { data, error } = await supabase
    .from('stock_alerts')
    .update({ dismissed_at: new Date().toISOString() })
    .eq('id', alertId)
    .eq('user_id', auth.profile.id)
    .select('id, dismissed_at')
    .single();

  if (error) {
    console.error('dismiss POST error:', error);
    return NextResponse.json({ error: 'Failed to dismiss' }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: 'Alert not found' }, { status: 404 });

  return NextResponse.json({ success: true, alert: data });
}

// DELETE — un-dismiss. Query: ?alert_id=123
export async function DELETE(request) {
  const auth = await requireUser();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(request.url);
  const alertId = parseInt(searchParams.get('alert_id'), 10);
  if (!alertId) return NextResponse.json({ error: 'alert_id required' }, { status: 400 });

  const supabase = createSupabaseServerClient();
  const { error } = await supabase
    .from('stock_alerts')
    .update({ dismissed_at: null })
    .eq('id', alertId)
    .eq('user_id', auth.profile.id);

  if (error) {
    console.error('dismiss DELETE error:', error);
    return NextResponse.json({ error: 'Failed to un-dismiss' }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}
