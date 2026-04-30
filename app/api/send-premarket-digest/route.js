import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/app/lib/supabase/admin';
import { sendEmail } from '@/app/lib/email';
import { makeUnsubscribeUrl } from '@/app/lib/unsubscribe-token';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;

// Why this endpoint exists
//   The daily-stock-tracker scheduled task fires this once per weekday at the
//   6:30 AM ET pre-market run. Decoupling the email build from the scheduled
//   task means:
//     - The email always reads the LATEST persisted state in Supabase
//       (recommendation flips, new picks, portfolio P/L) — guaranteeing the
//       email and the dashboard agree.
//     - We can hand-trigger a re-send by curl-ing the endpoint without
//       re-running the whole scan.
//     - The render code lives in the repo (reviewable, version-controlled)
//       instead of buried in the Claude SKILL.
//
// Auth model
//   Same as /api/refresh-prices: Vercel-cron-style Bearer CRON_SECRET, OR
//   an authenticated approved user (so AJ can hit it from the dashboard if
//   he wants to re-send).
//
// What it does
//   1. Read alert_distribution_list (active=true AND unsubscribed_at IS NULL)
//   2. Read today's run state from Supabase:
//      - signal_changes from the last 24h (rec flips since yesterday's close)
//      - stock_alerts where status='new' (added overnight)
//      - stock_alerts where status='active' (current portfolio)
//      - paper_trades where status='open' (open positions for P/L)
//   3. Build an HTML digest in the Stock Chatter brand
//   4. Send ONE email via Gmail SMTP — To: AJ, Bcc: every other recipient
//      Each recipient's copy needs its own unsubscribe link, so we actually
//      send N emails (one per recipient, each with To: that recipient).
//      This achieves the same privacy goal as BCC (no one sees other
//      addresses) AND lets each person have their own one-click unsubscribe.
//   5. Return a summary so the SKILL can log a "sent_to=N" line.

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL || 'https://stocktracker.getfamilyfinance.com';

async function authorize(req) {
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true, source: 'cron' };
  }
  // (Optional user-path could be added later — for now cron-only is enough.)
  return { ok: false, status: 401, error: 'Unauthorized' };
}

function todayET() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  return fmt.format(new Date()); // e.g. "April 30, 2026"
}

function shortET() {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
  });
  return fmt.format(new Date()); // e.g. "April 30"
}

async function loadDigestData() {
  const admin = createSupabaseAdminClient();

  // Last 24h of recommendation flips
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [recipientsRes, recChangesRes, newPicksRes, activePicksRes, openTradesRes] =
    await Promise.all([
      admin
        .from('alert_distribution_list')
        .select('email, name')
        .eq('active', true)
        .is('unsubscribed_at', null),
      admin
        .from('signal_changes')
        .select('ticker, old_recommendation, new_recommendation, change_date, created_at')
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }),
      admin
        .from('stock_alerts')
        .select(
          'ticker, company, signal_type, recommendation, ai_read, entry_low, entry_high, target_low, target_high, stop_loss, market_cap, alert_reason, price_at_alert',
        )
        .eq('status', 'new')
        .order('created_at', { ascending: false })
        .limit(20),
      admin
        .from('stock_alerts')
        .select(
          'ticker, company, recommendation, ai_read, price_at_alert, target_high, stop_loss',
        )
        .eq('status', 'active')
        .limit(50),
      admin
        .from('paper_trades')
        .select('ticker, qty, entry_price, status')
        .eq('status', 'open'),
    ]);

  if (recipientsRes.error) throw new Error(`recipients: ${recipientsRes.error.message}`);

  // Latest current_prices for portfolio P/L + active-pick valuations
  const tickersOfInterest = new Set();
  for (const t of openTradesRes.data || []) tickersOfInterest.add(t.ticker);
  for (const a of activePicksRes.data || []) tickersOfInterest.add(a.ticker);
  for (const a of newPicksRes.data || []) tickersOfInterest.add(a.ticker);

  let pricesByTicker = {};
  if (tickersOfInterest.size > 0) {
    const { data: prices } = await admin
      .from('current_prices')
      .select('ticker, price, previous_close')
      .in('ticker', [...tickersOfInterest]);
    pricesByTicker = Object.fromEntries(
      (prices || []).map((p) => [p.ticker, p]),
    );
  }

  return {
    recipients: recipientsRes.data || [],
    recChanges: recChangesRes.data || [],
    newPicks: newPicksRes.data || [],
    activePicks: activePicksRes.data || [],
    openTrades: openTradesRes.data || [],
    prices: pricesByTicker,
  };
}

function fmtMoney(n) {
  if (n == null || isNaN(n)) return '—';
  return `$${Number(n).toFixed(2)}`;
}

function fmtPct(n) {
  if (n == null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Number(n).toFixed(1)}%`;
}

function recColor(rec) {
  switch (rec) {
    case 'BUY':
      return '#22c55e';
    case 'HOLD':
      return '#fbbf24';
    case 'TRIM':
      return '#fb923c';
    case 'EXIT':
      return '#a78bfa';
    case 'SELL':
      return '#ef4444';
    default:
      return '#94a3b8';
  }
}

function buildHtml({ data, recipientEmail }) {
  const { recChanges, newPicks, activePicks, openTrades, prices } = data;

  // Portfolio P/L
  let portfolioPL = 0;
  let portfolioCost = 0;
  const positions = (openTrades || []).map((t) => {
    const p = prices[t.ticker];
    const live = p?.price;
    const pl = live != null ? (Number(live) - Number(t.entry_price)) * Number(t.qty) : null;
    const pct =
      live != null
        ? ((Number(live) - Number(t.entry_price)) / Number(t.entry_price)) * 100
        : null;
    if (pl != null) portfolioPL += pl;
    portfolioCost += Number(t.entry_price) * Number(t.qty);
    return { ...t, live, pl, pct };
  });
  const portfolioPct = portfolioCost > 0 ? (portfolioPL / portfolioCost) * 100 : null;

  // Biggest mover (winner + loser among open trades)
  const sortedByPct = positions
    .filter((p) => p.pct != null)
    .sort((a, b) => b.pct - a.pct);
  const biggestWinner = sortedByPct[0];
  const biggestLoser = sortedByPct[sortedByPct.length - 1];

  // Active count by recommendation
  const recCounts = activePicks.reduce((acc, a) => {
    acc[a.recommendation] = (acc[a.recommendation] || 0) + 1;
    return acc;
  }, {});

  // Top-of-mind blurb
  let topOfMind;
  const flipsToday = recChanges.length;
  if (flipsToday === 0 && newPicks.length === 0) {
    topOfMind = `<strong>Quiet morning.</strong> No recommendation flips overnight, no new picks added. Your portfolio is sitting at <strong>${fmtPct(portfolioPct)}</strong> overall — review the dashboard if you want to fine-tune any positions.`;
  } else if (flipsToday > 0 && newPicks.length === 0) {
    topOfMind = `<strong>${flipsToday} recommendation ${flipsToday === 1 ? 'change' : 'changes'} since yesterday's close.</strong> Scroll down for the flip list — you may want to act on these before the bell.`;
  } else if (newPicks.length > 0 && flipsToday === 0) {
    topOfMind = `<strong>${newPicks.length} new ${newPicks.length === 1 ? 'pick' : 'picks'} added overnight.</strong> Entry/target/stop bands below — line up your orders before 9:30 AM ET.`;
  } else {
    topOfMind = `<strong>${flipsToday} ${flipsToday === 1 ? 'flip' : 'flips'} + ${newPicks.length} new ${newPicks.length === 1 ? 'pick' : 'picks'} overnight.</strong> Both lists below — act before the bell.`;
  }

  const unsubUrl = makeUnsubscribeUrl(APP_URL, recipientEmail);

  // Use table-based HTML for max email-client compatibility (Gmail, Apple Mail, Outlook)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stock Chatter — Pre-market digest</title>
</head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e2e8f0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0e1a;padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111827;border-radius:16px;overflow:hidden;">
      <tr><td style="padding:24px 24px 8px 24px;">
        <div style="font-size:13px;letter-spacing:.08em;color:#4fc3f7;text-transform:uppercase;font-weight:600;">Stock Chatter · Pre-market digest</div>
        <div style="font-size:22px;font-weight:700;color:#fff;margin-top:4px;">${shortET()}</div>
      </td></tr>

      <tr><td style="padding:16px 24px 8px 24px;">
        <p style="margin:0;font-size:16px;line-height:1.55;color:#cbd5e1;">${topOfMind}</p>
      </td></tr>

      ${
        recChanges.length > 0
          ? `<tr><td style="padding:24px 24px 8px 24px;">
        <div style="font-size:14px;font-weight:600;color:#94a3b8;letter-spacing:.04em;text-transform:uppercase;margin-bottom:12px;">Recommendation flips</div>
        ${recChanges
          .map(
            (c) => `
          <div style="background:#0f172a;border-radius:10px;padding:12px 14px;margin-bottom:8px;border:1px solid #1e293b;">
            <div style="font-size:15px;font-weight:600;color:#fff;">${c.ticker}</div>
            <div style="font-size:13px;color:#94a3b8;margin-top:2px;">
              <span style="color:${recColor(c.old_recommendation)};font-weight:600;">${c.old_recommendation || '—'}</span>
              &nbsp;→&nbsp;
              <span style="color:${recColor(c.new_recommendation)};font-weight:600;">${c.new_recommendation || '—'}</span>
            </div>
          </div>`,
          )
          .join('')}
      </td></tr>`
          : ''
      }

      ${
        newPicks.length > 0
          ? `<tr><td style="padding:16px 24px 8px 24px;">
        <div style="font-size:14px;font-weight:600;color:#94a3b8;letter-spacing:.04em;text-transform:uppercase;margin-bottom:12px;">New picks (overnight)</div>
        ${newPicks
          .slice(0, 8)
          .map(
            (p) => `
          <div style="background:#0f172a;border-radius:10px;padding:14px;margin-bottom:10px;border:1px solid #1e293b;">
            <div style="display:flex;justify-content:space-between;align-items:baseline;">
              <div style="font-size:16px;font-weight:700;color:#fff;">${p.ticker}</div>
              <div style="font-size:12px;font-weight:600;color:${recColor(p.recommendation)};">${p.recommendation || ''}</div>
            </div>
            <div style="font-size:12px;color:#94a3b8;margin-top:2px;">${p.company || ''} · ${p.signal_type || ''}</div>
            ${p.ai_read ? `<div style="font-size:13px;color:#cbd5e1;margin-top:8px;line-height:1.5;">🧠 ${p.ai_read}</div>` : ''}
            <div style="font-size:12px;color:#94a3b8;margin-top:8px;">
              Entry ${fmtMoney(p.entry_low)}–${fmtMoney(p.entry_high)} ·
              Target ${fmtMoney(p.target_low)}–${fmtMoney(p.target_high)} ·
              Stop ${fmtMoney(p.stop_loss)}
            </div>
          </div>`,
          )
          .join('')}
        ${newPicks.length > 8 ? `<div style="font-size:12px;color:#94a3b8;text-align:center;margin-top:6px;">+${newPicks.length - 8} more on the dashboard</div>` : ''}
      </td></tr>`
          : ''
      }

      <tr><td style="padding:24px 24px 8px 24px;">
        <div style="font-size:14px;font-weight:600;color:#94a3b8;letter-spacing:.04em;text-transform:uppercase;margin-bottom:12px;">Open positions snapshot</div>
        <div style="background:#0f172a;border-radius:10px;padding:14px;border:1px solid #1e293b;">
          <div style="font-size:13px;color:#94a3b8;">Total P/L</div>
          <div style="font-size:24px;font-weight:700;color:${portfolioPL >= 0 ? '#22c55e' : '#ef4444'};margin-top:2px;">
            ${portfolioPL >= 0 ? '+' : ''}${fmtMoney(portfolioPL)} <span style="font-size:14px;font-weight:600;">(${fmtPct(portfolioPct)})</span>
          </div>
          ${
            biggestWinner
              ? `<div style="font-size:13px;color:#cbd5e1;margin-top:10px;">
                   🏆 Biggest winner: <strong>${biggestWinner.ticker}</strong> ${fmtPct(biggestWinner.pct)}
                 </div>`
              : ''
          }
          ${
            biggestLoser && biggestLoser.ticker !== biggestWinner?.ticker
              ? `<div style="font-size:13px;color:#cbd5e1;margin-top:4px;">
                   🥶 Biggest loser: <strong>${biggestLoser.ticker}</strong> ${fmtPct(biggestLoser.pct)}
                 </div>`
              : ''
          }
        </div>
      </td></tr>

      <tr><td style="padding:16px 24px 8px 24px;">
        <div style="font-size:14px;font-weight:600;color:#94a3b8;letter-spacing:.04em;text-transform:uppercase;margin-bottom:12px;">Active picks by rec</div>
        <div style="font-size:13px;color:#cbd5e1;line-height:1.7;">
          ${['BUY', 'HOLD', 'TRIM', 'EXIT', 'SELL']
            .map(
              (r) => `<span style="display:inline-block;margin-right:14px;">
                <span style="color:${recColor(r)};font-weight:600;">${r}</span>
                <span style="color:#94a3b8;">${recCounts[r] || 0}</span>
              </span>`,
            )
            .join('')}
        </div>
      </td></tr>

      <tr><td style="padding:24px 24px 28px 24px;text-align:center;">
        <a href="${APP_URL}" style="display:inline-block;background:#4fc3f7;color:#0a0e1a;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;">Open the dashboard →</a>
        <div style="font-size:12px;color:#94a3b8;margin-top:12px;">Place your orders before 9:30 AM ET (≈ 11:30 PM Sydney AEDT / 1:30 AM Sydney AEST).</div>
      </td></tr>

      <tr><td style="padding:16px 24px 24px 24px;border-top:1px solid #1e293b;">
        <div style="font-size:11px;color:#64748b;line-height:1.6;text-align:center;">
          You're receiving this because you're on the Stock Chatter alert list.<br>
          <a href="${unsubUrl}" style="color:#4fc3f7;text-decoration:none;">Unsubscribe</a> ·
          <a href="${APP_URL}" style="color:#4fc3f7;text-decoration:none;">Open dashboard</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function buildText({ data, recipientEmail }) {
  const { recChanges, newPicks } = data;
  const unsubUrl = makeUnsubscribeUrl(APP_URL, recipientEmail);
  const lines = [];
  lines.push(`Stock Chatter — Pre-market digest · ${shortET()}`);
  lines.push('');
  if (recChanges.length > 0) {
    lines.push(`${recChanges.length} recommendation flips since yesterday:`);
    for (const c of recChanges) {
      lines.push(`  - ${c.ticker}: ${c.old_recommendation || '—'} → ${c.new_recommendation || '—'}`);
    }
    lines.push('');
  }
  if (newPicks.length > 0) {
    lines.push(`${newPicks.length} new picks overnight:`);
    for (const p of newPicks.slice(0, 8)) {
      lines.push(`  - ${p.ticker} (${p.recommendation || '—'}) — ${p.ai_read || p.signal_type || ''}`);
    }
    lines.push('');
  }
  lines.push(`Open dashboard: ${APP_URL}`);
  lines.push('');
  lines.push(`Unsubscribe: ${unsubUrl}`);
  return lines.join('\n');
}

async function send({ dryRun = false }) {
  const data = await loadDigestData();
  const recipients = data.recipients;

  if (recipients.length === 0) {
    return { ok: true, sent_to: 0, note: 'no active recipients' };
  }

  const subject = `Stock Tracker — Pre-market digest · ${shortET()}`;
  const sendResults = [];

  for (const r of recipients) {
    const html = buildHtml({ data, recipientEmail: r.email });
    const text = buildText({ data, recipientEmail: r.email });

    if (dryRun) {
      sendResults.push({ email: r.email, dryRun: true, htmlBytes: html.length });
      continue;
    }

    const res = await sendEmail({
      to: r.email,
      subject,
      html,
      text,
    });
    sendResults.push({ email: r.email, ok: !!res.ok, id: res.id, error: res.error });
  }

  const sentCount = sendResults.filter((r) => r.ok || r.dryRun).length;
  return {
    ok: true,
    sent_to: sentCount,
    recipients: sendResults,
    today: todayET(),
  };
}

export async function POST(req) {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const url = new URL(req.url);
    const dryRun = url.searchParams.get('dryRun') === '1';
    const summary = await send({ dryRun });
    return NextResponse.json({ ...summary, source: auth.source }, { status: 200 });
  } catch (e) {
    console.error('send-premarket-digest fatal:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || 'send failed' },
      { status: 500 },
    );
  }
}

// Allow GET in dev to preview the body — production uses POST + Bearer.
export async function GET(req) {
  const url = new URL(req.url);
  if (url.searchParams.get('preview') === '1') {
    try {
      const data = await loadDigestData();
      const html = buildHtml({ data, recipientEmail: 'preview@example.com' });
      return new NextResponse(html, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    } catch (e) {
      return NextResponse.json({ error: e?.message }, { status: 500 });
    }
  }
  return POST(req);
}
