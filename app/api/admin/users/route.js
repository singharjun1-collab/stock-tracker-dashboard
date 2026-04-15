import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';
import { sendApprovedEmail } from '@/app/lib/email';

// Force Node.js runtime so nodemailer (which uses `net`/`tls`) works.
export const runtime = 'nodejs';

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!profile.is_admin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { profile };
}

// GET — list every user (admin only)
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  const supabase = createSupabaseServerClient();
  const { data, error: dbErr } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (dbErr) return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });
  return NextResponse.json({ users: data });
}

// PATCH — change status or admin flag
// body: { id, status?: 'approved'|'disabled'|'pending', is_admin?: boolean }
export async function PATCH(request) {
  const { error, profile } = await requireAdmin();
  if (error) return error;

  try {
    const body = await request.json();
    const { id, status, is_admin } = body;
    if (!id) return NextResponse.json({ error: 'Missing user id' }, { status: 400 });

    const update = { updated_at: new Date().toISOString() };
    if (status !== undefined) {
      if (!['pending', 'approved', 'disabled'].includes(status)) {
        return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
      }
      update.status = status;
    }
    if (is_admin !== undefined) {
      // Prevent an admin from demoting themselves (avoids locking everyone out)
      if (id === profile.id && is_admin === false) {
        return NextResponse.json({ error: 'You cannot remove your own admin role' }, { status: 400 });
      }
      update.is_admin = !!is_admin;
    }

    const supabase = createSupabaseServerClient();

    // Grab the prior state so we know if this is a transition into "approved".
    const { data: prior } = await supabase
      .from('profiles')
      .select('status, email, display_name, approved_email_sent_at')
      .eq('id', id)
      .single();

    const { data, error: dbErr } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', id)
      .select()
      .single();
    if (dbErr) throw dbErr;

    // If we just approved someone who wasn't approved before (and we haven't
    // already emailed them), send the "you're in" email.
    const justApproved =
      status === 'approved' &&
      prior?.status !== 'approved' &&
      !prior?.approved_email_sent_at;

    if (justApproved) {
      try {
        await sendApprovedEmail({
          userEmail: prior?.email || data?.email,
          userName: prior?.display_name || data?.display_name,
        });
        await supabase
          .from('profiles')
          .update({ approved_email_sent_at: new Date().toISOString() })
          .eq('id', id);
      } catch (emailErr) {
        // Don't fail the API call if the email hiccups.
        console.error('[admin/users] approval email failed:', emailErr);
      }
    }

    return NextResponse.json({ user: data });
  } catch (e) {
    console.error('Admin update error:', e);
    return NextResponse.json({ error: 'Failed to update user' }, { status: 500 });
  }
}
