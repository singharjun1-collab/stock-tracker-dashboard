// Email helper using Gmail SMTP (via nodemailer + app password).
//
// Required env vars (set these in Vercel → Project → Settings → Environment Variables):
//   SMTP_HOST        — smtp.gmail.com
//   SMTP_PORT        — 587
//   SMTP_USER        — singh.arjun1@gmail.com
//   SMTP_PASSWORD    — your 16-char Gmail app password
//   FROM_EMAIL       — "Stock Tracker Alerts <singh.arjun1@gmail.com>"
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

async function sendEmail({ to, subject, html, text }) {
  const transporter = getTransporter();
  if (!transporter) return { skipped: true };
  if (!to) {
    console.warn('[email] no recipient provided — skipping');
    return { skipped: true };
  }
  const from = process.env.FROM_EMAIL || process.env.SMTP_USER;

  try {
    const info = await transporter.sendMail({ from, to, subject, html, text });
    return { ok: true, id: info.messageId };
  } catch (e) {
    console.error('[email] send failed:', e);
    return { ok: false, error: String(e) };
  }
}

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

  const subject = `New Stock Tracker signup: ${userEmail}`;
  const text = `A new user has requested access to Stock Tracker.

Name:  ${safeName}
Email: ${userEmail}

Approve them here: ${approveUrl}
(Sign in as an admin, click the "Users" tab, then click Approve.)`;

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a2332;">
  <h2 style="margin-top:0; color:#0b2540;">New Stock Tracker signup</h2>
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
</div>`;

  return sendEmail({ to: adminEmail, subject, html, text });
}

// --- User email: you've been approved --------------------------------------
export async function sendApprovedEmail({ userEmail, userName }) {
  if (!userEmail) return { skipped: true };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://stocktracker.getfamilyfinance.com';
  const dashboardUrl = `${appUrl}/dashboard`;
  const firstName = (userName || '').split(' ')[0] || 'there';

  const subject = "You're in — Stock Tracker access approved";
  const text = `Hi ${firstName},

Good news — your access to Stock Tracker has been approved!

You can sign in and start exploring daily picks here:
${dashboardUrl}

Welcome aboard.`;

  const html = `
<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1a2332;">
  <h2 style="margin-top:0; color:#0b2540;">You're in! 🎉</h2>
  <p>Hi ${escapeHtml(firstName)},</p>
  <p>Good news — your access to <strong>Stock Tracker</strong> has just been approved.</p>
  <p style="margin-top:24px;">
    <a href="${dashboardUrl}" style="display:inline-block; background:#2563eb; color:#fff; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600;">Open Stock Tracker</a>
  </p>
  <p style="color:#7a9bc0; font-size:13px; margin-top:24px;">
    Just sign in with the same Google account and you'll land on your dashboard. Welcome aboard!
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
