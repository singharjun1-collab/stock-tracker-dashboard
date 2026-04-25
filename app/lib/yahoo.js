// Yahoo Finance v8/chart fetcher.
//
// Why this lives here: both the Vercel cron (`/api/refresh-prices`) and
// the on-demand refresh path call this. Keeping the rate-limit /
// retry / parse logic in one place means the daily Claude scan and the
// dashboard see the SAME quote source with the SAME defensive
// behavior — no per-call drift.
//
// Source priority is intentionally narrow here (Yahoo only). The Claude
// SKILL handles Stooq fallback during its bigger scan; the dashboard
// cron stays simple and reports failures explicitly so we can see
// them in the admin banner instead of silently writing stale rows.

const YAHOO_BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const UA = 'stock-tracker/1.0 (https://stocktracker.getfamilyfinance.com)';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a single ticker's latest quote. Returns:
 *   { ok: true, ticker, price, previous_close, price_date, raw_meta }
 * or { ok: false, ticker, error_code, error_message }
 *
 * Retries up to 3x with exponential backoff on 429.
 */
export async function fetchYahooQuote(ticker, { range = '5d' } = {}) {
  const url = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
  const backoffs = [0, 2000, 8000];
  let lastErr = null;

  for (const wait of backoffs) {
    if (wait > 0) await sleep(wait);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        // 15s ceiling so a single slow ticker can't hang the cron
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) {
        lastErr = { code: '429', message: 'rate limited' };
        continue;
      }
      if (!res.ok) {
        return {
          ok: false,
          ticker,
          error_code: String(res.status),
          error_message: `HTTP ${res.status}`,
        };
      }
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      if (!result) {
        return { ok: false, ticker, error_code: 'PARSE', error_message: 'no chart result' };
      }
      const meta = result.meta || {};
      const price = meta.regularMarketPrice;
      if (price == null || Number.isNaN(price)) {
        return { ok: false, ticker, error_code: 'NO_PRICE', error_message: 'meta missing regularMarketPrice' };
      }

      // Compute previous close from the timeseries: penultimate non-null
      // close from the daily candles. More reliable than meta fields,
      // which sometimes return chartPreviousClose (start-of-range close)
      // instead of the prior session's close.
      const ts = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      const pairs = ts
        .map((t, i) => [t, closes[i]])
        .filter(([, c]) => c != null && !Number.isNaN(c));
      const lastPair = pairs[pairs.length - 1];
      const prevPair = pairs.length >= 2 ? pairs[pairs.length - 2] : null;

      const lastTs = lastPair ? lastPair[0] : meta.regularMarketTime;
      const priceDate = lastTs
        ? new Date(lastTs * 1000).toISOString().slice(0, 10)
        : new Date().toISOString().slice(0, 10);

      return {
        ok: true,
        ticker,
        price: Number(price),
        previous_close: prevPair ? Number(prevPair[1]) : (meta.regularMarketPreviousClose ?? null),
        price_date: priceDate,
      };
    } catch (e) {
      lastErr = { code: 'FETCH', message: e?.message || String(e) };
    }
  }

  return {
    ok: false,
    ticker,
    error_code: lastErr?.code || 'UNKNOWN',
    error_message: lastErr?.message || 'fetch failed after retries',
  };
}

/**
 * Fetch quotes for many tickers, staggered to avoid Yahoo 429s.
 * 250ms between calls = 4 req/s = well under any documented limit.
 *
 * Returns { results, ok_count, fail_count, abort_reason } where
 * `abort_reason` is set if we tripped the 20%-error circuit breaker.
 */
export async function fetchYahooQuotes(tickers, { staggerMs = 250 } = {}) {
  const results = [];
  let okCount = 0;
  let failCount = 0;
  let abortReason = null;

  for (let i = 0; i < tickers.length; i++) {
    const t = tickers[i];
    if (i > 0) await sleep(staggerMs);
    const r = await fetchYahooQuote(t);
    results.push(r);
    if (r.ok) okCount++; else failCount++;

    // Circuit breaker: if ≥20% of the first 10 fetches failed, abort.
    // Same rule the daily SKILL applies — don't beat on a rate-limited host.
    if (i === 9 && failCount / 10 >= 0.2) {
      abortReason = `Yahoo failure rate ${failCount}/10 in first 10 tickers — aborting batch`;
      break;
    }
  }

  return { results, ok_count: okCount, fail_count: failCount, abort_reason: abortReason };
}
