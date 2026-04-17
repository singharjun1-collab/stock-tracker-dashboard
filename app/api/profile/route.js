import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

// GET the current user's profile (used by dashboard to render avatar + display name)
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ profile });
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
