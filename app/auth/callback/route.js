import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { sendNewSignupAlert, sendTrialWelcomeEmail } from '@/app/lib/email';
import { createSupabaseAdminClient } from '@/app/lib/supabase/admin';

// Helper: best-effort add a freshly-signed-up user to the
// alert_distribution_list so they automatically get the daily
// pre-market digest. Existing rows (same email) are left untouched
// thanks to the unique constraint on email — we just swallow 23505.
async function autoSubscribeNewUser(admin, { email, name }) {
  if (!email) return;
  try {
    const { error } = await admin
      .from('alert_distribution_list')
      .insert({ email: email.toLowerCase(), name: name || null });
    if (error && error.code !== '23505') {
      console.error('[auth/callback] auto-subscribe failed:', error);
    }
  } catch (e) {
    console.error('[auth/callback] auto-subscribe threw:', e);
  }
}

// States that grant access via Lemon Squeezy. Mirror webhook APPROVED_STATES.
const PAID_STATES = new Set(['active', 'on_trial', 'past_due']);

// Length of the no-CC free trial. Change here if marketing wants to test 14d etc.
const TRIAL_LENGTH_DAYS = 7;

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
    .select('status, is_admin, signup_notified_at, trial_welcome_sent_at, trial_started_at, display_name, email')
    .eq('id', user.id)
    .single();

  const admin = createSupabaseAdminClient();

  // ── Lemon Squeezy auto-approval ──────────────────────────────────
  // If this user has an active subscription on file (paid before signing in,
  // or paid after but webhook arrived first), promote them to 'approved'
  // immediately so they don't sit on the /pending page.
  if (profile && profile.status === 'pending' && user.email) {
    try {
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

  // ── 7-DAY NO-CC TRIAL: AUTO-APPROVE FRESH SIGNUPS ────────────────
  // If this is a brand-new user (status='pending' AND we've never sent
  // an admin alert for them) → start their 7-day free trial immediately
  // and flip them to 'approved' so they go straight into the dashboard.
  //
  // We use signup_notified_at IS NULL as the "never been seen before"
  // marker so existing pending users that AJ has been sitting on do
  // NOT get auto-approved — they keep the original manual-approval flow.
  //
  // After this update, the dashboard's server-side trial gate enforces
  // the day-8 paywall by checking trial_ends_at vs now().
  let isFreshSignup = false;
  if (profile
        && profile.status === 'pending'
        && !profile.signup_notified_at
        && !profile.trial_started_at) {
    try {
      const trialStart = new Date();
      const trialEnd = new Date(trialStart.getTime() + TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000);
      await admin
        .from('profiles')
        .update({
          status: 'approved',
          trial_started_at: trialStart.toISOString(),
          trial_ends_at: trialEnd.toISOString(),
        })
        .eq('id', user.id);
      profile = {
        ...profile,
        status: 'approved',
        trial_started_at: trialStart.toISOString(),
        trial_ends_at: trialEnd.toISOString(),
      };
      isFreshSignup = true;
    } catch (e) {
      console.error('[auth/callback] trial auto-approve failed:', e);
    }
  }

  // Send the trial welcome email exactly once for fresh auto-approved signups.
  // Skipped if the LS webhook already approved them (PAID path above) — those
  // get the normal "Welcome to Stock Chatter" experience without trial copy.
  if (isFreshSignup && !profile.trial_welcome_sent_at && profile.email) {
    try {
      await sendTrialWelcomeEmail({
        userEmail: profile.email || user.email,
        userName: profile.display_name || user.user_metadata?.full_name,
        trialEndsAt: profile.trial_ends_at,
      });
      await admin
        .from('profiles')
        .update({ trial_welcome_sent_at: new Date().toISOString() })
        .eq('id', user.id);
    } catch (e) {
      console.error('[auth/callback] trial welcome email failed:', e);
    }
  }

  // ── ADMIN ALERT + AUTO-SUBSCRIBE ON FRESH SIGNUP ────────────────
  // We always want the admin to know when a new person signs up — even
  // if they were auto-approved into the 7-day trial above. Previously
  // this alert was only sent on the legacy "still pending" path, which
  // meant fresh trial signups were silent to the admin.
  //
  // We also auto-add the new user's email to alert_distribution_list
  // so they receive the daily 6:30 AM ET pre-market digest from day 1.
  // Both happen inside the same `signup_notified_at IS NULL` guard so
  // each new user only fires this once.
  if (profile && !profile.signup_notified_at) {
    try {
      await sendNewSignupAlert({
        userEmail: profile.email || user.email,
        userName: profile.display_name || user.user_metadata?.full_name,
      });
    } catch (e) {
      // Don't block sign-in if the alert fails.
      console.error('[auth/callback] signup alert failed:', e);
    }

    // Auto-subscribe to the daily digest. Idempotent (23505 is ignored).
    await autoSubscribeNewUser(admin, {
      email: profile.email || user.email,
      name: profile.display_name || user.user_metadata?.full_name,
    });

    // Mark notified regardless of whether the email succeeded — we've
    // tried, and we don't want to spam the admin every login.
    try {
      await admin
        .from('profiles')
        .update({ signup_notified_at: new Date().toISOString() })
        .eq('id', user.id);
    } catch (e) {
      console.error('[auth/callback] mark notified failed:', e);
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
