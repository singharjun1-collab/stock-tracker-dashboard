import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createSupabaseAdminClient } from '@/app/lib/supabase/admin';

// Force Node.js runtime — we need the `crypto` module for HMAC verification.
export const runtime = 'nodejs';
// We need the raw body to verify the signature, so don't auto-parse JSON.
export const dynamic = 'force-dynamic';

/**
 * Lemon Squeezy webhook handler.
 *
 * Configure in your Lemon Squeezy store → Settings → Webhooks:
 *   Endpoint:  https://stocktracker.getfamilyfinance.com/api/webhooks/lemonsqueezy
 *   Signing secret: copy and paste into Vercel env var LEMONSQUEEZY_WEBHOOK_SECRET
 *   Events: subscription_created, subscription_updated,
 *           subscription_payment_success, subscription_cancelled,
 *           subscription_expired, subscription_paused, subscription_resumed,
 *           subscription_unpaused, order_created
 *
 * On each event we:
 *   1. Verify the HMAC signature against LEMONSQUEEZY_WEBHOOK_SECRET.
 *   2. Upsert into public.subscriptions keyed by customer email.
 *   3. If the subscription is active and a profile exists for that email,
 *      flip profiles.status = 'approved' so the user gets straight in.
 *   4. If the user signed up before paying, the /auth/callback handler
 *      reads public.subscriptions on next sign-in and approves them then.
 */

const ACTIVE_STATES = new Set(['active', 'on_trial']);
const APPROVED_STATES = new Set(['active', 'on_trial', 'past_due']); // grace period

export async function POST(request) {
  const secret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[lemonsqueezy webhook] LEMONSQUEEZY_WEBHOOK_SECRET not set');
    return NextResponse.json({ ok: false, error: 'webhook not configured' }, { status: 500 });
  }

  // Get the raw body bytes — required for signature verification.
  const rawBody = await request.text();
  const signature = request.headers.get('x-signature') || '';

  // Verify HMAC-SHA256.
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    console.warn('[lemonsqueezy webhook] invalid signature');
    return NextResponse.json({ ok: false, error: 'invalid signature' }, { status: 401 });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid json' }, { status: 400 });
  }

  const eventName = payload?.meta?.event_name || request.headers.get('x-event-name') || '';
  const eventId = payload?.meta?.webhook_id || `${eventName}_${payload?.data?.id}_${Date.now()}`;
  const data = payload?.data || {};
  const attrs = data.attributes || {};

  // We support both subscription_* and order_* events.
  const email = (attrs.user_email || attrs.customer_email || '').toLowerCase().trim();
  if (!email) {
    console.warn('[lemonsqueezy webhook] no email in event', eventName);
    return NextResponse.json({ ok: true, ignored: 'no email' });
  }

  const supabase = createSupabaseAdminClient();

  // Idempotency: skip if we've already processed this event id.
  const { data: existingEvent } = await supabase
    .from('subscriptions')
    .select('email, last_event_id')
    .eq('email', email)
    .maybeSingle();
  if (existingEvent?.last_event_id && existingEvent.last_event_id === eventId) {
    return NextResponse.json({ ok: true, idempotent: true });
  }

  // Build subscription row.
  const status = (attrs.status || (eventName.startsWith('order_') ? 'active' : 'pending')).toLowerCase();

  // LS sends per-subscription deep-links on every subscription_* event so
  // we can offer "Manage subscription" / "Update card" links without
  // building any custom UI ourselves. Pull them off the payload here.
  // (order_* events don't carry these; preserve any prior values.)
  const portalUrl = attrs.urls?.customer_portal || null;
  const updateCardUrl = attrs.urls?.update_payment_method || null;

  const subRow = {
    email,
    customer_id: String(attrs.customer_id ?? ''),
    subscription_id: String(data.id ?? ''),
    order_id: String(attrs.order_id ?? ''),
    product_id: String(attrs.product_id ?? ''),
    variant_id: String(attrs.variant_id ?? ''),
    status,
    renews_at: attrs.renews_at || null,
    ends_at: attrs.ends_at || null,
    trial_ends_at: attrs.trial_ends_at || null,
    last_event_id: eventId,
    last_event_name: eventName,
    raw_payload: payload,
  };
  // Only set these if LS supplied them — don't blank out an existing
  // good URL when handling an order_created event.
  if (portalUrl) subRow.customer_portal_url = portalUrl;
  if (updateCardUrl) subRow.update_payment_method_url = updateCardUrl;

  const { error: upsertErr } = await supabase
    .from('subscriptions')
    .upsert(subRow, { onConflict: 'email' });
  if (upsertErr) {
    console.error('[lemonsqueezy webhook] subscriptions upsert failed', upsertErr);
    return NextResponse.json({ ok: false, error: 'db_upsert_failed' }, { status: 500 });
  }

  // If subscription is active (or has a grace state), promote any matching
  // profile to 'approved' so the user gets straight into the dashboard.
  if (APPROVED_STATES.has(status)) {
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, status')
      .eq('email', email)
      .maybeSingle();

    if (!profileErr && profile && profile.status !== 'approved') {
      await supabase
        .from('profiles')
        .update({ status: 'approved' })
        .eq('id', profile.id);
    }
  }

  // If subscription has fully ended, demote.
  if (status === 'cancelled' || status === 'expired') {
    // Only flip back to 'pending' if the subscription has actually expired
    // past the grace period. cancelled-but-still-renewed-until-X stays active.
    const endsAt = attrs.ends_at ? new Date(attrs.ends_at) : null;
    if (status === 'expired' || (endsAt && endsAt < new Date())) {
      await supabase
        .from('profiles')
        .update({ status: 'disabled' })
        .eq('email', email)
        .eq('status', 'approved');
    }
  }

  return NextResponse.json({ ok: true, event: eventName, status });
}

// Lemon Squeezy occasionally pings GET to confirm the endpoint exists.
export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'lemonsqueezy webhook' });
}
