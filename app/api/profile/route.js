import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';
import { createSupabaseAdminClient } from '@/app/lib/supabase/admin';

// GET the current user's profile (used by dashboard + /pending to render
// avatar, display name, and Lemon Squeezy subscription state).
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Look up Lemon Squeezy subscription for this user's email so /pending
  // can show a "Complete subscription" CTA when there's no payment on file.
  let subscription = null;
  if (profile.email) {
    try {
      const admin = createSupabaseAdminClient();
      const { data: sub } = await admin
        .from('subscriptions')
        .select('status, renews_at, ends_at, customer_portal_url, update_payment_method_url')
        .eq('email', profile.email.toLowerCase())
        .maybeSingle();
      subscription = sub || null;
    } catch (e) {
      // Don't break the profile response if subscriptions lookup fails.
      console.error('[api/profile] subscription lookup failed:', e);
    }
  }

  return NextResponse.json({ profile, subscription });
}

// PATCH the current user's profile. Accepts:
//   - display_name   (2-40 chars, trimmed)
//   - card_expand_default   ('expanded' | 'compact') — saved UI preference
//     for the global collapse/expand-all toggle on the dashboard
//
// At least one valid field must be supplied. Unknown fields are ignored.
export async function PATCH(request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const patch = { updated_at: new Date().toISOString() };

    if (body.display_name !== undefined) {
      if (typeof body.display_name !== 'string') {
        return NextResponse.json({ error: 'Invalid display name' }, { status: 400 });
      }
      const trimmed = body.display_name.trim().slice(0, 40);
      if (trimmed.length < 2) {
        return NextResponse.json({ error: 'Display name too short' }, { status: 400 });
      }
      patch.display_name = trimmed;
    }

    if (body.card_expand_default !== undefined) {
      if (body.card_expand_default !== 'expanded' && body.card_expand_default !== 'compact') {
        return NextResponse.json({ error: 'Invalid card_expand_default' }, { status: 400 });
      }
      patch.card_expand_default = body.card_expand_default;
    }

    // Require at least one real field (not just updated_at).
    if (Object.keys(patch).length === 1) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', profile.id)
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ profile: data });
  } catch (e) {
    console.error('Profile update error:', e);
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
  }
}
