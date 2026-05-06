import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/app/lib/supabase/admin';
import {
  sendTrialDay5Email,
  sendTrialDay7Email,
} from '@/app/lib/email';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * /api/send-trial-reminders
 *
 * Daily cron that nudges trial users at day 5 and day 7.
 *
 * Schedule: once per day (Vercel cron). Idempotent — safe to run multiple
 * times per day; we stamp `trial_day5_sent_at` / `trial_day7_sent_at` so
 * each user only ever gets each email once.
 *
 * Targeting:
 *   - "Day 5" email: trial_ends_at is 1.5 - 2.5 days from now
 *     (so it lands the morning of day 5 of the 7-day trial)
 *   - "Day 7" email: trial_ends_at is in the next 24 hours
 *     (so it lands the morning of the trial's last day)
 *
 * Skipped if:
 *   - trial_ends_at is null (legacy or admin-approved user)
 *   - the appropriate _sent_at flag is already set
 *   - status is 'disabled' (admin blocked them)
 *   - user already has an active LS subscription (they converted, no nudge needed)
 *
 * Auth: Bearer CRON_SECRET — same model as /api/refresh-prices and
 * /api/send-premarket-digest.
 */

async function authorize(req) {
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true };
  }
  return { ok: false, status: 401, error: 'Unauthorized' };
}

const PAID_STATES = new Set(['active', 'on_trial', 'past_due']);
const DAY_MS = 24 * 60 * 60 * 1000;

async function handle() {
  const admin = createSupabaseAdminClient();

  const now = Date.now();
  // Day 5 window: trial ends in (1.5d, 2.5d]
  const day5Lower = new Date(now + 1.5 * DAY_MS).toISOString();
  const day5Upper = new Date(now + 2.5 * DAY_MS).toISOString();
  // Day 7 window: trial ends in (0, 1d] — the trial's last 24 hours
  const day7Lower = new Date(now).toISOString();
  const day7Upper = new Date(now + 1 * DAY_MS).toISOString();

  let sentDay5 = 0;
  let sentDay7 = 0;
  let skipped = 0;
  const errors = [];

  // ── Day 5 batch ─────────────────────────────────────────────────────
  {
    const { data: users, error } = await admin
      .from('profiles')
      .select('id, email, display_name, trial_ends_at, trial_day5_sent_at, status')
      .gt('trial_ends_at', day5Lower)
      .lte('trial_ends_at', day5Upper)
      .is('trial_day5_sent_at', null)
      .neq('status', 'disabled');

    if (error) {
      errors.push(`day5_query: ${error.message}`);
    } else if (users) {
      for (const u of users) {
        if (!u.email) { skipped++; continue; }
        // Skip if they already have a paid subscription
        const { data: sub } = await admin
          .from('subscriptions')
          .select('status')
          .eq('email', u.email.toLowerCase())
          .maybeSingle();
        if (sub && PAID_STATES.has((sub.status || '').toLowerCase())) {
          // Stamp it anyway so we never email them again
          await admin.from('profiles')
            .update({ trial_day5_sent_at: new Date().toISOString() })
            .eq('id', u.id);
          skipped++;
          continue;
        }
        try {
          await sendTrialDay5Email({
            userEmail: u.email,
            userName: u.display_name,
            trialEndsAt: u.trial_ends_at,
          });
          await admin.from('profiles')
            .update({ trial_day5_sent_at: new Date().toISOString() })
            .eq('id', u.id);
          sentDay5++;
        } catch (e) {
          errors.push(`day5/${u.email}: ${String(e)}`);
        }
      }
    }
  }

  // ── Day 7 batch ─────────────────────────────────────────────────────
  {
    const { data: users, error } = await admin
      .from('profiles')
      .select('id, email, display_name, trial_ends_at, trial_day7_sent_at, status')
      .gt('trial_ends_at', day7Lower)
      .lte('trial_ends_at', day7Upper)
      .is('trial_day7_sent_at', null)
      .neq('status', 'disabled');

    if (error) {
      errors.push(`day7_query: ${error.message}`);
    } else if (users) {
      for (const u of users) {
        if (!u.email) { skipped++; continue; }
        const { data: sub } = await admin
          .from('subscriptions')
          .select('status')
          .eq('email', u.email.toLowerCase())
          .maybeSingle();
        if (sub && PAID_STATES.has((sub.status || '').toLowerCase())) {
          await admin.from('profiles')
            .update({ trial_day7_sent_at: new Date().toISOString() })
            .eq('id', u.id);
          skipped++;
          continue;
        }
        try {
          await sendTrialDay7Email({
            userEmail: u.email,
            userName: u.display_name,
            trialEndsAt: u.trial_ends_at,
          });
          await admin.from('profiles')
            .update({ trial_day7_sent_at: new Date().toISOString() })
            .eq('id', u.id);
          sentDay7++;
        } catch (e) {
          errors.push(`day7/${u.email}: ${String(e)}`);
        }
      }
    }
  }

  return {
    ok: true,
    sentDay5,
    sentDay7,
    skipped,
    errors,
    ranAt: new Date().toISOString(),
  };
}

export async function GET(request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const result = await handle();
    return NextResponse.json(result);
  } catch (e) {
    console.error('[send-trial-reminders] failed:', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

export async function POST(request) {
  return GET(request);
}
