import { NextResponse } from 'next/server';

// ─────────────────────────────────────────────────────────────────────────────
// /api/company-profile
// Returns a short "what the company does" business summary for a ticker —
// powers the Yahoo-style "About this company" dropdown on each stock card.
//
// GET ?ticker=CLDX
// Response: { ticker, name, summary, sector, industry, website, employees }
//
// Yahoo's quoteSummary (which holds longBusinessSummary) now requires a session
// "crumb". We do the standard cookie→crumb handshake (same approach yfinance
// uses), cache the auth + parsed profiles in module memory, and fall back to the
// crumb-less v1/finance/search endpoint for sector/industry/name so the box is
// never blank.
// ─────────────────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// In-memory caches (persist across warm invocations on Vercel)
let cachedAuth = { cookie: null, crumb: null, ts: 0 };
const AUTH_TTL = 1000 * 60 * 30;            // 30 min — refresh crumb periodically
const profileCache = new Map();             // ticker -> { data, ts }
const PROFILE_TTL = 1000 * 60 * 60 * 24 * 7; // 7 days — descriptions ~never change

// ── Yahoo cookie + crumb handshake ───────────────────────────────────────────
async function getYahooAuth() {
  if (cachedAuth.crumb && Date.now() - cachedAuth.ts < AUTH_TTL) return cachedAuth;

  // 1. Hit a Yahoo endpoint to receive the consent/session cookie.
  let cookie = null;
  try {
    const cRes = await fetch('https://fc.yahoo.com/', {
      headers: { 'User-Agent': UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
    const setCookies = typeof cRes.headers.getSetCookie === 'function'
      ? cRes.headers.getSetCookie()
      : (cRes.headers.get('set-cookie') ? [cRes.headers.get('set-cookie')] : []);
    cookie = setCookies.map(c => c.split(';')[0]).join('; ') || null;
  } catch { /* fall through */ }

  // 2. Exchange cookie for a crumb.
  let crumb = null;
  try {
    const crumbRes = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Accept: 'text/plain', ...(cookie ? { Cookie: cookie } : {}) },
      signal: AbortSignal.timeout(8000),
    });
    if (crumbRes.ok) {
      const txt = (await crumbRes.text()).trim();
      if (txt && txt.length < 50 && !txt.includes('<')) crumb = txt;
    }
  } catch { /* fall through */ }

  cachedAuth = { cookie, crumb, ts: Date.now() };
  return cachedAuth;
}

// ── Primary: crumb-authed quoteSummary (has longBusinessSummary) ──────────────
async function fetchAssetProfile(ticker) {
  const { cookie, crumb } = await getYahooAuth();
  if (!crumb) return null;

  for (const host of ['query1', 'query2']) {
    try {
      const url = `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}`
        + `?modules=assetProfile,quoteType&crumb=${encodeURIComponent(crumb)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
        signal: AbortSignal.timeout(10000),
      });
      if (res.status === 401 || res.status === 403) { cachedAuth = { cookie: null, crumb: null, ts: 0 }; continue; }
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.quoteSummary?.result?.[0];
      if (!result) continue;
      const p = result.assetProfile || {};
      const q = result.quoteType || {};
      return {
        name: q.longName || q.shortName || null,
        summary: p.longBusinessSummary || null,
        sector: p.sector || null,
        industry: p.industry || null,
        website: p.website || null,
        employees: p.fullTimeEmployees ?? null,
      };
    } catch { /* try next host */ }
  }
  return null;
}

// ── Fallback: crumb-less search (sector/industry/name, no description) ─────────
async function fetchSearchProfile(ticker) {
  try {
    const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&quotesCount=1&newsCount=0&enableFuzzyQuery=false`;
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const q = (data?.quotes || []).find(x => x?.symbol?.toUpperCase() === ticker.toUpperCase()) || data?.quotes?.[0];
    if (!q) return null;
    return {
      name: q.longname || q.shortname || null,
      summary: null,
      sector: q.sectorDisp || q.sector || null,
      industry: q.industryDisp || q.industry || null,
      website: null,
      employees: null,
    };
  } catch {
    return null;
  }
}

export async function GET(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const ticker = (searchParams.get('ticker') || '').trim().toUpperCase();
  if (!ticker || !/^[A-Z0-9.\-]{1,10}$/.test(ticker)) {
    return NextResponse.json({ error: 'Missing or invalid ticker' }, { status: 400 });
  }

  // Serve from warm cache when available.
  const hit = profileCache.get(ticker);
  if (hit && Date.now() - hit.ts < PROFILE_TTL && hit.data.summary) {
    return NextResponse.json({ ticker, ...hit.data });
  }

  let data = await fetchAssetProfile(ticker);
  // Merge in search fallback for any missing fields (esp. when crumb fails).
  if (!data || !data.summary) {
    const fb = await fetchSearchProfile(ticker);
    if (fb) {
      data = {
        name: data?.name || fb.name,
        summary: data?.summary || fb.summary,
        sector: data?.sector || fb.sector,
        industry: data?.industry || fb.industry,
        website: data?.website || fb.website,
        employees: data?.employees ?? fb.employees,
      };
    }
  }

  if (!data) {
    data = { name: null, summary: null, sector: null, industry: null, website: null, employees: null };
  }

  if (data.summary) profileCache.set(ticker, { data, ts: Date.now() });

  return NextResponse.json({ ticker, ...data }, {
    headers: { 'Cache-Control': 'private, max-age=3600' },
  });
}
