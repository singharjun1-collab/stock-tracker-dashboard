import { NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// /api/stock-meta
// Batch endpoint that returns analyst + earnings + history data for a list of
// tickers in a single serverless invocation. Replaces per-card fetches to
// /api/analyst, /api/earnings, /api/history (which caused ~180 function
// invocations per dashboard load). Those routes still exist for backward
// compatibility.
//
// POST body: { tickers: ['AAPL', 'MSFT', ...] }
// GET:       ?tickers=AAPL,MSFT,...
//
// Response:  { meta: { AAPL: { analyst, earnings, history }, ... }, ttl: 900 }
//
// Each per-ticker fetch to Yahoo Finance uses Next.js's built-in fetch cache
// (revalidate), so warm requests within the TTL are near-instant and don't
// burn serverless CPU on re-fetching upstream data.
// ─────────────────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const MAX_TICKERS = 200;     // safety cap to prevent abuse
const ANALYST_TTL  = 3600;   //  1h — analyst consensus doesn't move often
const EARNINGS_TTL = 21600;  //  6h — earnings dates rarely change
const HISTORY_TTL  = 900;    // 15m — daily close updates at market close

// ── Analyst ─────────────────────────────────────────────────────────────────
async function fetchAnalyst(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=recommendationTrend,financialData`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      next: { revalidate: ANALYST_TTL },
    });

    if (!res.ok) {
      // Fallback: v6 quote endpoint
      const fbUrl = `https://query1.finance.yahoo.com/v6/finance/quote?symbols=${encodeURIComponent(ticker)}`;
      const fbRes = await fetch(fbUrl, {
        headers: { 'User-Agent': UA },
        next: { revalidate: ANALYST_TTL },
      });
      if (fbRes.ok) {
        const fbData = await fbRes.json();
        const quote = fbData?.quoteResponse?.result?.[0];
        if (quote) {
          return {
            ticker: ticker.toUpperCase(),
            averageRating: quote.averageAnalystRating || null,
            targetMeanPrice: quote.targetMeanPrice || null,
            targetHighPrice: null,
            targetLowPrice: null,
            numberOfAnalysts: quote.numberOfAnalystOpinions || 0,
            recommendationKey: quote.recommendationKey || null,
            breakdown: null,
          };
        }
      }
      return emptyAnalyst(ticker);
    }

    const data = await res.json();
    const financialData = data?.quoteSummary?.result?.[0]?.financialData;
    const recTrend = data?.quoteSummary?.result?.[0]?.recommendationTrend?.trend?.[0];

    const result = {
      ticker: ticker.toUpperCase(),
      recommendationKey: financialData?.recommendationKey || null,
      targetMeanPrice: financialData?.targetMeanPrice?.raw || null,
      targetHighPrice: financialData?.targetHighPrice?.raw || null,
      targetLowPrice: financialData?.targetLowPrice?.raw || null,
      numberOfAnalysts: financialData?.numberOfAnalystOpinions?.raw || 0,
      breakdown: recTrend ? {
        strongBuy: recTrend.strongBuy || 0,
        buy: recTrend.buy || 0,
        hold: recTrend.hold || 0,
        sell: recTrend.sell || 0,
        strongSell: recTrend.strongSell || 0,
      } : null,
    };

    if (result.recommendationKey) {
      const ratingMap = {
        'strong_buy':   '1.0 - Strong Buy',
        'buy':          '2.0 - Buy',
        'hold':         '3.0 - Hold',
        'underperform': '4.0 - Underperform',
        'sell':         '5.0 - Sell',
      };
      result.averageRating = ratingMap[result.recommendationKey] || result.recommendationKey;
    }

    return result;
  } catch (err) {
    console.error(`[stock-meta] analyst fetch failed for ${ticker}:`, err?.message);
    return emptyAnalyst(ticker);
  }
}

function emptyAnalyst(ticker) {
  return {
    ticker: ticker.toUpperCase(),
    averageRating: null,
    numberOfAnalysts: 0,
    recommendationKey: null,
    breakdown: null,
  };
}

// ── Earnings ────────────────────────────────────────────────────────────────
async function fetchEarnings(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=calendarEvents,earningsHistory`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      next: { revalidate: EARNINGS_TTL },
    });

    if (!res.ok) return emptyEarnings(ticker);

    const data = await res.json();
    const calendarEvents = data?.quoteSummary?.result?.[0]?.calendarEvents;
    const earningsHistory = data?.quoteSummary?.result?.[0]?.earningsHistory?.history;
    const earningsDates = calendarEvents?.earnings?.earningsDate;

    let earningsDate = null;
    let earningsDateEnd = null;

    if (earningsDates && earningsDates.length > 0) {
      earningsDate = earningsDates[0]?.raw
        ? new Date(earningsDates[0].raw * 1000).toISOString().split('T')[0]
        : earningsDates[0]?.fmt || null;
      if (earningsDates.length > 1) {
        earningsDateEnd = earningsDates[1]?.raw
          ? new Date(earningsDates[1].raw * 1000).toISOString().split('T')[0]
          : earningsDates[1]?.fmt || null;
      }
    }

    // ── Past-date filter ───────────────────────────────────────────────
    // Yahoo returns the *most recent* earnings event in `earningsDate`,
    // which can be in the past. Pass that through and the AI ends up
    // recommending "pre-position before the EPS catalyst" for an event
    // that already printed (see DUOL 2026-05-05). Strip past dates and
    // expose the historical print as `lastReportedDate` instead.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const isFuture = (s) => s && new Date(s + 'T00:00:00') >= todayStart;

    let lastReportedDate = null;
    if (earningsDate && !isFuture(earningsDate)) {
      lastReportedDate = earningsDate;
      earningsDate = null;
      earningsDateEnd = null;
    }
    if (!lastReportedDate && Array.isArray(earningsHistory) && earningsHistory.length > 0) {
      const latest = earningsHistory[earningsHistory.length - 1];
      const ts = latest?.quarter?.raw;
      if (ts) lastReportedDate = new Date(ts * 1000).toISOString().split('T')[0];
    }

    const formatDate = (d) => {
      if (!d) return null;
      return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      });
    };

    return {
      ticker: ticker.toUpperCase(),
      earningsDate,
      earningsDateEnd,
      earningsDateFormatted: formatDate(earningsDate),
      earningsDateEndFormatted: formatDate(earningsDateEnd),
      lastReportedDate,
      lastReportedDateFormatted: formatDate(lastReportedDate),
      // Guaranteed non-negative now (null if no future date known)
      daysUntilEarnings: earningsDate
        ? Math.ceil((new Date(earningsDate) - new Date()) / (1000 * 60 * 60 * 24))
        : null,
    };
  } catch (err) {
    console.error(`[stock-meta] earnings fetch failed for ${ticker}:`, err?.message);
    return emptyEarnings(ticker);
  }
}

function emptyEarnings(ticker) {
  return {
    ticker: ticker.toUpperCase(),
    earningsDate: null,
    earningsDateFormatted: null,
  };
}

// ── History (3-month daily closes) ──────────────────────────────────────────
async function fetchHistory(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=3mo&interval=1d&includePrePost=false`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      next: { revalidate: HISTORY_TTL },
    });

    if (!res.ok) return { ticker: ticker.toUpperCase(), error: `upstream ${res.status}` };

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) return { ticker: ticker.toUpperCase(), error: 'no data' };

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    const prices = timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      price: closes[i] != null ? Math.round(closes[i] * 100) / 100 : null,
    })).filter(p => p.price !== null);

    const startPrice = prices[0]?.price;
    const endPrice = prices[prices.length - 1]?.price;
    const change3mo = startPrice && endPrice
      ? Math.round(((endPrice - startPrice) / startPrice) * 10000) / 100
      : null;

    return {
      ticker: ticker.toUpperCase(),
      prices,
      change3mo,
      startPrice,
      endPrice,
    };
  } catch (err) {
    console.error(`[stock-meta] history fetch failed for ${ticker}:`, err?.message);
    return { ticker: ticker.toUpperCase(), error: 'fetch failed' };
  }
}

// ── Handler helpers ─────────────────────────────────────────────────────────
function parseTickers(input) {
  if (!input) return [];
  const arr = Array.isArray(input)
    ? input
    : String(input).split(',');
  const clean = [...new Set(
    arr
      .map(t => String(t || '').trim().toUpperCase())
      .filter(t => /^[A-Z0-9.\-]{1,10}$/.test(t))
  )];
  return clean.slice(0, MAX_TICKERS);
}

async function buildMetaResponse(tickers) {
  // For each ticker, run the three sub-fetches in parallel.
  // Promise.allSettled so a single bad ticker can't poison the whole batch.
  const results = await Promise.all(tickers.map(async (ticker) => {
    const [analystR, earningsR, historyR] = await Promise.allSettled([
      fetchAnalyst(ticker),
      fetchEarnings(ticker),
      fetchHistory(ticker),
    ]);
    return [ticker, {
      analyst:  analystR.status  === 'fulfilled' ? analystR.value  : emptyAnalyst(ticker),
      earnings: earningsR.status === 'fulfilled' ? earningsR.value : emptyEarnings(ticker),
      history:  historyR.status  === 'fulfilled' ? historyR.value  : { ticker, error: 'rejected' },
    }];
  }));

  const meta = Object.fromEntries(results);
  return { meta, ttl: HISTORY_TTL, count: tickers.length };
}

// ── Route handlers ──────────────────────────────────────────────────────────
// Auth gate: match the existing /api/analyst /api/earnings /api/history
// pattern (stock_auth cookie). Dashboard already sets this on login, so no
// client change is required.
function isAuthed(request) {
  const authCookie = request.cookies.get('stock_auth');
  return !!(authCookie && authCookie.value === 'authenticated');
}

export async function POST(request) {
  if (!isAuthed(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const tickers = parseTickers(body?.tickers);
  if (tickers.length === 0) {
    return NextResponse.json({ error: 'No valid tickers provided' }, { status: 400 });
  }

  const payload = await buildMetaResponse(tickers);
  return NextResponse.json(payload, {
    headers: {
      // Browser-only cache: quick back/forward navigations and double-loads
      // within 60s reuse the response without hitting the function at all.
      // Vercel Edge won't cache (auth cookie present) which is fine — the
      // per-ticker fetch cache inside the function handles server-side reuse.
      'Cache-Control': 'private, max-age=60',
    },
  });
}

export async function GET(request) {
  if (!isAuthed(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { searchParams } = new URL(request.url);
  const tickers = parseTickers(searchParams.get('tickers'));
  if (tickers.length === 0) {
    return NextResponse.json({ error: 'No valid tickers provided' }, { status: 400 });
  }

  const payload = await buildMetaResponse(tickers);
  return NextResponse.json(payload, {
    headers: { 'Cache-Control': 'private, max-age=60' },
  });
}
