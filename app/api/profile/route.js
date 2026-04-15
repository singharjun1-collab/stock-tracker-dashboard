import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

// GET the current user's profile (used by dashboard to render avatar + display name)
export async function GET(request) {
  // ---- DIAGNOSTIC LOGGING (temporary) ----
  try {
    const cookieStore = cookies();
    const allCookies = cookieStore.getAll();
    const cookieNames = allCookies.map(c => c.name);
    const supabase = createSupabaseServerClient();
    const { data: getUserData, error: getUserError } = await supabase.auth.getUser();
    const { data: getSessionData, error: getSessionError } = await supabase.auth.getSession();
    console.log('[PROFILE-DEBUG]', JSON.stringify({
      cookieCount: allCookies.length,
      cookieNames,
      hasUser: !!getUserData?.user,
      userEmail: getUserData?.user?.email || null,
      getUserError: getUserError?.message || null,
      hasSession: !!getSessionData?.session,
      getSessionError: getSessionError?.message || null,
      env: {
        hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
        hasKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        urlPrefix: (process.env.NEXT_PUBLIC_SUPABASE_URL || '').slice(0, 30),
      },
    }));
  } catch (e) {
    console.log('[PROFILE-DEBUG-ERR]', e?.message);
  }
  // ---- /DIAGNOSTIC LOGGING ----

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
