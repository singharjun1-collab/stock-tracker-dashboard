import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// Handles the OAuth redirect after Google sign-in.
// Uses the canonical @supabase/ssr request/response cookie pattern so the
// session cookies are reliably attached to the redirect response.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/?error=no_code`);
  }

  // Start with a placeholder redirect — we'll attach cookies to THIS response
  // and replace its location at the end once we know where to send the user.
  let response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Mutate request cookies so subsequent supabase calls within this
          // handler see the fresh session, AND set them on the response so
          // the browser persists them.
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    const errResp = NextResponse.redirect(`${origin}/?error=${encodeURIComponent(error.message)}`);
    // Carry over any cookies supabase set (it sometimes clears stale ones on failure)
    response.cookies.getAll().forEach(c => errResp.cookies.set(c.name, c.value, c));
    return errResp;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const errResp = NextResponse.redirect(`${origin}/?error=no_user`);
    response.cookies.getAll().forEach(c => errResp.cookies.set(c.name, c.value, c));
    return errResp;
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('status, is_admin')
    .eq('id', user.id)
    .single();

  // Update the redirect location based on approval status, but keep all
  // cookies that were set on `response` above.
  const target = profile?.status === 'approved' ? next : '/pending';
  const finalResp = NextResponse.redirect(`${origin}${target}`);
  response.cookies.getAll().forEach(c => finalResp.cookies.set(c.name, c.value, c));

  // Legacy compatibility cookie for existing PIN-protected API routes
  if (profile?.status === 'approved') {
    finalResp.cookies.set('stock_auth', 'authenticated', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
  }

  return finalResp;
}
