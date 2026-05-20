import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/app/lib/supabase/admin';
import { sendEmail } from '@/app/lib/email';
import { makeUnsubscribeUrl } from '@/app/lib/unsubscribe-token';
import { buildMorningBrief } from '@/app/lib/morning_brief';

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
  // Re-signal window — keep in sync with dashboard `RESIGNAL_WINDOW_HOURS`
  // in app/dashboard/page.js so email and dashboard show the same picks.
  const RESIGNAL_WINDOW_HOURS = 18;
  const resignalCutoffIso = new Date(
    Date.now() - RESIGNAL_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();

  // Morning brief (futures snapshot + AI mood line) is fetched in parallel
  // with the Supabase queries so it adds zero wall-clock time to the digest
  // build. If it fails internally it returns ok:false — never throws — and
  // the email template just skips the Market Mood card.
  const morningBriefPromise = buildMorningBrief();

  const [
    recipientsRes,
    profilesRes,
    recChangesRes,
    newPicksRes,
    freshSignalPicksRes,
    activePicksRes,
    openTradesRes,
  ] = await Promise.all([
    admin
      .from('alert_distribution_list')
      .select('email, name')
      .eq('active', true)
      .is('unsubscribed_at', null),
    // Email -> user_id mapping so each recipient gets their own picks. The
    // distribution list keys on email; stock_alerts keys on user_id; this
    // join bridges them. (alert_distribution_list does not directly carry
    // user_id, so we look it up from profiles at send time.)
    admin
      .from('profiles')
      .select('id, email')
      .eq('status', 'approved'),
    admin
      .from('signal_changes')
      .select('ticker, old_recommendation, new_recommendation, change_date, created_at')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false }),
    // Brand-new picks — created overnight, status still 'new'.
    admin
      .from('stock_alerts')
      .select(
        'user_id, ticker, company, signal_type, recommendation, ai_read, entry_low, entry_high, target_low, target_high, stop_loss, market_cap, alert_reason, price_at_alert',
      )
      .eq('status', 'new')
      .order('created_at', { ascending: false })
      .limit(80), // 20/user × 4 active users — plenty of headroom
    // Fresh signals on existing picks — status='active' but the daily scan
    // re-detected them within RESIGNAL_WINDOW_HOURS. These would otherwise
    // be invisible to the user (the original alert was days/weeks ago).
    admin
      .from('stock_alerts')
      .select(
        'user_id, ticker, company, signal_type, recommendation, ai_read, entry_low, entry_high, target_low, target_high, stop_loss, market_cap, alert_reason, price_at_alert, last_resignal_at, signal_history',
      )
      .eq('status', 'active')
      .gte('last_resignal_at', resignalCutoffIso)
      .is('dismissed_at', null)
      .order('last_resignal_at', { ascending: false })
      .limit(80),
    admin
      .from('stock_alerts')
      .select(
        'user_id, ticker, company, recommendation, ai_read, price_at_alert, target_high, stop_loss, trail_stop, recent_high, riding_entered_at, entry_low',
      )
      .eq('status', 'active')
      .limit(500),
    admin
      .from('paper_trades')
      .select('user_id, ticker, qty, entry_price, status')
      .eq('status', 'open'),
  ]);

  if (recipientsRes.error) throw new Error(`recipients: ${recipientsRes.error.message}`);

  // Build email -> user_id lookup (lowercased to be tolerant of case mismatch)
  const emailToUserId = {};
  for (const p of profilesRes.data || []) {
    if (p.email) emailToUserId[p.email.toLowerCase()] = p.id;
  }

  // Latest current_prices for portfolio P/L + active-pick valuations
  const tickersOfInterest = new Set();
  for (const t of openTradesRes.data || []) tickersOfInterest.add(t.ticker);
  for (const a of activePicksRes.data || []) tickersOfInterest.add(a.ticker);
  for (const a of newPicksRes.data || []) tickersOfInterest.add(a.ticker);
  for (const a of freshSignalPicksRes.data || []) tickersOfInterest.add(a.ticker);

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

  const morningBrief = await morningBriefPromise;

  return {
    recipients: recipientsRes.data || [],
    emailToUserId,
    recChanges: recChangesRes.data || [],
    newPicks: newPicksRes.data || [],
    freshSignalPicks: freshSignalPicksRes.data || [],
    activePicks: activePicksRes.data || [],
    openTrades: openTradesRes.data || [],
    prices: pricesByTicker,
    morningBrief,
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

// Renders the Market Mood card — pre-market futures snapshot + AI sentiment
// sentence at the very top of the email. Returns an empty string (renders
// nothing) if the brief failed to build, so a futures-fetch hiccup never
// blocks the digest from going out.
function renderMarketMoodCard(brief) {
  if (!brief || !brief.ok) return '';
  const display = (brief.display || []).filter((d) => d.ok && d.pct != null);
  if (display.length === 0) return '';

  const futuresRow = display
    .map((d) => {
      const positive = d.pct >= 0;
      const color = positive ? '#22c55e' : '#ef4444';
      const arrow = positive ? '▲' : '▼';
      const sign = positive ? '+' : '';
      return `
        <td align="center" style="padding:8px 6px;">
          <div style="font-size:11px;color:#94a3b8;letter-spacing:.04em;text-transform:uppercase;font-weight:600;">${d.label}</div>
          <div style="font-size:16px;font-weight:700;color:${color};margin-top:4px;white-space:nowrap;">
            ${arrow} ${sign}${d.pct.toFixed(2)}%
          </div>
        </td>`;
    })
    .join('');

  const summaryBlock = brief.summary
    ? `<div style="font-size:14px;line-height:1.55;color:#e2e8f0;margin-top:14px;">${brief.summary}</div>`
    : '';

  return `<tr><td style="padding:16px 24px 0 24px;">
    <div style="background:linear-gradient(135deg,#0f172a 0%,#0b1426 100%);border:1px solid #1e293b;border-radius:12px;padding:16px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.08em;color:#4fc3f7;text-transform:uppercase;margin-bottom:10px;">Pre-market mood</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
        <tr>${futuresRow}</tr>
      </table>
      ${summaryBlock}
    </div>
  </td></tr>`;
}

function recColor(rec) {
  switch (rec) {
    case 'BUY':
      return '#22c55e';
    case 'HOLD':
      return '#fbbf24';
    case 'TRIM':
      return '#fb923c';
    case 'RIDING':
      return '#4ade80';
    case 'EXIT':
      return '#a78bfa';
    case 'SELL':
      return '#ef4444';
    default:
      return '#94a3b8';
  }
}

// Trim long AI-read strings to keep card height predictable on mobile.
// Cuts on a word boundary so we never end mid-token like "the comp…".
function truncate(s, n = 120) {
  if (!s) return '';
  const str = String(s).trim();
  if (str.length <= n) return str;
  const cut = str.slice(0, n).replace(/\s+\S*$/, '');
  return `${cut}…`;
}

// signal_changes can record the same flip multiple times (intra-day scan
// re-evaluations, idempotency drift, whatever) — without dedupe the email
// would show GME → SELL six times in a row. Keep only the most recent flip
// per ticker. recChanges is already ordered created_at DESC at query time.
function dedupeFlipsByTicker(recChanges) {
  const seen = new Set();
  const out = [];
  for (const c of recChanges || []) {
    if (!c?.ticker || seen.has(c.ticker)) continue;
    seen.add(c.ticker);
    out.push(c);
  }
  return out;
}

// Live-price line — previous close → current price (+% change), color-coded.
// Renders right above the entry/target/stop band on each card so the reader
// can instantly see how the stock sits relative to the entry range without
// flipping over to a brokerage app. Returns '' if we don't have current price
// data (defensive — never block the card from rendering).
function renderLivePrice(p, prices) {
  const pr = prices?.[p.ticker];
  if (!pr || pr.price == null) return '';
  const current = Number(pr.price);
  const prevClose = pr.previous_close != null ? Number(pr.previous_close) : null;
  if (!isFinite(current)) return '';

  const hasChange = prevClose != null && isFinite(prevClose) && prevClose > 0;
  const changePct = hasChange ? ((current - prevClose) / prevClose) * 100 : null;
  const positive = changePct != null ? changePct >= 0 : null;
  const changeColor = positive == null
    ? '#94a3b8'
    : positive
      ? '#22c55e'
      : '#ef4444';
  const arrow = positive == null ? '' : positive ? '▲' : '▼';
  const sign = changePct != null && changePct >= 0 ? '+' : '';

  const bits = [];
  if (prevClose != null) {
    bits.push(
      `<span style="color:#64748b;">Prev close</span> <span style="color:#94a3b8;font-weight:600;">${fmtMoney(prevClose)}</span>`,
    );
  }
  bits.push(
    `<span style="color:#64748b;">Now</span> <span style="color:#fff;font-weight:700;">${fmtMoney(current)}</span>`,
  );
  if (changePct != null) {
    bits.push(
      `<span style="color:${changeColor};font-weight:700;">${arrow} ${sign}${changePct.toFixed(2)}%</span>`,
    );
  }
  return `<div style="font-size:12px;line-height:1.5;margin-top:10px;letter-spacing:.01em;">${bits.join(' &nbsp;·&nbsp; ')}</div>`;
}

// "Above entry — chase risk" chip — appears when the current price has
// already broken above the top of the entry range. Matches AJ's no-post-surge
// rule: if we'd be chasing the move, surface that visibly so the reader
// pauses before placing the order.
function isAboveEntry(p, prices) {
  const pr = prices?.[p.ticker];
  if (!pr || pr.price == null || p.entry_high == null) return false;
  const current = Number(pr.price);
  const top = Number(p.entry_high);
  if (!isFinite(current) || !isFinite(top)) return false;
  return current > top;
}

function renderChaseRiskChip(p, prices) {
  if (!isAboveEntry(p, prices)) return '';
  return `<div style="margin-top:10px;">
    <span style="display:inline-block;font-size:10px;font-weight:800;color:#fb923c;background:rgba(251,146,60,0.12);border:1px solid rgba(251,146,60,0.35);padding:4px 9px;border-radius:6px;letter-spacing:.08em;text-transform:uppercase;">Above entry · chase risk</span>
  </div>`;
}

// Compact "Entry $X.XX – $Y.YY · Target … · Stop …" line. Skips fields that
// are null so a pick with no stop loss doesn't render "Stop —".
function renderPriceBands(p) {
  const bits = [];
  if (p.entry_low != null || p.entry_high != null) {
    const lo = fmtMoney(p.entry_low);
    const hi = fmtMoney(p.entry_high);
    bits.push(`<span style="color:#94a3b8;">Entry</span> <span style="color:#e2e8f0;font-weight:600;">${lo}${p.entry_high != null && p.entry_high !== p.entry_low ? `–${hi}` : ''}</span>`);
  }
  if (p.target_low != null || p.target_high != null) {
    const lo = fmtMoney(p.target_low);
    const hi = fmtMoney(p.target_high);
    bits.push(`<span style="color:#94a3b8;">Target</span> <span style="color:#22c55e;font-weight:600;">${lo}${p.target_high != null && p.target_high !== p.target_low ? `–${hi}` : ''}</span>`);
  }
  if (p.stop_loss != null) {
    bits.push(`<span style="color:#94a3b8;">Stop</span> <span style="color:#ef4444;font-weight:600;">${fmtMoney(p.stop_loss)}</span>`);
  }
  if (bits.length === 0) return '';
  return `<div style="font-size:12px;line-height:1.5;margin-top:10px;letter-spacing:.01em;">${bits.join(' &nbsp;·&nbsp; ')}</div>`;
}

function buildHtml({ data, recipientEmail }) {
  const {
    recChanges,
    newPicks: allNewPicks,
    freshSignalPicks: allFreshSignalPicks,
    activePicks: allActivePicks,
    emailToUserId,
    prices,
  } = data;

  // Per-recipient personalization. Each user only sees picks the AI scored
  // for them (their user_id). If we don't have a profiles row for this
  // email yet (e.g. an old distribution-list entry pre-dating multi-user),
  // fall back to no filter so they at least get the rec flips + portfolio.
  const recipientUserId = emailToUserId?.[recipientEmail?.toLowerCase()] || null;
  const ownedBy = (row) =>
    !recipientUserId || !row.user_id || row.user_id === recipientUserId;
  const newPicks = (allNewPicks || []).filter(ownedBy);
  const freshSignalPicks = (allFreshSignalPicks || []).filter(ownedBy);
  const activePicks = (allActivePicks || []).filter(ownedBy);

  // Lookup table: ticker -> active pick. Used to enrich each rec flip with
  // the current AI read for that ticker (so the Chatter section can show a
  // 1-line "why" under each flip).
  const activeByTicker = Object.fromEntries(
    (activePicks || []).map((a) => [a.ticker, a]),
  );

  // Dedupe rec flips by ticker so the same stock can't appear N times in a
  // row (fixes the GME×6 bug seen in the May 13 digest). After dedupe we
  // cap the rendered list — anything beyond surfaces as a "+N more" pill.
  const dedupedFlipsAll = dedupeFlipsByTicker(recChanges);

  // RIDING flips (added 2026-05-14) — anything that flipped to RIDING in
  // the last 24h gets its own "Still riding" section above Chatter, so the
  // celebratory tone isn't buried in the generic flip list. We also pull
  // these OUT of the Chatter list to avoid double-rendering.
  //
  // Note: flips are global (recChanges has no user_id column today, matching
  // the existing Chatter section's behavior). The activeByTicker lookup is
  // only for enriching with trail_stop/ai_read; if the recipient doesn't own
  // the alert, those enrichment fields are simply omitted.
  const ridingFlips = dedupedFlipsAll
    .filter((c) => (c.new_recommendation || '').toUpperCase() === 'RIDING');
  const ridingTickers = new Set(ridingFlips.map((c) => c.ticker));
  const dedupedFlips = dedupedFlipsAll.filter((c) => !ridingTickers.has(c.ticker));

  // Cap-and-spillover counts for each section. These also drive the hero
  // line at the top.
  const NEW_CAP = 5;
  const CHATTER_CAP = 8;
  const RIDING_CAP = 6;
  const newPicksToShow = newPicks.slice(0, NEW_CAP);
  const newPicksSpill = Math.max(0, newPicks.length - newPicksToShow.length);
  const chatterToShow = dedupedFlips.slice(0, CHATTER_CAP);
  const chatterSpill = Math.max(0, dedupedFlips.length - chatterToShow.length);
  const ridingToShow = ridingFlips.slice(0, RIDING_CAP);
  const ridingSpill = Math.max(0, ridingFlips.length - ridingToShow.length);

  // Hero line — keep it to one short sentence. Robinhood/Stake style: don't
  // narrate every state, just call out what's actionable.
  const heroBits = [];
  if (newPicks.length > 0) {
    heroBits.push(`<strong style="color:#fff;">${newPicks.length}</strong> fresh ${newPicks.length === 1 ? 'pick' : 'picks'}`);
  }
  if (dedupedFlips.length > 0) {
    heroBits.push(`<strong style="color:#fff;">${dedupedFlips.length}</strong> ${dedupedFlips.length === 1 ? 'flip' : 'flips'}`);
  }
  if (ridingFlips.length > 0) {
    heroBits.push(`<strong style="color:#4ade80;">${ridingFlips.length}</strong> still riding`);
  }
  let heroLine;
  if (heroBits.length === 0) {
    heroLine = `<strong style="color:#fff;">Quiet open.</strong> No new picks or rec changes overnight — sit tight, sip the coffee.`;
  } else {
    heroLine = `${heroBits.join(' · ')} overnight. Lined up below — act before the bell.`;
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
        <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="vertical-align:middle;padding-right:12px;">
              <img src="${APP_URL}/logo-email.png" alt="Stock Chatter" width="40" height="40" style="display:block;border:0;outline:none;" />
            </td>
            <td style="vertical-align:middle;">
              <div style="font-size:13px;letter-spacing:.08em;color:#4fc3f7;text-transform:uppercase;font-weight:600;">Stock Chatter · Pre-market digest</div>
              <div style="font-size:22px;font-weight:700;color:#fff;margin-top:4px;">${shortET()}</div>
            </td>
          </tr>
        </table>
      </td></tr>

      ${renderMarketMoodCard(data.morningBrief)}

      <tr><td style="padding:14px 24px 4px 24px;">
        <p style="margin:0;font-size:15px;line-height:1.55;color:#cbd5e1;">${heroLine}</p>
      </td></tr>

      ${
        newPicksToShow.length > 0
          ? `<tr><td style="padding:22px 24px 4px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:12px;">
          <tr>
            <td style="vertical-align:middle;">
              <div style="font-size:12px;font-weight:700;letter-spacing:.10em;color:#4fc3f7;text-transform:uppercase;">Fresh picks</div>
              <div style="font-size:12px;color:#64748b;margin-top:3px;">First-time detections from overnight</div>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="display:inline-block;font-size:11px;font-weight:700;background:rgba(79,195,247,0.12);color:#4fc3f7;padding:4px 9px;border-radius:999px;">${newPicks.length}</span>
            </td>
          </tr>
        </table>
        ${newPicksToShow
          .map(
            (p) => `
          <div style="background:#0f172a;border-radius:12px;padding:14px 16px;margin-bottom:10px;border:1px solid #1e293b;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td style="vertical-align:middle;">
                  <div style="font-size:20px;font-weight:800;color:#fff;letter-spacing:-.01em;">${p.ticker}</div>
                  <div style="font-size:12px;color:#94a3b8;margin-top:2px;">${p.company || ''}${p.signal_type ? ` <span style="color:#475569;">·</span> ${p.signal_type}` : ''}</div>
                </td>
                <td align="right" style="vertical-align:middle;white-space:nowrap;">
                  <span style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:.06em;color:${recColor(p.recommendation)};background:${recColor(p.recommendation)}22;padding:5px 10px;border-radius:6px;">${p.recommendation || '—'}</span>
                </td>
              </tr>
            </table>
            ${p.ai_read ? `<div style="font-size:13px;color:#cbd5e1;margin-top:10px;line-height:1.5;">${truncate(p.ai_read, 140)}</div>` : ''}
            ${renderLivePrice(p, prices)}
            ${renderPriceBands(p)}
            ${renderChaseRiskChip(p, prices)}
          </div>`,
          )
          .join('')}
        ${newPicksSpill > 0 ? `<div style="font-size:12px;color:#64748b;text-align:center;margin-top:2px;">+${newPicksSpill} more on the dashboard</div>` : ''}
      </td></tr>`
          : ''
      }

      ${
        ridingToShow.length > 0
          ? `<tr><td style="padding:22px 24px 4px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:12px;">
          <tr>
            <td style="vertical-align:middle;">
              <div style="font-size:12px;font-weight:700;letter-spacing:.10em;color:#4ade80;text-transform:uppercase;">Still riding</div>
              <div style="font-size:12px;color:#64748b;margin-top:3px;">Past target, signals still firing — trailing stops protecting the gain</div>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="display:inline-block;font-size:11px;font-weight:700;background:rgba(74,222,128,0.12);color:#4ade80;padding:4px 9px;border-radius:999px;">${ridingFlips.length}</span>
            </td>
          </tr>
        </table>
        ${ridingToShow
          .map((c) => {
            const active = activeByTicker[c.ticker];
            const why = active?.ai_read ? truncate(active.ai_read, 130) : '';
            const trail = active?.trail_stop != null ? fmtMoney(active.trail_stop) : null;
            const high  = active?.recent_high != null ? fmtMoney(active.recent_high) : null;
            const entry = active?.entry_low != null ? Number(active.entry_low) : null;
            const trailNum = active?.trail_stop != null ? Number(active.trail_stop) : null;
            const lockedPct = (entry && trailNum && entry > 0)
              ? ((trailNum - entry) / entry) * 100
              : null;
            return `
          <div style="background:#0f172a;border-radius:12px;padding:12px 16px;margin-bottom:8px;border:1px solid rgba(74,222,128,0.25);border-left:3px solid #4ade80;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td style="vertical-align:middle;">
                  <div style="font-size:16px;font-weight:800;color:#fff;letter-spacing:-.01em;">${c.ticker}</div>
                </td>
                <td align="right" style="vertical-align:middle;white-space:nowrap;font-size:11px;font-weight:700;letter-spacing:.04em;color:#4ade80;background:rgba(74,222,128,0.12);padding:4px 9px;border-radius:6px;">
                  RIDING
                </td>
              </tr>
            </table>
            ${renderLivePrice({ ticker: c.ticker }, prices)}
            ${trail ? `<div style="font-size:12px;color:#cbd5e1;margin-top:8px;line-height:1.5;">
              <span style="color:#94a3b8;">Trail stop</span> <span style="color:#4ade80;font-weight:700;">${trail}</span>
              ${lockedPct != null && lockedPct > 0 ? ` <span style="color:#475569;">·</span> <span style="color:#94a3b8;">locks in</span> <span style="color:#4ade80;font-weight:700;">+${lockedPct.toFixed(1)}%</span>` : ''}
              ${high ? ` <span style="color:#475569;">·</span> <span style="color:#94a3b8;">high</span> <span style="color:#e2e8f0;font-weight:600;">${high}</span>` : ''}
            </div>` : ''}
            ${why ? `<div style="font-size:12px;color:#94a3b8;margin-top:6px;line-height:1.5;">${why}</div>` : ''}
          </div>`;
          })
          .join('')}
        ${ridingSpill > 0 ? `<div style="font-size:12px;color:#64748b;text-align:center;margin-top:2px;">+${ridingSpill} more on the dashboard</div>` : ''}
      </td></tr>`
          : ''
      }

      ${
        chatterToShow.length > 0
          ? `<tr><td style="padding:22px 24px 4px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:12px;">
          <tr>
            <td style="vertical-align:middle;">
              <div style="font-size:12px;font-weight:700;letter-spacing:.10em;color:#fbbf24;text-transform:uppercase;">Chatter</div>
              <div style="font-size:12px;color:#64748b;margin-top:3px;">Recommendation flips in the last 24 hours</div>
            </td>
            <td align="right" style="vertical-align:middle;">
              <span style="display:inline-block;font-size:11px;font-weight:700;background:rgba(251,191,36,0.12);color:#fbbf24;padding:4px 9px;border-radius:999px;">${dedupedFlips.length}</span>
            </td>
          </tr>
        </table>
        ${chatterToShow
          .map((c) => {
            const active = activeByTicker[c.ticker];
            const why = active?.ai_read ? truncate(active.ai_read, 130) : '';
            return `
          <div style="background:#0f172a;border-radius:12px;padding:12px 16px;margin-bottom:8px;border:1px solid #1e293b;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
              <tr>
                <td style="vertical-align:middle;">
                  <div style="font-size:16px;font-weight:800;color:#fff;letter-spacing:-.01em;">${c.ticker}</div>
                </td>
                <td align="right" style="vertical-align:middle;white-space:nowrap;font-size:12px;font-weight:700;letter-spacing:.04em;">
                  <span style="color:${recColor(c.old_recommendation)};">${c.old_recommendation || '—'}</span>
                  <span style="color:#475569;font-weight:500;margin:0 6px;">→</span>
                  <span style="color:${recColor(c.new_recommendation)};">${c.new_recommendation || '—'}</span>
                </td>
              </tr>
            </table>
            ${renderLivePrice({ ticker: c.ticker }, prices)}
            ${why ? `<div style="font-size:12px;color:#94a3b8;margin-top:6px;line-height:1.5;">${why}</div>` : ''}
          </div>`;
          })
          .join('')}
        ${chatterSpill > 0 ? `<div style="font-size:12px;color:#64748b;text-align:center;margin-top:2px;">+${chatterSpill} more on the dashboard</div>` : ''}
      </td></tr>`
          : ''
      }

      ${
        freshSignalPicks.length > 0
          ? `<tr><td style="padding:14px 24px 0 24px;">
        <div style="font-size:12px;color:#64748b;line-height:1.6;">
          <span style="color:#fac775;font-weight:700;letter-spacing:.04em;">Also re-signaled:</span>
          ${freshSignalPicks
            .slice(0, 6)
            .map((p) => `<span style="display:inline-block;font-weight:700;color:#cbd5e1;margin-right:8px;">${p.ticker}</span>`)
            .join('')}
          ${freshSignalPicks.length > 6 ? `<span style="color:#475569;">+${freshSignalPicks.length - 6}</span>` : ''}
        </div>
      </td></tr>`
          : ''
      }

      <tr><td style="padding:26px 24px 28px 24px;text-align:center;">
        <a href="${APP_URL}" style="display:inline-block;background:#4fc3f7;color:#0a0e1a;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;">Open the dashboard →</a>
        <div style="font-size:12px;color:#94a3b8;margin-top:12px;">Place your orders before 9:30 AM ET (≈ 11:30 PM Sydney AEDT / 1:30 AM Sydney AEST).</div>
      </td></tr>

      <tr><td style="padding:16px 24px 24px 24px;border-top:1px solid #1e293b;">
        <div style="font-size:11px;color:#64748b;line-height:1.6;text-align:center;">
          You're receiving this because you're on the Stock Chatter alert list.<br>
          <a href="${unsubUrl}" style="color:#4fc3f7;text-decoration:none;">Unsubscribe</a> ·
          <a href="${APP_URL}" style="color:#4fc3f7;text-decoration:none;">Open dashboard</a> ·
          <a href="${APP_URL}/privacy" style="color:#4fc3f7;text-decoration:none;">Privacy</a> ·
          <a href="${APP_URL}/terms" style="color:#4fc3f7;text-decoration:none;">Terms</a>
          <br><br>
          <span style="color:#475569;">Stock Chatter is an information service. Not financial advice. You can lose money. See Terms for full disclaimers.</span>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function buildText({ data, recipientEmail }) {
  const {
    recChanges,
    newPicks: allNewPicks,
    freshSignalPicks: allFreshSignalPicks,
    emailToUserId,
    prices,
  } = data;

  // Helper — compact "now $X (+Y.YY%) prev $Z" line for plain-text rendering.
  // Mirrors renderLivePrice() above. Returns '' when we don't have a price.
  const priceLine = (ticker) => {
    const pr = prices?.[ticker];
    if (!pr || pr.price == null) return '';
    const cur = Number(pr.price);
    if (!isFinite(cur)) return '';
    const prev = pr.previous_close != null ? Number(pr.previous_close) : null;
    const pct = (prev != null && prev > 0) ? ((cur - prev) / prev) * 100 : null;
    const pctStr = pct != null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)` : '';
    const prevStr = prev != null ? ` · prev $${prev.toFixed(2)}` : '';
    return ` · now $${cur.toFixed(2)}${pctStr}${prevStr}`;
  };
  const aboveEntryStr = (p) => {
    const pr = prices?.[p.ticker];
    if (!pr || pr.price == null || p.entry_high == null) return '';
    return Number(pr.price) > Number(p.entry_high) ? ' [ABOVE ENTRY — chase risk]' : '';
  };
  const recipientUserId = emailToUserId?.[recipientEmail?.toLowerCase()] || null;
  const ownedBy = (row) =>
    !recipientUserId || !row.user_id || row.user_id === recipientUserId;
  const newPicks = (allNewPicks || []).filter(ownedBy);
  const freshSignalPicks = (allFreshSignalPicks || []).filter(ownedBy);

  const unsubUrl = makeUnsubscribeUrl(APP_URL, recipientEmail);
  const lines = [];
  lines.push(`Stock Chatter — Pre-market digest · ${shortET()}`);
  lines.push('');

  // Pre-market mood — futures snapshot + AI sentiment (mirrors HTML card).
  const brief = data.morningBrief;
  if (brief && brief.ok) {
    const usable = (brief.display || []).filter((d) => d.ok && d.pct != null);
    if (usable.length > 0) {
      lines.push('PRE-MARKET MOOD');
      const futuresLine = usable
        .map((d) => `${d.label} ${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(2)}%`)
        .join(' · ');
      lines.push(futuresLine);
      if (brief.summary) lines.push(brief.summary);
      lines.push('');
    }
  }

  // Dedupe flips by ticker for the plain-text version too (same fix as HTML).
  const dedupedFlipsAll = dedupeFlipsByTicker(recChanges);
  // RIDING flips get their own section, mirroring the HTML build.
  const ridingFlips = dedupedFlipsAll.filter(
    (c) => (c.new_recommendation || '').toUpperCase() === 'RIDING'
  );
  const ridingTickers = new Set(ridingFlips.map((c) => c.ticker));
  const dedupedFlips = dedupedFlipsAll.filter((c) => !ridingTickers.has(c.ticker));

  // Active-pick lookup so we can read trail_stop / recent_high per riding ticker.
  const activeByTicker = Object.fromEntries(
    (data.activePicks || []).map((a) => [a.ticker, a])
  );

  if (newPicks.length > 0) {
    lines.push(`FRESH PICKS (${newPicks.length})`);
    for (const p of newPicks.slice(0, 5)) {
      lines.push(`  · ${p.ticker} [${p.recommendation || '—'}]${priceLine(p.ticker)}${aboveEntryStr(p)} — ${truncate(p.ai_read || p.signal_type || '', 120)}`);
    }
    if (newPicks.length > 5) lines.push(`  +${newPicks.length - 5} more on the dashboard`);
    lines.push('');
  }
  if (ridingFlips.length > 0) {
    lines.push(`STILL RIDING (${ridingFlips.length})`);
    for (const c of ridingFlips.slice(0, 6)) {
      const active = activeByTicker[c.ticker] || {};
      const trail = active.trail_stop != null ? `$${Number(active.trail_stop).toFixed(2)}` : null;
      lines.push(`  · ${c.ticker}${priceLine(c.ticker)}${trail ? ` — trail stop ${trail}` : ''}${active.ai_read ? ` — ${truncate(active.ai_read, 110)}` : ''}`);
    }
    if (ridingFlips.length > 6) lines.push(`  +${ridingFlips.length - 6} more on the dashboard`);
    lines.push('');
  }
  if (dedupedFlips.length > 0) {
    lines.push(`CHATTER — rec flips (${dedupedFlips.length})`);
    for (const c of dedupedFlips.slice(0, 8)) {
      lines.push(`  · ${c.ticker}: ${c.old_recommendation || '—'} → ${c.new_recommendation || '—'}${priceLine(c.ticker)}`);
    }
    if (dedupedFlips.length > 8) lines.push(`  +${dedupedFlips.length - 8} more on the dashboard`);
    lines.push('');
  }
  if (freshSignalPicks.length > 0) {
    const list = freshSignalPicks
      .slice(0, 6)
      .map((p) => p.ticker)
      .join(', ');
    const tail = freshSignalPicks.length > 6 ? ` (+${freshSignalPicks.length - 6})` : '';
    lines.push(`Also re-signaled: ${list}${tail}`);
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

  const subject = `Stock Chatter — Pre-market digest · ${shortET()}`;
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
