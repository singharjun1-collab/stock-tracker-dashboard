import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/app/lib/supabase/admin';
import { verifyUnsubscribeToken } from '@/app/lib/unsubscribe-token';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// Why this endpoint
//   /unsubscribe page POSTs here with the same { u, sig } pair from the
//   email link. We HMAC-verify, then flip the row in alert_distribution_list.
//
//   No Supabase login is required — the HMAC IS the auth. Worst-case "leaked
//   link" outcome is unsubscribing one address from a daily stock digest,
//   which the owner can re-add by replying to AJ.

export async function POST(req) {
  try {
    const body = await req.json();
    const { u, sig } = body || {};

    const verified = verifyUnsubscribeToken(u, sig);
    if (!verified.ok) {
      return NextResponse.json({ ok: false, error: verified.error }, { status: 400 });
    }

    const email = verified.email.toLowerCase().trim();
    const admin = createSupabaseAdminClient();

    // Look up the row first so we can return a helpful message if the
    // address isn't on the list.
    const { data: row, error: lookupErr } = await admin
      .from('alert_distribution_list')
      .select('id, email, active, unsubscribed_at')
      .ilike('email', email)
      .maybeSingle();

    if (lookupErr) {
      console.error('[unsubscribe] lookup failed:', lookupErr);
      return NextResponse.json(
        { ok: false, error: 'lookup failed' },
        { status: 500 },
      );
    }

    if (!row) {
      // Nothing to do — already not on the list. Treat as success so the user
      // sees the confirmation page.
      return NextResponse.json({ ok: true, alreadyOff: true });
    }

    if (row.unsubscribed_at) {
      return NextResponse.json({ ok: true, alreadyOff: true });
    }

    const { error: updateErr } = await admin
      .from('alert_distribution_list')
      .update({
        active: false,
        unsubscribed_at: new Date().toISOString(),
        unsubscribe_reason: 'user_link_click',
      })
      .eq('id', row.id);

    if (updateErr) {
      console.error('[unsubscribe] update failed:', updateErr);
      return NextResponse.json(
        { ok: false, error: 'update failed' },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[unsubscribe] fatal:', e);
    return NextResponse.json({ ok: false, error: 'unexpected error' }, { status: 500 });
  }
}

// GET also supported so the link works as a one-click unsubscribe directly
// from clients that don't run JS (older email clients, RSS readers).
export async function GET(req) {
  const url = new URL(req.url);
  const u = url.searchParams.get('u');
  const sig = url.searchParams.get('sig');

  // Forward to POST for the same flow but return an HTML confirmation page
  // instead of JSON.
  const verified = verifyUnsubscribeToken(u, sig);
  if (!verified.ok) {
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><title>Unsubscribe</title>
       <body style="font-family:-apple-system,sans-serif;background:#0a0e1a;color:#e2e8f0;padding:48px;text-align:center;">
         <h1>Invalid link</h1><p>This unsubscribe link is invalid or has been tampered with.</p>
       </body>`,
      { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  // Reuse the POST handler's logic by invoking it
  const fakeReq = new Request(req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ u, sig }),
  });
  const res = await POST(fakeReq);
  const data = await res.json();

  if (data.ok) {
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><title>Unsubscribed</title>
       <body style="font-family:-apple-system,sans-serif;background:#0a0e1a;color:#e2e8f0;padding:48px;text-align:center;">
         <h1>You're unsubscribed</h1>
         <p><strong>${verified.email}</strong> will no longer receive Stock Chatter pre-market emails.</p>
         <p><a href="https://stocktracker.getfamilyfinance.com" style="color:#4fc3f7;">Open the dashboard →</a></p>
       </body>`,
      { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }

  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Unsubscribe error</title>
     <body style="font-family:-apple-system,sans-serif;background:#0a0e1a;color:#e2e8f0;padding:48px;text-align:center;">
       <h1>Couldn't unsubscribe</h1><p>${data.error || 'unknown error'}</p>
     </body>`,
    { status: 500, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
