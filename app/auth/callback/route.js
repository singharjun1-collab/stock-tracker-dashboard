import { NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/app/lib/supabase/server';

// Handles the OAuth redirect after Google sign-in.
// Exchanges the `code` for a session, then redirects based on approval status.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=no_code`);
  }

  const supabase = createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/?error=${encodeURIComponent(error.message)}`);
  }

  // Figure out where to send the user — pending approval screen or dashboard
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${origin}/?error=no_user`);
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('status, is_admin')
    .eq('id', user.id)
    .single();

  const response = profile?.status === 'approved'
    ? NextResponse.redirect(`${origin}${next}`)
    : NextResponse.redirect(`${origin}/pending`);

  // Legacy compatibility: set the stock_auth cookie so existing PIN-protected
  // API routes (alerts, settings, history, etc.) continue to work for approved users.
  if (profile?.status === 'approved') {
    response.cookies.set('stock_auth', 'authenticated', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });
  }

  return response;
}
