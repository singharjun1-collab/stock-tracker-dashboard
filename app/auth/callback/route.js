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

// Helper: seed a default ai_settings row for a brand-new user so the
// next per-user AI scan has a market_cap_range filter to work against.
// Without this row the scan loop in daily-stock-tracker would still
// process the user (it loops over all approved profiles), but every
// candidate would fail the cap filter. 50M–50B is the broadest
// reasonable default — they can narrow it later via the Settings UI.
async function seedDefaultAiSettings(admin, userId) {
  try {
    const { error } = await admin
      .from('ai_settings')
      .upsert(
        {
          user_id: userId,
          setting_key: 'market_cap_range',
          setting_value: { min: 0.05, max: 50 },
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,setting_key' }
      );
    if (error) {
      console.error('[auth/callback] ai_settings seed failed:', error);
    }
  } catch (e) {
    console.error('[auth/callback] ai_settings seed threw:', e);
  }
}

// Helper: copy the most recent live picks (across all users) into the
// new user's account so their dashboard isn't blank on first load.
//
// Why this exists: the daily-stock-tracker SKILL runs ~7x per weekday
// and writes per-user rows to stock_alerts. A user who signs up between
// runs (or over a weekend) sees an empty dashboard until the next scan
// happens to include them. That's a brutal first impression.
//
// What we do: pull the freshest distinct tickers from the last 72 hours
// (wide enough to catch Friday's picks for a Sunday signup), copy each
// one into stock_alerts under the new user_id with status='new'. The
// next scheduled scan will personalize from there based on their
// ai_settings.
//
// Robustness:
// - Inserts one row at a time so the trg_validate_pick_entry_price
//   trigger rejecting a single ticker (entry-band drift > 15%) doesn't
//   wipe the whole batch.
// - All errors are caught and logged — signup must never block.
async function seedNewUserAlerts(admin, userId) {
  try {
    const lookbackMs = 72 * 60 * 60 * 1000; // 72h covers a weekend signup
    const { data: source, error: fetchErr } = await admin
      .from('stock_alerts')
      .select(
        'ticker, company, alert_date, alert_reason, signal_type, price_at_alert, ' +
        'recommendation, recommendation_reason, forecast_sell_date, source, market_cap, ' +
        'entry_low, entry_high, target_low, target_high, stop_loss, ai_read, ' +
        'volume_ratio, week52_low, week52_high, wsb_trend, ' +
        'catalyst_date, catalyst_type, signal_history, created_at'
      )
      .in('status', ['new', 'active'])
      .is('dismissed_at', null)
      .gte('created_at', new Date(Date.now() - lookbackMs).toISOString())
      .order('created_at', { ascending: false })
      .limit(100);

    if (fetchErr) {
      console.error('[auth/callback] seed fetch failed:', fetchErr);
      return;
    }
    if (!source || source.length === 0) {
      console.log('[auth/callback] no recent picks available to seed new user');
      return;
    }

    // Dedupe by ticker — keep the most recent row per symbol so a single
    // ticker re-signaled multiple times in the window only counts once.
    const byTicker = new Map();
    for (const a of source) {
      if (!byTicker.has(a.ticker)) byTicker.set(a.ticker, a);
    }
    const picks = Array.from(byTicker.values()).slice(0, 15);

    const nowIso = new Date().toISOString();
    let inserted = 0;
    let skipped = 0;

    for (const p of picks) {
      const row = {
        ticker: p.ticker,
        company: p.company,
        alert_date: nowIso.slice(0, 10), // today's date for the new user
        alert_reason: p.alert_reason,
        signal_type: p.signal_type,
        price_at_alert: p.price_at_alert,
        recommendation: p.recommendation || 'BUY',
        recommendation_reason: p.recommendation_reason || '',
        forecast_sell_date: p.forecast_sell_date,
        source: p.source,
        market_cap: p.market_cap,
        entry_low: p.entry_low,
        entry_high: p.entry_high,
        target_low: p.target_low,
        target_high: p.target_high,
        stop_loss: p.stop_loss,
        ai_read: p.ai_read,
        volume_ratio: p.volume_ratio,
        week52_low: p.week52_low,
        week52_high: p.week52_high,
        wsb_trend: p.wsb_trend,
        catalyst_date: p.catalyst_date,
        catalyst_type: p.catalyst_type,
        signal_history: p.signal_history || [],
        user_id: userId,
        status: 'new',
        created_at: nowIso,
        last_resignal_at: nowIso,
      };

      const { error } = await admin.from('stock_alerts').insert(row);
      if (error) {
        // Most common failure: trg_validate_pick_entry_price rejected
        // because the live price has drifted >15% from the entry band
        // since the original alert. Skip this ticker and continue.
        skipped++;
        console.warn(
          `[auth/callback] skipped seeding ${row.ticker} for user ${userId}:`,
          error.message
        );
        continue;
      }
      inserted++;
    }

    console.log(
      `[auth/callback] seeded ${inserted} alerts (${skipped} skipped) for new user ${userId}`
    );
  } catch (e) {
    console.error('[auth/callback] seedNewUserAlerts threw:', e);
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

  // ── SEED FRESH SIGNUP'S DASHBOARD ────────────────────────────────
  // Brand-new users need cards on day one. Without this, the first
  // dashboard load is empty until the next scan run happens to include
  // them — which on a weekend signup means waiting until Monday.
  //
  // Both calls are best-effort (errors logged, never thrown):
  //   1. seedDefaultAiSettings — gives the next scan something to filter on.
  //   2. seedNewUserAlerts     — copies the most recent ~12 picks across
  //                              all users so cards populate immediately.
  if (isFreshSignup) {
    await seedDefaultAiSettings(admin, user.id);
    await seedNewUserAlerts(admin, user.id);
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
