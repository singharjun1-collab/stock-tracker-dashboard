import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { sendNewSignupAlert } from '@/app/lib/email';
import { createSupabaseAdminClient } from '@/app/lib/supabase/admin';

// States that grant access via Lemon Squeezy. Mirror webhook APPROVED_STATES.
const PAID_STATES = new Set(['active', 'on_trial', 'past_due']);

// Force Node.js runtime so nodemailer (which uses `net`/`tls`) works.
export const runtime = 'nodejs';

// Handles the OAuth redirect after Google sign-in.
// Uses the canonical @supabase/ssr request/response cookie pattern so the
// session cookies are reliably attached to the redirect response.
export async function GET(request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') || '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=no_code`);
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
    const errResp = NextResponse.redirect(`${origin}/login?error=${encodeURIComponent(error.message)}`);
    // Carry over any cookies supabase set (it sometimes clears stale ones on failure)
    response.cookies.getAll().forEach(c => errResp.cookies.set(c.name, c.value, c));
    return errResp;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    const errResp = NextResponse.redirect(`${origin}/login?error=no_user`);
    response.cookies.getAll().forEach(c => errResp.cookies.set(c.name, c.value, c));
    return errResp;
  }

  let { data: profile } = await supabase
    .from('profiles')
    .select('status, is_admin, signup_notified_at, display_name, email')
    .eq('id', user.id)
    .single();

  // ── Lemon Squeezy auto-approval ──────────────────────────────────
  // If this user has an active subscription on file (paid before signing in,
  // or paid after but webhook arrived first), promote them to 'approved'
  // immediately so they don't sit on the /pending page.
  if (profile && profile.status === 'pending' && user.email) {
    try {
      const admin = createSupabaseAdminClient();
      const { data: sub } = await admin
        .from('subscriptions')
        .select('status')
        .eq('email', user.email.toLowerCase())
        .maybeSingle();
      if (sub && PAID_STATES.has((sub.status || '').toLowerCase())) {
        await admin.from('profiles').update({ status: 'approved' }).eq('id', user.id);
        profile = { ...profile, status: 'approved' };
      }
    } catch (e) {
      console.error('[auth/callback] subscription check failed:', e);
    }
  }

  // Fire off a one-time "new signup" email to the admin.
  // `signup_notified_at` is null until we've sent the alert, so we never
  // spam the admin if the user signs in multiple times while still pending.
  if (profile && profile.status === 'pending' && !profile.signup_notified_at) {
    try {
      await sendNewSignupAlert({
        userEmail: profile.email || user.email,
        userName: profile.display_name || user.user_metadata?.full_name,
      });
      await supabase
        .from('profiles')
        .update({ signup_notified_at: new Date().toISOString() })
        .eq('id', user.id);
    } catch (e) {
      // Don't block sign-in if the alert fails.
      console.error('[auth/callback] signup alert failed:', e);
    }
  }

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
