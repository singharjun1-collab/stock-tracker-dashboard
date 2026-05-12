// Morning brief — pre-market futures snapshot + AI sentiment line.
//
// What this powers
//   The Market Mood card at the very top of /api/send-premarket-digest. Gives
//   subscribers a 5-second read on how the US market is shaping up before they
//   look at their individual picks. Robinhood-style: clean, brief, useful.
//
// Data sources (reuses what we already have — no new keys)
//   - Yahoo Finance v8 chart: futures tickers ES=F (S&P 500), NQ=F (Nasdaq 100),
//     YM=F (Dow), plus ^VIX for context fed to the AI (not displayed).
//   - Anthropic Haiku for the 2–3 sentence sentiment summary (same model
//     sector_pulse.js already uses for industry reads).
//
// Failure model — never block the email
//   If futures fail OR the AI call fails, we degrade gracefully: the digest
//   skips the Market Mood card rather than 500-ing. Email going out matters
//   more than this section being present.

import { fetchYahooQuote } from './yahoo.js';

// Tickers we display in the card (% change vs prior settle).
const DISPLAY_FUTURES = [
  { ticker: 'ES=F', label: 'S&P 500' },
  { ticker: 'NQ=F', label: 'Nasdaq 100' },
  { ticker: 'YM=F', label: 'Dow' },
];

// VIX is fetched as additional context for the AI prompt (so the summary can
// reflect "calm" vs "jittery" tape) but we deliberately don't display it —
// keeps the visual card focused on the three numbers that matter to most
// retail users.
const CONTEXT_TICKERS = [{ ticker: '^VIX', label: 'VIX' }];

/**
 * Compute a % change from current price vs previous close.
 * Returns null if either input is missing or zero (avoid /0).
 */
function pctChange(curr, prev) {
  if (curr == null || prev == null || !isFinite(curr) || !isFinite(prev) || prev === 0) {
    return null;
  }
  return ((curr - prev) / prev) * 100;
}

/**
 * Fetch all futures + VIX in parallel. Each result is normalized to:
 *   { ticker, label, price, previous_close, pct, ok }
 * If a fetch fails we still return a row with ok:false so the caller can
 * decide whether to skip the section or partially render.
 */
export async function fetchFuturesSnapshot() {
  const all = [...DISPLAY_FUTURES, ...CONTEXT_TICKERS];
  const results = await Promise.all(
    all.map(async ({ ticker, label }) => {
      try {
        const q = await fetchYahooQuote(ticker);
        if (!q.ok) {
          return { ticker, label, ok: false, error: q.error_message || q.error_code };
        }
        return {
          ticker,
          label,
          ok: true,
          price: q.price,
          previous_close: q.previous_close,
          pct: pctChange(q.price, q.previous_close),
        };
      } catch (e) {
        return { ticker, label, ok: false, error: e?.message || String(e) };
      }
    }),
  );

  const display = results.filter((r) =>
    DISPLAY_FUTURES.some((d) => d.ticker === r.ticker),
  );
  const context = results.filter((r) =>
    CONTEXT_TICKERS.some((c) => c.ticker === r.ticker),
  );

  return { display, context };
}

/**
 * Ask Claude Haiku to write a 2–3 sentence pre-market mood summary using only
 * the numbers we hand it (no training-data hallucinations about today's news).
 *
 * Returns { summary, ai_model } on success, or { summary: null } on any failure
 * (caller skips the AI sentence and just shows the numbers).
 */
export async function summarizeMarketMood({ display, context }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // If no API key, degrade to a deterministic one-liner derived from the futures.
  if (!apiKey) {
    return { summary: deterministicSummary(display), ai_model: 'fallback' };
  }

  // Build a compact prompt — only structured numbers, nothing speculative.
  const lines = [];
  for (const f of display) {
    if (f.ok && f.pct != null) {
      lines.push(`${f.label} futures: ${f.pct >= 0 ? '+' : ''}${f.pct.toFixed(2)}%`);
    }
  }
  for (const c of context) {
    if (c.ok && c.price != null) {
      const vixLine = c.pct != null
        ? `VIX: ${c.price.toFixed(2)} (${c.pct >= 0 ? '+' : ''}${c.pct.toFixed(2)}%)`
        : `VIX: ${c.price.toFixed(2)}`;
      lines.push(vixLine);
    }
  }

  if (lines.length === 0) {
    return { summary: null, ai_model: 'no-data' };
  }

  const systemPrompt = [
    'You write the opening line of a daily pre-market email for retail US stock investors.',
    'Rules:',
    '- 2 sentences MAX, plain English, conversational, no jargon.',
    '- Use ONLY the futures and VIX numbers provided. Do NOT invent news, earnings, or Fed events.',
    '- Lead with the overall tone (positive / mixed / cautious) and what the open looks like.',
    '- If futures are close to flat (< ±0.2%), say so plainly — don\'t manufacture drama.',
    '- Never recommend buying or selling. Just describe what the tape is signaling.',
    '- Output PLAIN TEXT only — no JSON, no markdown, no quotes around it.',
  ].join('\n');

  const userPrompt = [
    'Pre-market futures and volatility right now:',
    ...lines,
    '',
    'Write the 2-sentence mood line for the top of the email.',
  ].join('\n');

  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = (resp?.content?.[0]?.text || '').trim();
    if (!text) {
      return { summary: deterministicSummary(display), ai_model: 'empty-response' };
    }
    // Defensive: strip any wrapping quotes / code fences the model occasionally adds.
    const cleaned = text
      .replace(/^```(?:text)?\s*/i, '')
      .replace(/```$/i, '')
      .replace(/^["'“‘]/, '')
      .replace(/["'”’]$/, '')
      .trim();
    return { summary: cleaned.slice(0, 500), ai_model: 'claude-haiku-4-5-20251001' };
  } catch (e) {
    // Don't fail the email — fall back to a deterministic one-liner.
    return { summary: deterministicSummary(display), ai_model: `error:${e?.message?.slice(0, 40) || 'unknown'}` };
  }
}

/**
 * Deterministic fallback if AI isn't available. Honest about what the numbers
 * are saying without pretending to summarise news.
 */
function deterministicSummary(display) {
  const usable = display.filter((d) => d.ok && d.pct != null);
  if (usable.length === 0) return null;

  const avgPct = usable.reduce((s, d) => s + d.pct, 0) / usable.length;
  let tone;
  if (avgPct > 0.4) tone = 'pointing to a positive open';
  else if (avgPct > 0.1) tone = 'leaning slightly positive ahead of the bell';
  else if (avgPct < -0.4) tone = 'pointing to a softer open';
  else if (avgPct < -0.1) tone = 'leaning slightly negative ahead of the bell';
  else tone = 'pretty flat — markets look quiet ahead of the open';

  const parts = usable.map(
    (d) => `${d.label} ${d.pct >= 0 ? '+' : ''}${d.pct.toFixed(2)}%`,
  );
  return `US futures are ${tone}. ${parts.join(', ')}.`;
}

/**
 * Top-level convenience: do both fetch + summarise, return everything the
 * email template needs to render the card. Never throws.
 */
export async function buildMorningBrief() {
  try {
    const { display, context } = await fetchFuturesSnapshot();
    // If we got zero usable display numbers, skip the card entirely — better
    // to omit than to ship a half-rendered placeholder.
    const anyOk = display.some((d) => d.ok && d.pct != null);
    if (!anyOk) {
      return { ok: false, reason: 'no futures data', display, context, summary: null };
    }
    const { summary, ai_model } = await summarizeMarketMood({ display, context });
    return { ok: true, display, context, summary, ai_model };
  } catch (e) {
    return { ok: false, reason: e?.message || String(e), display: [], context: [], summary: null };
  }
}
