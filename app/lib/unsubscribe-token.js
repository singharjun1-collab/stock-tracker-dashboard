// Tiny HMAC token helper for one-click unsubscribe links.
//
// We don't want a database round-trip just to verify a click. Instead we
// sign each recipient's email with a server-side secret (UNSUBSCRIBE_SECRET).
// The link looks like:
//   https://stocktracker.getfamilyfinance.com/unsubscribe?u=<base64url-email>&sig=<hex-hmac>
//
// On click, the /unsubscribe page (and /api/unsubscribe POST) re-derive the
// signature and reject mismatches. Tokens never expire — that's fine here
// because the worst-case "leaked link" outcome is unsubscribing someone
// from a stock-picks digest.
//
// IMPORTANT: set UNSUBSCRIBE_SECRET in Vercel → Project → Settings → Env Vars.
// If unset, we fall back to CRON_SECRET so the system still works without
// a second secret to manage.

import crypto from 'crypto';

function getSecret() {
  return (
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.CRON_SECRET ||
    // Last-ditch fallback so we don't crash in dev. NOT for production.
    'dev-only-unsubscribe-secret-replace-me'
  );
}

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(str) {
  // Pad back to multiple of 4
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') +
    '==='.slice((str.length + 3) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(email) {
  const secret = getSecret();
  return crypto
    .createHmac('sha256', secret)
    .update(email.toLowerCase().trim())
    .digest('hex');
}

export function makeUnsubscribeUrl(baseUrl, email) {
  const u = base64UrlEncode(email.toLowerCase().trim());
  const sig = sign(email);
  return `${baseUrl}/unsubscribe?u=${u}&sig=${sig}`;
}

export function verifyUnsubscribeToken(uParam, sigParam) {
  if (!uParam || !sigParam) return { ok: false, error: 'missing token' };
  let email;
  try {
    email = base64UrlDecode(uParam);
  } catch (e) {
    return { ok: false, error: 'malformed token' };
  }
  const expected = sign(email);
  // Constant-time compare
  const a = Buffer.from(sigParam, 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'invalid signature' };
  }
  return { ok: true, email };
}
