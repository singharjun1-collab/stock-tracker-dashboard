import { NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/app/lib/supabase/admin';
import { getCurrentProfile } from '@/app/lib/supabase/server';
import { fetchYahooClassifications } from '@/app/lib/yahoo';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
// Worst case: ~80 tickers × 400ms stagger = ~32s. Yahoo can also hiccup.
// 60s is generous and matches refresh-prices.
export const maxDuration = 60;

// Why this endpoint exists
//   The new Sector Pulse UI groups stock cards by industry and shows an
//   AI macro read per sector. Both need a canonical sector/industry per
//   ticker, which we cache in `ticker_meta`. This endpoint populates that
//   cache from Yahoo's search API.
//
// Cadence
//   - Vercel Cron hits this once nightly (after the daily AI scan).
//   - Admin can also POST to manually re-classify everything.
//   - We DON'T re-classify tickers that already have a successful
//     classification newer than 30 days. Sector/industry essentially never
//     changes for a public company. This keeps Yahoo load near zero.
//
// Auth model (mirrors /api/refresh-prices)
//   - Vercel Cron: Bearer CRON_SECRET → ok
//   - Admin user (profiles.is_admin = true) → ok
//   - Anyone else → 403
//
// Failure surfacing
//   Per-ticker errors are stored on ticker_meta.last_error so the admin
//   banner (/api/source-health) can surface them. We also tag the response
//   so the manual-trigger button in the admin UI shows a clear summary.

async function authorize(req) {
  const authHeader = req.headers.get('authorization') || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return { ok: true, source: 'cron' };
  }
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, status: 401, error: 'Unauthorized' };
  if (!profile.is_admin) {
    // Classification is admin-only because it costs Yahoo calls. Regular
    // approved users don't get to trigger backfills.
    return { ok: false, status: 403, error: 'Admin only' };
  }
  return { ok: true, source: 'admin', userId: profile.id };
}

const FRESH_DAYS = 30;

/**
 * Decide which tickers need a (re)classification.
 *   - active set: tickers in stock_alerts.status in ('new','active','dropped')
 *   - skip if ticker_meta.classified_at within FRESH_DAYS AND industry is non-null
 *   - skip if ticker_meta.last_attempt_at within 24h with a permanent error
 *     (don't hammer Yahoo for delisted/junk tickers more than daily)
 */
async function pickTickersToClassify(admin, { force = false } = {}) {
  const [alertsRes, metaRes] = await Promise.all([
    admin
      .from('stock_alerts')
      .select('ticker')
      .in('status', ['new', 'active', 'dropped']),
    admin
      .from('ticker_meta')
      .select('ticker, industry, classified_at, last_attempt_at, last_error'),
  ]);

  if (alertsRes.error) throw new Error(`stock_alerts: ${alertsRes.error.message}`);
  if (metaRes.error)   throw new Error(`ticker_meta: ${metaRes.error.message}`);

  const tickerSet = new Set();
  for (const r of alertsRes.data || []) {
    if (r.ticker) tickerSet.add(String(r.ticker).toUpperCase());
  }

  const metaByTicker = new Map();
  for (const m of metaRes.data || []) metaByTicker.set(m.ticker, m);

  const freshCutoff   = new Date(Date.now() - FRESH_DAYS * 24 * 3600 * 1000);
  const failureCutoff = new Date(Date.now() - 24 * 3600 * 1000);

  const toClassify = [];
  for (const t of tickerSet) {
    if (force) { toClassify.push(t); continue; }
    const m = metaByTicker.get(t);
    if (!m) { toClassify.push(t); continue; }                                 // never classified
    if (m.industry && m.classified_at && new Date(m.classified_at) > freshCutoff) continue; // recent good
    if (m.last_error && m.last_attempt_at && new Date(m.last_attempt_at) > failureCutoff) continue; // failed <24h ago
    toClassify.push(t);
  }

  return { tickers: toClassify, totalActive: tickerSet.size, totalCached: metaByTicker.size };
}

async function classify({ force = false } = {}) {
  const admin = createSupabaseAdminClient();

  const { tickers, totalActive, totalCached } = await pickTickersToClassify(admin, { force });

  if (tickers.length === 0) {
    return {
      ok: true,
      total_active: totalActive,
      total_cached: totalCached,
      classified: 0,
      failed: 0,
      skipped: totalActive,
      note: 'all tickers already fresh',
    };
  }

  const { results, ok_count, fail_count, abort_reason } = await fetchYahooClassifications(tickers);

  // Build upsert rows. We always write SOMETHING for every ticker we
  // attempted, even on failure — last_attempt_at + last_error tracking
  // is how source_health surfaces the problem.
  const nowIso = new Date().toISOString();
  const rows = results.map((r) => {
    if (r.ok) {
      return {
        ticker: r.ticker,
        sector: r.sector,
        industry: r.industry,
        display_name: r.display_name,
        source: 'yahoo',
        classified_at: nowIso,
        last_attempt_at: nowIso,
        last_error: null,
      };
    }
    return {
      ticker: r.ticker,
      // Don't overwrite existing sector/industry/display_name on failure —
      // Postgres upsert on PRIMARY KEY only updates the columns we list.
      // We DO want to surface the error and bump last_attempt_at.
      source: 'yahoo',
      last_attempt_at: nowIso,
      last_error: `${r.error_code}: ${r.error_message}`.slice(0, 500),
    };
  });

  let writeError = null;
  if (rows.length > 0) {
    const { error } = await admin
      .from('ticker_meta')
      .upsert(rows, { onConflict: 'ticker' });
    if (error) writeError = error.message;
  }

  return {
    ok: !writeError,
    total_active: totalActive,
    total_cached: totalCached,
    classified: ok_count,
    failed: fail_count,
    abort_reason,
    write_error: writeError,
    failures: results.filter((r) => !r.ok).map((r) => ({ ticker: r.ticker, code: r.error_code, msg: r.error_message })),
    completed_at: nowIso,
  };
}

export async function GET(req) {
  const auth = await authorize(req);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  // ?force=1 re-classifies everything regardless of freshness.
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === '1';

  try {
    const summary = await classify({ force });
    return NextResponse.json({ ...summary, source: auth.source }, { status: summary.ok ? 200 : 500 });
  } catch (e) {
    console.error('classify-sectors fatal:', e);
    return NextResponse.json({ ok: false, error: e?.message || 'classify failed' }, { status: 500 });
  }
}

// POST is the path the admin "Classify now" button uses. Idempotent.
export async function POST(req) {
  return GET(req);
}
