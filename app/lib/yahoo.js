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
/**
 * Internal: do one chart fetch with retries & 429 backoff.
 * Returns the parsed JSON or null on hard failure.
 */
async function fetchChart(url) {
  const backoffs = [0, 2000, 8000];
  for (const wait of backoffs) {
    if (wait > 0) await sleep(wait);
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) continue;
      if (!res.ok) return { error: { code: String(res.status), message: `HTTP ${res.status}` } };
      return { json: await res.json() };
    } catch (e) {
      if (wait === backoffs[backoffs.length - 1]) {
        return { error: { code: 'FETCH', message: e?.message || String(e) } };
      }
    }
  }
  return { error: { code: 'RATE_LIMITED', message: '429 after retries' } };
}

export async function fetchYahooQuote(ticker, { range = '5d' } = {}) {
  // We do TWO fetches in parallel:
  //   - daily   : interval=1d, range=5d. Daily candle closes are the OFFICIAL
  //               4pm auction prints, which we need for `previous_close`.
  //               NASDAQ's closing cross can differ from the last continuous
  //               trade by several percent; the 15m candle would mislead.
  //   - intraday: interval=15m, range=1d, includePrePost=true. This is the
  //               only response that includes pre/post-market candles, so it
  //               is our source for after-hours and pre-market last-trade.
  // Total ~25KB per ticker. Two fetches in parallel = no extra wall-clock time.
  const dailyUrl = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?interval=1d&range=${range}`;
  const intraUrl = `${YAHOO_BASE}/${encodeURIComponent(ticker)}?interval=15m&range=1d&includePrePost=true`;

  const [dailyRes, intraRes] = await Promise.all([fetchChart(dailyUrl), fetchChart(intraUrl)]);

  // Daily is the source of truth for price + previous_close. Hard-fail if it errors.
  if (dailyRes.error) {
    return { ok: false, ticker, error_code: dailyRes.error.code, error_message: dailyRes.error.message };
  }
  const dailyResult = dailyRes.json?.chart?.result?.[0];
  if (!dailyResult) {
    return { ok: false, ticker, error_code: 'PARSE', error_message: 'no chart result (daily)' };
  }
  const dMeta = dailyResult.meta || {};
  const price = dMeta.regularMarketPrice;
  if (price == null || Number.isNaN(price)) {
    return { ok: false, ticker, error_code: 'NO_PRICE', error_message: 'meta missing regularMarketPrice' };
  }

  // Daily candle closes ARE the official auction prints — what we want for previous_close.
  const dTs = dailyResult.timestamp || [];
  const dCloses = dailyResult.indicators?.quote?.[0]?.close || [];
  const dPairs = dTs.map((t, i) => [t, dCloses[i]]).filter(([, c]) => c != null && !Number.isNaN(c));
  const lastDailyPair = dPairs[dPairs.length - 1];
  const prevDailyPair = dPairs.length >= 2 ? dPairs[dPairs.length - 2] : null;

  const previous_close = prevDailyPair
    ? Number(prevDailyPair[1])
    : (dMeta.regularMarketPreviousClose ?? null);

  const lastTs = lastDailyPair ? lastDailyPair[0] : dMeta.regularMarketTime;
  const priceDate = lastTs
    ? new Date(lastTs * 1000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // Intraday is best-effort for AH/PM. If it fails, still return daily data.
  let post_market_price = null, post_market_change_pct = null, post_market_time = null;
  let pre_market_price = null,  pre_market_change_pct = null,  pre_market_time = null;

  if (!intraRes.error && intraRes.json) {
    const iResult = intraRes.json.chart?.result?.[0];
    if (iResult) {
      const iMeta = iResult.meta || {};
      const period = iMeta.currentTradingPeriod || {};
      const offsetSec = period.regular?.gmtoffset ?? -14400; // EDT default

      const iTs = iResult.timestamp || [];
      const iCloses = iResult.indicators?.quote?.[0]?.close || [];
      const iPairs = iTs.map((t, i) => [t, iCloses[i]]).filter(([, c]) => c != null && !Number.isNaN(c));
      const lastIntraPair = iPairs[iPairs.length - 1];

      // Use the *intraday* meta's current-day regular price as the AH baseline:
      // if the AH candle exists, the % is vs the regular-session close, not the
      // daily-feed `regularMarketPrice` (which can lag during fast-moving days).
      const intraPrice = iMeta.regularMarketPrice ?? price;

      // Classify by the candle's wall-clock time in ET, not by Yahoo's
      // `currentTradingPeriod` (which after 8pm ET points to TOMORROW's session
      // and would mis-classify yesterday's post-market candles as today's
      // pre-market). Pre-market = 04:00–09:30 ET, post-market = 16:00–20:00 ET.
      if (lastIntraPair && intraPrice > 0) {
        const [lastT, lastC] = lastIntraPair;
        const etMs = (lastT + offsetSec) * 1000;
        const etDate = new Date(etMs);
        const minOfDay = etDate.getUTCHours() * 60 + etDate.getUTCMinutes();
        const POST_START = 16 * 60;       // 16:00 ET
        const POST_END   = 20 * 60;       // 20:00 ET
        const PRE_START  = 4 * 60;        // 04:00 ET
        const PRE_END    = 9 * 60 + 30;   // 09:30 ET

        if (minOfDay >= POST_START && minOfDay <= POST_END) {
          post_market_price = Number(lastC);
          post_market_change_pct = ((lastC - intraPrice) / intraPrice) * 100;
          post_market_time = new Date(lastT * 1000).toISOString();
        } else if (minOfDay >= PRE_START && minOfDay < PRE_END) {
          pre_market_price = Number(lastC);
          pre_market_change_pct = ((lastC - intraPrice) / intraPrice) * 100;
          pre_market_time = new Date(lastT * 1000).toISOString();
        }
        // Else: regular-hours candle → no AH/PM data this run.
      }
    }
  }

  return {
    ok: true,
    ticker,
    price: Number(price),
    previous_close,
    price_date: priceDate,
    post_market_price,
    post_market_change_pct,
    post_market_time,
    pre_market_price,
    pre_market_change_pct,
    pre_market_time,
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
