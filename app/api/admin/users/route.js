import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';
import { createSupabaseAdminClient } from '@/app/lib/supabase/admin';
import { sendApprovedEmail } from '@/app/lib/email';

// Force Node.js runtime so nodemailer (which uses `net`/`tls`) works.
export const runtime = 'nodejs';

async function requireAdmin() {
  const profile = await getCurrentProfile();
  if (!profile) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!profile.is_admin) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { profile };
}

// GET — list every user (admin only) with computed `is_subscribed`
// flag pulled from alert_distribution_list (matched by email).
//
// `is_subscribed` is true when the user has a row in
// alert_distribution_list AND it has not been unsubscribed.
export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  const supabase = createSupabaseServerClient();
  const { data: users, error: dbErr } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false });
  if (dbErr) return NextResponse.json({ error: 'Failed to load users' }, { status: 500 });

  // Pull the distribution list once and build an email→subscribed map.
  // We use the admin client because alert_distribution_list has its own
  // legacy auth that doesn't grant the regular server client read access.
  const admin = createSupabaseAdminClient();
  const { data: list } = await admin
    .from('alert_distribution_list')
    .select('email, unsubscribed_at');

  const subscribedEmails = new Set(
    (list || [])
      .filter((r) => !r.unsubscribed_at)
      .map((r) => (r.email || '').toLowerCase())
  );

  const enriched = (users || []).map((u) => ({
    ...u,
    is_subscribed: subscribedEmails.has((u.email || '').toLowerCase()),
  }));

  return NextResponse.json({ users: enriched });
}

// PATCH — change status, admin flag, or alert subscription
// body: {
//   id,
//   status?: 'approved'|'disabled'|'pending',
//   is_admin?: boolean,
//   is_subscribed?: boolean,    // toggle alert_distribution_list membership
// }
export async function PATCH(request) {
  const { error, profile } = await requireAdmin();
  if (error) return error;

  try {
    const body = await request.json();
    const { id, status, is_admin, is_subscribed } = body;
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
    const admin = createSupabaseAdminClient();

    // Grab the prior state so we know if this is a transition into "approved".
    const { data: prior } = await supabase
      .from('profiles')
      .select('status, email, display_name, approved_email_sent_at')
      .eq('id', id)
      .single();

    // Only run the profile UPDATE if there's something to change.
    let data = prior;
    if (status !== undefined || is_admin !== undefined) {
      const { data: updated, error: dbErr } = await supabase
        .from('profiles')
        .update(update)
        .eq('id', id)
        .select()
        .single();
      if (dbErr) throw dbErr;
      data = updated;
    }

    // ── Subscription toggle ───────────────────────────────────────
    // Map the boolean to either an insert (subscribe) or a soft delete
    // (set unsubscribed_at). Emails are lower-cased to match what we
    // store from the auth/callback auto-subscribe.
    if (is_subscribed !== undefined) {
      const targetEmail = (prior?.email || data?.email || '').toLowerCase();
      if (!targetEmail) {
        return NextResponse.json({ error: 'User has no email — cannot toggle subscription' }, { status: 400 });
      }
      try {
        if (is_subscribed) {
          // Look for an existing (possibly unsubscribed) row first.
          const { data: existing } = await admin
            .from('alert_distribution_list')
            .select('id, unsubscribed_at')
            .eq('email', targetEmail)
            .maybeSingle();

          if (existing) {
            // Re-subscribe: clear unsubscribed_at.
            if (existing.unsubscribed_at) {
              await admin
                .from('alert_distribution_list')
                .update({ unsubscribed_at: null })
                .eq('id', existing.id);
            }
          } else {
            await admin
              .from('alert_distribution_list')
              .insert({
                email: targetEmail,
                name: prior?.display_name || data?.display_name || null,
              });
          }
        } else {
          // Soft unsubscribe — keep the row for audit, set unsubscribed_at.
          await admin
            .from('alert_distribution_list')
            .update({ unsubscribed_at: new Date().toISOString() })
            .eq('email', targetEmail);
        }
      } catch (subErr) {
        console.error('[admin/users] subscription toggle failed:', subErr);
        return NextResponse.json({ error: 'Failed to update subscription' }, { status: 500 });
      }
    }

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
