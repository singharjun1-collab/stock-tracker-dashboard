import { NextResponse } from 'next/server';

export async function GET(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return NextResponse.json({ error: 'Missing ticker parameter' }, { status: 400 });
  }

  try {
    // Fetch earnings calendar from Yahoo Finance v11 quoteSummary
    const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=calendarEvents,earningsHistory`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      next: { revalidate: 86400 }, // Cache for 24 hours
      // Fail fast if Yahoo hangs — Vercel middleware has a 25s wall.
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({
        ticker: ticker.toUpperCase(),
        earningsDate: null,
        earningsDateFormatted: null,
      });
    }

    const data = await res.json();
    const calendarEvents = data?.quoteSummary?.result?.[0]?.calendarEvents;
    const earningsHistory = data?.quoteSummary?.result?.[0]?.earningsHistory?.history;

    // Next earnings date
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
    // Yahoo's `earningsDate` field returns the *most recent* earnings event,
    // which can be in the PAST if no future date is scheduled yet. If we
    // pass that to the AI, it cheerfully says "pre-position before the EPS
    // catalyst" for an event that already happened (DUOL 2026-05-05 incident).
    // Strip past dates and surface them as `lastReportedDate` instead.
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const isFuture = (s) => s && new Date(s + 'T00:00:00') >= todayStart;

    let lastReportedDate = null;
    if (earningsDate && !isFuture(earningsDate)) {
      lastReportedDate = earningsDate;
      earningsDate = null;
      earningsDateEnd = null;
    }
    // Cross-check against earningsHistory for the most recent ACTUAL print
    if (!lastReportedDate && Array.isArray(earningsHistory) && earningsHistory.length > 0) {
      const latest = earningsHistory[earningsHistory.length - 1];
      const ts = latest?.quarter?.raw;
      if (ts) lastReportedDate = new Date(ts * 1000).toISOString().split('T')[0];
    }

    // Format nicely
    const formatDate = (d) => {
      if (!d) return null;
      return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
      });
    };

    const result = {
      ticker: ticker.toUpperCase(),
      earningsDate,
      earningsDateEnd,
      earningsDateFormatted: formatDate(earningsDate),
      earningsDateEndFormatted: formatDate(earningsDateEnd),
      lastReportedDate,
      lastReportedDateFormatted: formatDate(lastReportedDate),
      // Days until earnings — guaranteed non-negative now (null if no future date)
      daysUntilEarnings: earningsDate
        ? Math.ceil((new Date(earningsDate) - new Date()) / (1000 * 60 * 60 * 24))
        : null,
    };

    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'private, max-age=300' },
    });
  } catch (error) {
    console.error(`Error fetching earnings for ${ticker}:`, error);
    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      earningsDate: null,
      earningsDateFormatted: null,
    });
  }
}
