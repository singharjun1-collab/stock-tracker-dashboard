import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

// GET the current user's profile (used by dashboard to render avatar + display name)
export async function GET(request) {
  const url = new URL(request.url);
  const debug = url.searchParams.get('debug') === '1';

  if (debug) {
    // Detailed diagnostic — returns server view of cookies + auth state
    const allCookies = cookies().getAll();
    const supabase = createSupabaseServerClient();
    const { data: userData, error: userErr } = await supabase.auth.getUser();
    const { data: sessData, error: sessErr } = await supabase.auth.getSession();
    return NextResponse.json({
      cookieCount: allCookies.length,
      cookieNames: allCookies.map(c => c.name),
      sbCookieValueSample: allCookies
        .filter(c => c.name.startsWith('sb-'))
        .map(c => ({ name: c.name, len: c.value.length, prefix: c.value.slice(0, 20) })),
      hasUser: !!userData?.user,
      userEmail: userData?.user?.email || null,
      userErr: userErr?.message || null,
      hasSession: !!sessData?.session,
      sessErr: sessErr?.message || null,
      env: {
        hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        urlPrefix: (process.env.NEXT_PUBLIC_SUPABASE_URL || '').slice(0, 40),
        keyLen: (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '').length,
      },
    });
  }

  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return NextResponse.json({ profile });
}

// PATCH the current user's display_name (only)
export async function PATCH(request) {
  const profile = await getCurrentProfile();
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const body = await request.json();
    const { display_name } = body;
    if (!display_name || typeof display_name !== 'string') {
      return NextResponse.json({ error: 'Invalid display name' }, { status: 400 });
    }
    const trimmed = display_name.trim().slice(0, 40);
    if (trimmed.length < 2) {
      return NextResponse.json({ error: 'Display name too short' }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('profiles')
      .update({ display_name: trimmed, updated_at: new Date().toISOString() })
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
