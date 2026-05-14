// Email helper using Gmail SMTP (via nodemailer + app password).
//
// Required env vars (set these in Vercel → Project → Settings → Environment Variables):
//   SMTP_HOST        — smtp.gmail.com
//   SMTP_PORT        — 587
//   SMTP_USER        — singh.arjun1@gmail.com
//   SMTP_PASSWORD    — your 16-char Gmail app password
//   FROM_EMAIL       — "Stock Chatter Alerts <singh.arjun1@gmail.com>"
//   ADMIN_EMAIL      — singh.arjun1@gmail.com (where signup alerts are sent)
//   NEXT_PUBLIC_APP_URL — https://stocktracker.getfamilyfinance.com
//
// Helpers fail silently (just console.error) so email hiccups never break
// the signup / approval flow.

import nodemailer from 'nodemailer';

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number(process.env.SMTP_PORT || 587);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!user || !pass) {
    console.warn('[email] SMTP_USER or SMTP_PASSWORD not set — emails will be skipped');
    return null;
  }
  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for 587 (STARTTLS)
    auth: { user, pass },
  });
  return _transporter;
}

async function sendEmail({ to, bcc, subject, html, text, replyTo }) {
  const transporter = getTransporter();
  if (!transporter) return { skipped: true };
  if (!to && !(bcc && bcc.length)) {
    console.warn('[email] no recipient provided — skipping');
    return { skipped: true };
  }
  const from = process.env.FROM_EMAIL || process.env.SMTP_USER;

  try {
    const info = await transporter.sendMail({
      from,
      to,
      bcc: Array.isArray(bcc) ? bcc.join(', ') : bcc,
      subject,
      html,
      text,
      replyTo: replyTo || from,
      // Standard List-Unsubscribe headers improve deliverability and let
      // Gmail / Apple Mail render a one-click "Unsubscribe" link.
      headers: html && html.includes('/unsubscribe?u=')
        ? { 'X-Mailer': 'Stock Chatter Alerts' }
        : undefined,
    });
    return { ok: true, id: info.messageId };
  } catch (e) {
    console.error('[email] send failed:', e);
    return { ok: false, error: String(e) };
  }
}

// Exported so other route handlers (the pre-market digest, etc.) can send.
export { sendEmail };

// --- Admin alert: new user signed up and is awaiting approval --------------
export async function sendNewSignupAlert({ userEmail, userName }) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.warn('[email] ADMIN_EMAIL not set — skipping signup alert');
    return { skipped: true };
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://stocktracker.getfamilyfinance.com';
  const approveUrl = `${appUrl}/dashboard`;
  const safeName = userName || '(no name)';

  const subject = `New Stock Chatter signup: ${userEmail}`;
  const text = `A new user has requested access to Stock Chatter.

Name:  ${safeName}
Email: ${userEmail}

Approve them here: ${approveUrl}
(Sign in as an admin, click the "Users" tab, then click Approve.)`;

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a2332;">
  <img src="${appUrl}/logo-email.png" alt="Stock Chatter" width="48" height="48" style="display:block;margin-bottom:16px;border:0;outline:none;" />
  <h2 style="margin-top:0; color:#0b2540;">New Stock Chatter signup</h2>
  <p>A new user has requested access and is waiting for your approval.</p>
  <table style="border-collapse: collapse; margin: 16px 0;">
    <tr><td style="padding:6px 12px; color:#7a9bc0;">Name</td><td style="padding:6px 12px; font-weight:600;">${escapeHtml(safeName)}</td></tr>
    <tr><td style="padding:6px 12px; color:#7a9bc0;">Email</td><td style="padding:6px 12px; font-weight:600;">${escapeHtml(userEmail)}</td></tr>
  </table>
  <p style="margin-top:24px;">
    <a href="${approveUrl}" style="display:inline-block; background:#2563eb; color:#fff; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600;">Review &amp; Approve</a>
  </p>
  <p style="color:#7a9bc0; font-size:13px; margin-top:24px;">
    Sign in as an admin, click the <strong>Users</strong> tab, then click <strong>Approve</strong> next to their row.
  </p>
  <p style="color:#9ca3af; font-size:11px; margin-top:24px; padding-top:16px; border-top:1px solid #e5e7eb;">
    <a href="${appUrl}/privacy" style="color:#6b7280; text-decoration:none;">Privacy</a> &middot;
    <a href="${appUrl}/terms" style="color:#6b7280; text-decoration:none;">Terms</a>
  </p>
</div>`;

  return sendEmail({ to: adminEmail, subject, html, text });
}

// --- User email: you've been approved --------------------------------------
export async function sendApprovedEmail({ userEmail, userName }) {
  if (!userEmail) return { skipped: true };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://stocktracker.getfamilyfinance.com';
  const dashboardUrl = `${appUrl}/dashboard`;
  const firstName = (userName || '').split(' ')[0] || 'there';

  const subject = "You're in — Stock Chatter access approved";
  const text = `Hi ${firstName},

Good news — your access to Stock Chatter has been approved!

You can sign in and start exploring daily picks here:
${dashboardUrl}

Welcome aboard.`;

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a2332;">
  <img src="${appUrl}/logo-email.png" alt="Stock Chatter" width="48" height="48" style="display:block;margin-bottom:16px;border:0;outline:none;" />
  <h2 style="margin-top:0; color:#0b2540;">You're in.</h2>
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>Good news — your access to <strong>Stock Chatter</strong> has just been approved.</p>
  <p style="margin-top:24px;">
    <a href="${dashboardUrl}" style="display:inline-block; background:#2563eb; color:#fff; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600;">Open Stock Chatter</a>
  </p>
  <p style="color:#7a9bc0; font-size:13px; margin-top:24px;">
    Just sign in with the same Google account and you'll land on your dashboard. Welcome aboard!
  </p>
  <p style="color:#9ca3af; font-size:11px; margin-top:24px; padding-top:16px; border-top:1px solid #e5e7eb; line-height:1.6;">
    Stock Chatter is an information service. Not financial advice &mdash; you can lose money.<br>
    <a href="${appUrl}/privacy" style="color:#6b7280; text-decoration:none;">Privacy</a> &middot;
    <a href="${appUrl}/terms" style="color:#6b7280; text-decoration:none;">Terms</a>
  </p>
</div>`;

  return sendEmail({ to: userEmail, subject, html, text });
}

// ──────────────────────────────────────────────────────────────────────
//  7-DAY NO-CC TRIAL — three email touch points
//
//  Day 0:  sendTrialWelcomeEmail   — "Welcome, your trial just started"
//  Day 5:  sendTrialDay5Email      — soft nudge, "2 days left"
//  Day 7:  sendTrialDay7Email      — last-day push to subscribe
//
//  Visual style mirrors sendApprovedEmail above (cyan/blue accent on a
//  light card) so all transactional emails look like one product.
// ──────────────────────────────────────────────────────────────────────

function trialEndsLine(trialEndsAt) {
  if (!trialEndsAt) return '';
  try {
    const d = new Date(trialEndsAt);
    return d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric',
    });
  } catch { return ''; }
}

// --- Day 0: trial welcome -------------------------------------------------
export async function sendTrialWelcomeEmail({ userEmail, userName, trialEndsAt }) {
  if (!userEmail) return { skipped: true };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://stocktracker.getfamilyfinance.com';
  const dashboardUrl = `${appUrl}/dashboard`;
  const checkoutUrl = process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL || `${appUrl}/upgrade`;
  const firstName = (userName || '').split(' ')[0] || 'there';
  const endsLine = trialEndsLine(trialEndsAt);

  const subject = "Your 7-day Stock Chatter trial just started";
  const text = `Hi ${firstName},

Welcome to Stock Chatter — your free 7-day trial is live${endsLine ? ` and ends ${endsLine}` : ''}.

For the next week you have full access to:
  • The daily AI watchlist (BUY / HOLD / TRIM / EXIT / SELL)
  • Pre-market email digest at 6:30 AM ET
  • Mobile dashboard with full signal history
  • All 14 leading-indicator signal sources (incl. insider buys & niche subs)

No credit card required — if Stock Chatter isn't for you, just walk away on day 8 and you'll never be charged.

Open your dashboard:
${dashboardUrl}

Loving it? Subscribe — AUD $16.58/month, billed annually:
${checkoutUrl}

— The Stock Chatter team`;

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a2332;">
  <img src="${appUrl}/logo-email.png" alt="Stock Chatter" width="48" height="48" style="display:block;margin-bottom:16px;border:0;outline:none;" />
  <h2 style="margin-top:0; color:#0b2540;">Welcome — your 7-day trial just started.</h2>
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>You're all set. For the next 7 days you have full access to <strong>Stock Chatter</strong> — no credit card required.</p>
  ${endsLine ? `<p style="background:#e8f4ff; padding:12px 16px; border-radius:8px; color:#0b2540; font-weight:600;">Your trial ends on <strong>${escapeHtml(endsLine)}</strong>.</p>` : ''}
  <p style="margin-top:20px;"><strong>What's included:</strong></p>
  <ul style="line-height:1.8; padding-left:20px;">
    <li>Daily AI watchlist with BUY / HOLD / TRIM / EXIT / SELL signals</li>
    <li>Pre-market email digest at 6:30 AM ET</li>
    <li>Mobile-first dashboard with full signal history</li>
    <li>All 14 leading-indicator signal sources (incl. insider buys & niche subs)</li>
  </ul>
  <p style="margin-top:24px;">
    <a href="${dashboardUrl}" style="display:inline-block; background:linear-gradient(135deg,#1565c0,#4fc3f7); color:#fff; padding:14px 28px; border-radius:8px; text-decoration:none; font-weight:700; font-size:15px;">Open my dashboard →</a>
  </p>
  <p style="color:#7a9bc0; font-size:13px; margin-top:24px;">
    If Stock Chatter isn't for you, just walk away on day 8 — you'll never be charged. Want to lock it in now? <a href="${checkoutUrl}" style="color:#1565c0;">Subscribe for AUD $16.58/month, billed annually</a>.
  </p>
  <p style="color:#9ca3af; font-size:11px; margin-top:24px; padding-top:16px; border-top:1px solid #e5e7eb; line-height:1.6;">
    Stock Chatter is an information service. Not financial advice &mdash; you can lose money.<br>
    <a href="${appUrl}/privacy" style="color:#6b7280; text-decoration:none;">Privacy</a> &middot;
    <a href="${appUrl}/terms" style="color:#6b7280; text-decoration:none;">Terms</a>
  </p>
</div>`;

  return sendEmail({ to: userEmail, subject, html, text });
}

// --- Day 5: 2-days-left nudge --------------------------------------------
export async function sendTrialDay5Email({ userEmail, userName, trialEndsAt }) {
  if (!userEmail) return { skipped: true };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://stocktracker.getfamilyfinance.com';
  const checkoutUrl = process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL || `${appUrl}/upgrade`;
  const dashboardUrl = `${appUrl}/dashboard`;
  const firstName = (userName || '').split(' ')[0] || 'there';
  const endsLine = trialEndsLine(trialEndsAt);

  const subject = "2 days left in your Stock Chatter trial";
  const text = `Hi ${firstName},

Quick check-in — your free 7-day Stock Chatter trial ends in 2 days${endsLine ? ` (${endsLine})` : ''}.

If the daily watchlist has been useful, lock it in — AUD $16.58/month, billed annually at AUD $199:
${checkoutUrl}

Or keep using it through the rest of the trial:
${dashboardUrl}

— The Stock Chatter team`;

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a2332;">
  <img src="${appUrl}/logo-email.png" alt="Stock Chatter" width="48" height="48" style="display:block;margin-bottom:16px;border:0;outline:none;" />
  <h2 style="margin-top:0; color:#0b2540;">2 days left in your trial</h2>
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>Quick check-in — your free 7-day Stock Chatter trial ends in <strong>2 days</strong>${endsLine ? ` <span style="color:#7a9bc0;">(${escapeHtml(endsLine)})</span>` : ''}.</p>
  <p>If the daily watchlist has been useful, now is the moment to lock in your year. After day 7 the dashboard locks until you subscribe.</p>
  <div style="background:#f6f9fc; border:1px solid #e1e9f2; border-radius:10px; padding:16px 20px; margin:20px 0;">
    <div style="font-size:24px; font-weight:800; color:#0b2540;">AUD $16.58 <span style="font-size:15px; font-weight:600; color:#7a9bc0;">/ month</span></div>
    <div style="color:#7a9bc0; font-size:13px;">Billed annually at AUD $199 &middot; cancel anytime</div>
  </div>
  <p style="margin-top:24px;">
    <a href="${checkoutUrl}" style="display:inline-block; background:linear-gradient(135deg,#1565c0,#4fc3f7); color:#fff; padding:14px 28px; border-radius:8px; text-decoration:none; font-weight:700; font-size:15px;">Subscribe — keep my access</a>
  </p>
  <p style="color:#7a9bc0; font-size:13px; margin-top:24px;">
    Not ready yet? <a href="${dashboardUrl}" style="color:#1565c0;">Keep using your trial →</a>
  </p>
  <p style="color:#9ca3af; font-size:11px; margin-top:24px; padding-top:16px; border-top:1px solid #e5e7eb; line-height:1.6;">
    Stock Chatter is an information service. Not financial advice &mdash; you can lose money.<br>
    <a href="${appUrl}/privacy" style="color:#6b7280; text-decoration:none;">Privacy</a> &middot;
    <a href="${appUrl}/terms" style="color:#6b7280; text-decoration:none;">Terms</a>
  </p>
</div>`;

  return sendEmail({ to: userEmail, subject, html, text });
}

// --- Day 7: last-day close ------------------------------------------------
export async function sendTrialDay7Email({ userEmail, userName, trialEndsAt }) {
  if (!userEmail) return { skipped: true };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://stocktracker.getfamilyfinance.com';
  const checkoutUrl = process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL || `${appUrl}/upgrade`;
  const firstName = (userName || '').split(' ')[0] || 'there';
  const endsLine = trialEndsLine(trialEndsAt);

  const subject = "Your trial ends today — keep your access?";
  const text = `Hi ${firstName},

Your free 7-day Stock Chatter trial ends today${endsLine ? ` (${endsLine})` : ''}.

After today the dashboard locks until you subscribe. To keep getting the daily watchlist + pre-market digest, lock in your year now:

AUD $16.58/month, billed annually at AUD $199
${checkoutUrl}

If Stock Chatter isn't for you — no worries, no charge. Thanks for trying it.

— The Stock Chatter team`;

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a2332;">
  <img src="${appUrl}/logo-email.png" alt="Stock Chatter" width="48" height="48" style="display:block;margin-bottom:16px;border:0;outline:none;" />
  <h2 style="margin-top:0; color:#0b2540;">Your trial ends today ⏰</h2>
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>Your free 7-day Stock Chatter trial ends <strong>today</strong>${endsLine ? ` <span style="color:#7a9bc0;">(${escapeHtml(endsLine)})</span>` : ''}.</p>
  <p>After today the dashboard locks until you subscribe. If the daily watchlist + pre-market digest have been useful, lock in your year now and keep your access uninterrupted.</p>
  <div style="background:#f6f9fc; border:1px solid #e1e9f2; border-radius:10px; padding:16px 20px; margin:20px 0;">
    <div style="font-size:24px; font-weight:800; color:#0b2540;">AUD $16.58 <span style="font-size:15px; font-weight:600; color:#7a9bc0;">/ month</span></div>
    <div style="color:#7a9bc0; font-size:13px;">Billed annually at AUD $199 &middot; cancel anytime</div>
  </div>
  <p style="margin-top:24px;">
    <a href="${checkoutUrl}" style="display:inline-block; background:linear-gradient(135deg,#1565c0,#4fc3f7); color:#fff; padding:14px 28px; border-radius:8px; text-decoration:none; font-weight:700; font-size:15px;">Subscribe — keep my access</a>
  </p>
  <p style="color:#7a9bc0; font-size:13px; margin-top:24px;">
    If Stock Chatter isn't for you, no worries — no charge. Thanks for trying it.
  </p>
  <p style="color:#9ca3af; font-size:11px; margin-top:24px; padding-top:16px; border-top:1px solid #e5e7eb; line-height:1.6;">
    Stock Chatter is an information service. Not financial advice &mdash; you can lose money.<br>
    <a href="${appUrl}/privacy" style="color:#6b7280; text-decoration:none;">Privacy</a> &middot;
    <a href="${appUrl}/terms" style="color:#6b7280; text-decoration:none;">Terms</a>
  </p>
</div>`;

  return sendEmail({ to: userEmail, subject, html, text });
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
