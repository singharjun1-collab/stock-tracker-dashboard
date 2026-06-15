import { NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// /api/company-profile
// Returns a short "what the company does" business summary for a ticker —
// powers the Yahoo-style "Overview" dropdown on each stock card.
//
// GET ?ticker=CLDX
// Response: { ticker, name, summary, sector, industry, website, employees }
//
// Source: Yahoo Finance quoteSummary `assetProfile` + `quoteType` modules.
// These descriptions almost never change, so we cache hard (7 days).
// ─────────────────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const TTL = 60 * 60 * 24 * 7; // 7 days

export async function GET(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawTicker = (searchParams.get('ticker') || '').trim().toUpperCase();
  if (!rawTicker || !/^[A-Z0-9.\-]{1,10}$/.test(rawTicker)) {
    return NextResponse.json({ error: 'Missing or invalid ticker' }, { status: 400 });
  }

  const empty = {
    ticker: rawTicker, name: null, summary: null,
    sector: null, industry: null, website: null, employees: null,
  };

  try {
    const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(rawTicker)}?modules=assetProfile,quoteType`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA },
      next: { revalidate: TTL },
    });

    if (!res.ok) return NextResponse.json(empty);

    const data = await res.json();
    const result = data?.quoteSummary?.result?.[0];
    const profile = result?.assetProfile;
    const quoteType = result?.quoteType;

    if (!profile && !quoteType) return NextResponse.json(empty);

    return NextResponse.json({
      ticker: rawTicker,
      name: quoteType?.longName || quoteType?.shortName || null,
      summary: profile?.longBusinessSummary || null,
      sector: profile?.sector || null,
      industry: profile?.industry || null,
      website: profile?.website || null,
      employees: profile?.fullTimeEmployees ?? null,
    });
  } catch (error) {
    console.error(`[company-profile] fetch failed for ${rawTicker}:`, error?.message);
    return NextResponse.json(empty);
  }
}
