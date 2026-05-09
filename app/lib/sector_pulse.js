// Sector Pulse data pipeline.
//
// Goal: produce one trustworthy "AI macro read" per industry, drawing only
// from curated, quality-filtered sources. AJ's standing rule:
//   "be careful re garbage in — use good sources"
//
// Source policy (v1)
//   1. Yahoo Finance headlines (publisher allowlist below)        — 24h window
//   2. r/stocks top posts                                          — 24h, ≥50 upvotes, ≥5 comments
//   3. r/investing top posts                                       — 24h, ≥50 upvotes, ≥5 comments
//
//   X (Twitter) and StockTwits are deliberately OUT for v1. Adding them
//   requires per-source moderation we don't have yet.
//
// Failure model
//   If a source fails or has no qualifying content, we still produce a
//   pulse using whatever DID return — but the AI summary is told exactly
//   which sources fed it, and `sector_pulse.sources` records the URLs
//   so a human can audit any specific summary.
//
// Cost / cadence
//   The AI call runs once per industry, once per day. With ~10–15 active
//   industries and ~$0.001 per Haiku call, this is well under $0.05/day.

const REDDIT_UA = 'stock-tracker/1.0 (https://stocktracker.getfamilyfinance.com)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Yahoo's news endpoint sometimes surfaces low-quality aggregator junk.
// We restrict to publishers we trust. Anything outside this set is dropped
// before reaching the AI prompt.
const YAHOO_PUBLISHER_ALLOWLIST = new Set([
  'Bloomberg', 'Reuters', 'Financial Times', 'The Wall Street Journal',
  'CNBC', 'Barron\'s', 'MarketWatch', 'Yahoo Finance', 'Investor\'s Business Daily',
  'Forbes', 'The Motley Fool', 'Seeking Alpha', 'Investopedia',
  'Associated Press', 'AP', 'Bloomberg News', 'Dow Jones Newswires',
  'Zacks Investment Research', 'TheStreet', 'Benzinga',
  // Sector specialists
  'BioPharma Dive', 'STAT', 'Endpoints News',     // biotech
  'Tom\'s Hardware', 'AnandTech', 'IEEE Spectrum', // semis / hardware
  'Rigzone', 'OilPrice.com',                       // energy
]);

// ─────────────────────────────────────────────────────────────
// 1. Yahoo news fetcher
// ─────────────────────────────────────────────────────────────
export async function fetchYahooNews(ticker, { limit = 8 } = {}) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search`
    + `?q=${encodeURIComponent(ticker)}&quotesCount=0&newsCount=${limit}&enableFuzzyQuery=false`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': REDDIT_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, ticker, error: `HTTP ${res.status}` };

    const json = await res.json();
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const items = (json?.news || [])
      .filter((n) => n?.providerPublishTime && (n.providerPublishTime * 1000) >= cutoff)
      .filter((n) => YAHOO_PUBLISHER_ALLOWLIST.has(n.publisher))
      .map((n) => ({
        title: n.title,
        publisher: n.publisher,
        url: n.link,
        publishedAt: new Date(n.providerPublishTime * 1000).toISOString(),
      }));
    return { ok: true, ticker, items };
  } catch (e) {
    return { ok: false, ticker, error: e?.message || 'fetch failed' };
  }
}

// ─────────────────────────────────────────────────────────────
// 2. Reddit fetcher (r/stocks, r/investing)
// ─────────────────────────────────────────────────────────────
// Quality gate: ≥50 upvotes AND ≥5 comments AND posted in last 24h.
// We use the public .json endpoint; no API key needed but a real UA is
// required or Reddit returns 429.
export async function fetchRedditTop(subreddit, { limit = 50 } = {}) {
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/top.json?t=day&limit=${limit}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': REDDIT_UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { ok: false, subreddit, error: `HTTP ${res.status}` };

    const json = await res.json();
    const cutoff = Date.now() - 24 * 3600 * 1000;
    const posts = (json?.data?.children || [])
      .map((c) => c?.data || {})
      .filter((p) =>
        p.score >= 50 &&
        p.num_comments >= 5 &&
        p.created_utc &&
        (p.created_utc * 1000) >= cutoff &&
        !p.over_18 &&
        !p.stickied
      )
      .map((p) => ({
        title: p.title,
        score: p.score,
        comments: p.num_comments,
        flair: p.link_flair_text || null,
        url: `https://www.reddit.com${p.permalink}`,
        // Truncate selftext to keep the AI prompt small.
        snippet: typeof p.selftext === 'string' ? p.selftext.slice(0, 400) : '',
      }));
    return { ok: true, subreddit, posts };
  } catch (e) {
    return { ok: false, subreddit, error: e?.message || 'fetch failed' };
  }
}

// Tickers/keywords matcher: returns true if any of the provided tokens
// (tickers like NVDA, or industry words like "semiconductor") appears in the
// post title/snippet. Case-insensitive whole-word.
export function postMatchesTokens(post, tokens) {
  if (!post || !tokens?.length) return false;
  const hay = `${post.title || ''} ${post.snippet || ''}`.toLowerCase();
  return tokens.some((tok) => {
    const t = tok.toLowerCase();
    if (!t) return false;
    // Whole-word for short tokens (tickers); substring for longer phrases.
    if (t.length <= 5) {
      const re = new RegExp(`(^|[^a-z0-9$])\\$?${t.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}([^a-z0-9]|$)`, 'i');
      return re.test(hay);
    }
    return hay.includes(t);
  });
}

// ─────────────────────────────────────────────────────────────
// 3. Per-industry stats (pct_today, pct_7d, top tickers, buzz)
// ─────────────────────────────────────────────────────────────
// All math from data the app already has — no extra Yahoo calls.
export async function computeIndustryStats(admin, industry, tickers) {
  if (!tickers?.length) {
    return { pct_today: null, pct_7d: null, top_tickers: [] };
  }

  // pct_today = mean of (price - prev_close)/prev_close * 100 across tickers
  const { data: cp, error: cpErr } = await admin
    .from('current_prices')
    .select('ticker, price, previous_close')
    .in('ticker', tickers);
  if (cpErr) throw new Error(`current_prices: ${cpErr.message}`);

  const todays = (cp || []).filter((r) => r.price != null && r.previous_close);
  const todayMoves = todays.map((r) => ({
    ticker: r.ticker,
    pct: ((Number(r.price) - Number(r.previous_close)) / Number(r.previous_close)) * 100,
  }));
  const pct_today = todayMoves.length
    ? todayMoves.reduce((s, m) => s + m.pct, 0) / todayMoves.length
    : null;

  // pct_7d: mean across tickers of (today - 7d-ago)/7d-ago * 100.
  // stock_prices stores per-(alert,date) rows. We fall back to nearest-prior
  // available row if no exact 7-day-ago sample exists.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const { data: spOld, error: spErr } = await admin
    .from('stock_prices')
    .select('alert_id, price, price_date, stock_alerts!inner(ticker)')
    .lte('price_date', sevenDaysAgo)
    .order('price_date', { ascending: false })
    .limit(2000);
  if (spErr) throw new Error(`stock_prices: ${spErr.message}`);

  const sevenAgoByTicker = new Map();
  for (const row of spOld || []) {
    const tkr = row.stock_alerts?.ticker;
    if (!tkr) continue;
    if (!tickers.includes(tkr)) continue;
    if (!sevenAgoByTicker.has(tkr)) sevenAgoByTicker.set(tkr, Number(row.price));
  }

  const cpByTicker = new Map((cp || []).map((r) => [r.ticker, Number(r.price)]));
  const sevenDayMoves = [];
  for (const t of tickers) {
    const old = sevenAgoByTicker.get(t);
    const now = cpByTicker.get(t);
    if (old && now) sevenDayMoves.push((now - old) / old * 100);
  }
  const pct_7d = sevenDayMoves.length
    ? sevenDayMoves.reduce((s, m) => s + m, 0) / sevenDayMoves.length
    : null;

  // Top tickers: 5 biggest absolute |today's move|, with sign retained.
  const top_tickers = todayMoves
    .slice()
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 5)
    .map((m) => ({ ticker: m.ticker, pct_today: Number(m.pct.toFixed(2)) }));

  return { pct_today, pct_7d, top_tickers };
}

// ─────────────────────────────────────────────────────────────
// 4. AI summarisation (Anthropic). Optional — gracefully degrades.
// ─────────────────────────────────────────────────────────────
// If ANTHROPIC_API_KEY is not set we return a deterministic template summary
// rather than failing. That way a fresh deploy without the key still produces
// a valid Sector Pulse, just less rich.
export async function summarizeIndustry({ industry, stats, news, redditPosts }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  // Build a compact, source-cited prompt input.
  const newsLines = news.map((n) => `- "${n.title}" (${n.publisher}, ${n.publishedAt})`).join('\n');
  const redditLines = redditPosts.map((p) => `- r/${p.subreddit}: "${p.title}" (${p.score} upvotes, ${p.comments} comments)`).join('\n');

  if (!apiKey) {
    // Deterministic fallback. Honest about what we have.
    const parts = [];
    if (news.length) parts.push(`${news.length} headline(s) in the last 24h`);
    if (redditPosts.length) parts.push(`${redditPosts.length} qualifying Reddit discussion(s)`);
    if (stats.pct_today != null) parts.push(`group avg ${stats.pct_today >= 0 ? '+' : ''}${stats.pct_today.toFixed(1)}% today`);
    const text = parts.length
      ? `Tracking ${industry}: ${parts.join(', ')}. AI summary unavailable (set ANTHROPIC_API_KEY to enable).`
      : `No qualifying news or social discussion in the past 24 hours.`;
    return {
      summary: text,
      sentiment_label: 'neutral',
      sentiment_score: 0,
      buzz_label: redditPosts.length >= 5 ? 'high' : redditPosts.length >= 2 ? 'medium' : 'low',
      ai_model: 'fallback',
    };
  }

  // Real call. We use Haiku — fast, cheap, sufficient for 2-line summaries.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });

  const systemPrompt = [
    'You write daily macro reads for retail stock investors using ONLY the sources provided.',
    'Rules:',
    '- Use only the headlines and Reddit posts provided. Do NOT add facts from training.',
    '- 2 sentences MAX, plain English, no jargon, no hype.',
    '- If the sources are thin or contradictory, say so plainly.',
    '- Never recommend buying or selling. Just describe what is happening.',
    '- Output strict JSON: {"summary":"...","sentiment":"v_bull|bull|neutral|mixed|bear|v_bear","sentiment_score":-1.0_to_1.0,"buzz":"low|medium|high|v_high"}',
  ].join('\n');

  const userPrompt = [
    `Industry: ${industry}`,
    `Group price action today: ${stats.pct_today != null ? stats.pct_today.toFixed(2) + '%' : 'n/a'}`,
    `Group price action 7d:    ${stats.pct_7d != null ? stats.pct_7d.toFixed(2) + '%' : 'n/a'}`,
    '',
    `Headlines (last 24h, trusted publishers only):`,
    newsLines || '(none)',
    '',
    `Reddit (r/stocks + r/investing, last 24h, ≥50 upvotes only):`,
    redditLines || '(none)',
    '',
    'Produce the JSON object now.',
  ].join('\n');

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const text = resp?.content?.[0]?.text || '';
    // Tolerate code-fenced JSON.
    const cleaned = text.replace(/```(?:json)?/g, '').trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); } catch { parsed = null; }

    if (!parsed?.summary) {
      return {
        summary: 'AI returned an unparseable response. Falling back to neutral read.',
        sentiment_label: 'neutral',
        sentiment_score: 0,
        buzz_label: redditPosts.length >= 5 ? 'high' : redditPosts.length >= 2 ? 'medium' : 'low',
        ai_model: 'claude-haiku-4-5-parse-fail',
      };
    }
    return {
      summary: parsed.summary.slice(0, 600),
      sentiment_label: ['v_bull','bull','neutral','mixed','bear','v_bear'].includes(parsed.sentiment) ? parsed.sentiment : 'neutral',
      sentiment_score: typeof parsed.sentiment_score === 'number'
        ? Math.max(-1, Math.min(1, parsed.sentiment_score))
        : 0,
      buzz_label: ['low','medium','high','v_high'].includes(parsed.buzz) ? parsed.buzz : 'low',
      ai_model: 'claude-haiku-4-5-20251001',
    };
  } catch (e) {
    return {
      summary: `AI summary unavailable: ${e?.message || String(e)}`,
      sentiment_label: 'neutral',
      sentiment_score: 0,
      buzz_label: 'low',
      ai_model: 'claude-haiku-4-5-error',
    };
  }
}

// ─────────────────────────────────────────────────────────────
// 5. Orchestrator: pulse all industries
// ─────────────────────────────────────────────────────────────
const MIN_TICKERS_PER_INDUSTRY = 2;   // need at least 2 cards to call something a "sector"

export async function pulseAllIndustries(admin) {
  // Active tickers ∩ classified tickers.
  const [alertsRes, metaRes] = await Promise.all([
    admin.from('stock_alerts').select('ticker').in('status', ['new','active','dropped']),
    admin.from('ticker_meta').select('ticker, sector, industry, display_name').not('industry', 'is', null),
  ]);
  if (alertsRes.error) throw new Error(`stock_alerts: ${alertsRes.error.message}`);
  if (metaRes.error)   throw new Error(`ticker_meta: ${metaRes.error.message}`);

  const activeSet = new Set((alertsRes.data || []).map((r) => String(r.ticker).toUpperCase()));
  const byIndustry = new Map();
  for (const m of metaRes.data || []) {
    if (!activeSet.has(m.ticker)) continue;
    const key = m.industry;
    if (!byIndustry.has(key)) byIndustry.set(key, { label: m.industry, sector: m.sector, tickers: [] });
    byIndustry.get(key).tickers.push(m.ticker);
  }

  // Pull Reddit ONCE for the day, not per-industry. We then filter posts
  // per-industry by the industry's tickers + name. This is critical to keep
  // Reddit calls under a sane rate (2 calls total instead of 2 × industries).
  const [stocksRes, investingRes] = await Promise.all([
    fetchRedditTop('stocks'),
    fetchRedditTop('investing'),
  ]);
  const allRedditPosts = [
    ...(stocksRes.ok ? stocksRes.posts.map((p) => ({ ...p, subreddit: 'stocks' })) : []),
    ...(investingRes.ok ? investingRes.posts.map((p) => ({ ...p, subreddit: 'investing' })) : []),
  ];

  const inserts = [];
  const errors = [];

  for (const [industry, info] of byIndustry) {
    if (info.tickers.length < MIN_TICKERS_PER_INDUSTRY) continue;

    try {
      // Pull Yahoo news for the top 3 tickers in this industry (by alpha).
      // Limits Yahoo calls to ~3 per industry instead of N.
      const topTickers = info.tickers.slice(0).sort().slice(0, 3);
      const newsResults = [];
      for (const t of topTickers) {
        await sleep(250);
        const r = await fetchYahooNews(t);
        if (r.ok) newsResults.push(...r.items);
      }
      // De-dupe by URL, cap at 8 headlines.
      const seen = new Set();
      const news = [];
      for (const n of newsResults) {
        if (seen.has(n.url)) continue;
        seen.add(n.url);
        news.push(n);
        if (news.length >= 8) break;
      }

      // Reddit: filter to posts mentioning industry name OR any ticker.
      const tokens = [industry, ...info.tickers];
      const redditPosts = allRedditPosts.filter((p) => postMatchesTokens(p, tokens)).slice(0, 8);

      const stats = await computeIndustryStats(admin, industry, info.tickers);
      const ai = await summarizeIndustry({ industry, stats, news, redditPosts });

      inserts.push({
        sector_key: industry.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 96),
        sector_label: industry.slice(0, 96),
        scope: 'industry',
        summary: ai.summary,
        sentiment_label: ai.sentiment_label,
        sentiment_score: ai.sentiment_score,
        news_count: news.length,
        social_count: redditPosts.length,
        buzz_label: ai.buzz_label,
        pct_today: stats.pct_today != null ? Number(stats.pct_today.toFixed(2)) : null,
        pct_7d: stats.pct_7d != null ? Number(stats.pct_7d.toFixed(2)) : null,
        top_tickers: stats.top_tickers,
        sources: {
          yahoo: news.map((n) => n.url),
          reddit: redditPosts.map((p) => p.url),
        },
        ai_model: ai.ai_model,
        last_error: null,
      });
    } catch (e) {
      errors.push({ industry, error: e?.message || String(e) });
      // Still record a row so source_health surfaces the failure.
      inserts.push({
        sector_key: industry.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 96),
        sector_label: industry.slice(0, 96),
        scope: 'industry',
        summary: 'Pulse generation failed; see last_error.',
        last_error: (e?.message || String(e)).slice(0, 500),
        ai_model: 'error',
      });
    }
  }

  // Append-only insert. The view sector_pulse_latest exposes the freshest row.
  let writeError = null;
  if (inserts.length) {
    const { error } = await admin.from('sector_pulse').insert(inserts);
    if (error) writeError = error.message;
  }

  return {
    industries_processed: inserts.length,
    industries_errored: errors.length,
    reddit_stocks_ok: !!stocksRes.ok,
    reddit_investing_ok: !!investingRes.ok,
    write_error: writeError,
    errors,
  };
}
