'use client';
import React, { useState, useEffect, useRef, useCallback, useMemo, createContext, useContext } from 'react';
import { useRouter } from 'next/navigation';
import '../globals.css';
import { SIGNAL_WEIGHTS, SIGNAL_BUCKETS, bucketFor } from '../lib/signalStrength';
import SectorPulseBar from '../components/SectorPulseBar';
import AddStockSheet from '../components/AddStockSheet';
import SwipeToRemove from '../components/SwipeToRemove';
import { Ico } from '../components/Icon';

// ─────────────────────────────────────────────────────────────────────────────
// Stock meta batch fetching.
//
// Historically each stock card fired THREE separate API calls per card
// (analyst / earnings / history). With ~60 cards that's ~180 serverless
// invocations per dashboard load — the main driver of our Vercel CPU usage.
//
// We now batch-fetch everything through /api/stock-meta once per load and
// publish the result via a React context. The three card components still
// render exactly the same data; they just read it from context instead of
// each firing their own fetch. If a ticker is missing from the batch
// response (edge case), the components transparently fall back to the
// original per-ticker endpoints.
// ─────────────────────────────────────────────────────────────────────────────
const StockMetaCtx = createContext({ meta: null, loading: false });

function StockMetaProvider({ tickers, children }) {
  const [state, setState] = useState({ meta: null, loading: false });
  // Stable join key so we only re-fetch when the ticker set actually changes.
  const tickerKey = useMemo(
    () => [...new Set((tickers || []).map(t => String(t || '').toUpperCase()).filter(Boolean))].sort().join(','),
    [tickers]
  );

  useEffect(() => {
    if (!tickerKey) { setState({ meta: {}, loading: false }); return; }
    let cancelled = false;
    setState(s => ({ meta: s.meta, loading: true }));
    fetch('/api/stock-meta', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tickers: tickerKey.split(',') }),
    })
      .then(res => res.ok ? res.json() : Promise.reject(new Error(`stock-meta ${res.status}`)))
      .then(data => { if (!cancelled) setState({ meta: data?.meta || {}, loading: false }); })
      .catch(() => { if (!cancelled) setState({ meta: {}, loading: false }); });
    return () => { cancelled = true; };
  }, [tickerKey]);

  return <StockMetaCtx.Provider value={state}>{children}</StockMetaCtx.Provider>;
}

// Returns { data, loading, fromBatch }. `fromBatch=true` means we have the
// batched data and the component should NOT fire an individual fetch.
function useStockMetaEntry(ticker, kind) {
  const ctx = useContext(StockMetaCtx);
  if (!ticker) return { data: null, loading: false, fromBatch: false };
  const upper = String(ticker).toUpperCase();
  if (!ctx.meta) return { data: null, loading: ctx.loading, fromBatch: false };
  const entry = ctx.meta[upper];
  if (entry && entry[kind] !== undefined) {
    return { data: entry[kind], loading: false, fromBatch: true };
  }
  // Batch has loaded but this ticker wasn't included — fall through to
  // individual fetch in the consuming component.
  return { data: null, loading: ctx.loading, fromBatch: false };
}

// ── Signal Strength Bars (wifi-style) ──
function SignalBars({ score, subScores, sourceCount, mentionCount }) {
  const s = Math.max(0, Math.min(100, Math.round(score || 0)));
  const bucket = bucketFor(s);
  const cls =
    bucket.bars === 4 ? 'ss-very-strong' :
    bucket.bars === 3 ? 'ss-strong' :
    bucket.bars === 2 ? 'ss-moderate' : 'ss-weak';

  return (
    <div
      className={`signal-bars-wrap ${cls}`}
      style={{ '--signal-color': bucket.color }}
      title={`Signal strength: ${bucket.label} (${s}/100)`}
    >
      <span className="signal-bars">
        {[1, 2, 3, 4].map(n => (
          <span key={n} className={`bar b${n}${n <= bucket.bars ? ' on' : ''}`} />
        ))}
      </span>
      <span className="signal-bars-label">{bucket.label}</span>
      <span className="signal-bars-score">{s}/100</span>
      <div className="signal-bars-tooltip">
        <div className="tt-title">{"\u{1F4F6}"} {bucket.label} — {s}/100</div>
        <div className="tt-row"><span>Unique sources</span><span>{sourceCount ?? '\u{2014}'}</span></div>
        <div className="tt-row"><span>Total mentions</span><span>{mentionCount ?? '\u{2014}'}</span></div>
        {subScores && (
          <>
            <div className="tt-row"><span>Source score (30%)</span><span>{subScores.source}/100</span></div>
            <div className="tt-row"><span>Mention score (25%)</span><span>{subScores.mention}/100</span></div>
            <div className="tt-row"><span>Momentum timing (25%)</span><span>{subScores.velocity}/100</span></div>
            <div className="tt-row"><span>Sentiment score (20%)</span><span>{subScores.sentiment}/100</span></div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Helpers ──
function getStatus(pct) {
  if (pct > 10) return 'win';
  if (pct < -10) return 'loss';
  return 'neutral';
}
function statusLabel(pct) {
  const s = getStatus(pct);
  if (s === 'win') return '\u{2705} WIN';
  if (s === 'loss') return '\u{274C} LOSS';
  return '\u{26A0}\u{FE0F} NEUTRAL';
}
function pctClass(pct) {
  if (pct > 0) return 'pct-pos';
  if (pct < 0) return 'pct-neg';
  return 'pct-flat';
}
function fmtPct(pct) {
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
}
// Recommendation chip labels. The .rec-{buy|sell|trim|exit|hold} CSS class
// already color-codes the chip (green BUY, red SELL, etc.) so we don't need
// redundant colored-dot emojis — Robinhood-style restraint. TRIM/EXIT get a
// small Lucide glyph for at-a-glance differentiation since they share neutral
// (amber) coloring.
function recLabel(rec) {
  if (rec === 'TRIM') return <><Ico name="scissors" size={11} /> TRIM</>;
  if (rec === 'EXIT') return <><Ico name="flag" size={11} /> EXIT</>;
  if (rec === 'RIDING') return <><Ico name="flame" size={11} /> RIDING</>;
  return rec; // BUY / SELL / HOLD — color says it all
}
function recClass(rec) {
  if (rec === 'BUY')  return 'rec-buy';
  if (rec === 'SELL') return 'rec-sell';
  if (rec === 'TRIM') return 'rec-trim';
  if (rec === 'EXIT') return 'rec-exit';
  if (rec === 'RIDING') return 'rec-riding';
  return 'rec-hold';
}

// ── Source helpers ──
// `icon` is the name passed to <Ico name=…/> (Lucide thin-outline icon registry
// in components/Icon.js). Replaced colored emoji dots 2026-05-13 to match the
// Robinhood design language: monochrome, geometric, premium.
const SOURCE_META = {
  wsb: { label: 'WallStreetBets', icon: 'chat', cls: 'src-wsb' },
  reddit: { label: 'Reddit', icon: 'chat', cls: 'src-reddit' },
  reddit_biotech: { label: 'r/biotechplays', icon: 'dna', cls: 'src-reddit-biotech' },
  reddit_shortsqueeze: { label: 'r/Shortsqueeze', icon: 'trend', cls: 'src-reddit-squeeze' },
  reddit_vitards: { label: 'r/Vitards', icon: 'cog', cls: 'src-reddit-vitards' },
  apewisdom: { label: 'ApeWisdom', icon: 'activity', cls: 'src-ape' },
  polymarket: { label: 'Polymarket', icon: 'target', cls: 'src-poly' },
  kalshi: { label: 'Kalshi', icon: 'globe', cls: 'src-kalshi' },
  yahoo: { label: 'Yahoo Finance', icon: 'bar', cls: 'src-yahoo' },
  yahoo_premarket: { label: 'Yahoo Pre-market', icon: 'sunrise', cls: 'src-yahoo-pm' },
  sec_edgar: { label: 'SEC 8-K', icon: 'file', cls: 'src-sec' },
  sec_form4: { label: 'Insider Buy', icon: 'dollar', cls: 'src-insider' },
  biopharmcatalyst: { label: 'FDA Catalyst', icon: 'pill', cls: 'src-fda' },
  nasdaq_halt: { label: 'NASDAQ Halt', icon: 'warning', cls: 'src-halt' },
  google: { label: 'Google Finance', icon: 'search', cls: 'src-google' },
  stocktwits: { label: 'StockTwits', icon: 'chat', cls: 'src-st' },
  unknown: { label: 'Unknown', icon: 'eye', cls: 'src-unknown' },
};
function getSourceMeta(source) {
  if (!source) return SOURCE_META.unknown;
  const key = source.toLowerCase().replace(/\s+/g, '');
  // More specific matches first
  if (key.includes('yahoo_premarket') || key.includes('yahoopm') || key.includes('yahoopremarket')) return SOURCE_META.yahoo_premarket;
  // sec_form4 must be checked BEFORE sec_edgar (otherwise 'sec_' substring grabs it)
  if (key.includes('sec_form4') || key.includes('form4') || key.includes('insider')) return SOURCE_META.sec_form4;
  if (key.includes('sec_edgar') || key.includes('secedgar') || key.includes('sec8k')) return SOURCE_META.sec_edgar;
  if (key.includes('biopharm') || key.includes('fda') || key.includes('catalystalert')) return SOURCE_META.biopharmcatalyst;
  if (key.includes('apewisdom') || key.includes('apewis')) return SOURCE_META.apewisdom;
  if (key.includes('nasdaq_halt') || key.includes('halt')) return SOURCE_META.nasdaq_halt;
  if (key.includes('wsb') || key.includes('wallstreetbets')) return SOURCE_META.wsb;
  // Niche reddit subs — check before generic 'reddit' fallthrough
  if (key.includes('reddit_biotech') || key.includes('biotechplays')) return SOURCE_META.reddit_biotech;
  if (key.includes('reddit_shortsqueeze') || key.includes('shortsqueeze')) return SOURCE_META.reddit_shortsqueeze;
  if (key.includes('reddit_vitards') || key.includes('vitards')) return SOURCE_META.reddit_vitards;
  if (key.includes('reddit')) return SOURCE_META.reddit;
  if (key.includes('poly')) return SOURCE_META.polymarket;
  if (key.includes('kalshi')) return SOURCE_META.kalshi;
  if (key.includes('yahoo')) return SOURCE_META.yahoo;
  if (key.includes('google')) return SOURCE_META.google;
  if (key.includes('stocktwit')) return SOURCE_META.stocktwits;
  return SOURCE_META[key] || SOURCE_META.unknown;
}

// ── Cookie helpers for watchlist ──
function getWatchlist() {
  if (typeof document === 'undefined') return [];
  const match = document.cookie.match(/(?:^|; )stock_watchlist=([^;]*)/);
  if (!match) return [];
  try { return JSON.parse(decodeURIComponent(match[1])); } catch { return []; }
}
function setWatchlist(list) {
  const val = encodeURIComponent(JSON.stringify(list));
  document.cookie = `stock_watchlist=${val}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}
function toggleWatchlist(ticker) {
  const list = getWatchlist();
  const idx = list.indexOf(ticker);
  if (idx >= 0) { list.splice(idx, 1); } else { list.push(ticker); }
  setWatchlist(list);
  return list;
}

// ── Cookie helpers for market cap filter ──
function getMarketCapFilter() {
  if (typeof document === 'undefined') return [0, 5000];
  const match = document.cookie.match(/(?:^|; )stock_mcap_filter=([^;]*)/);
  if (!match) return [0, 5000];
  try { return JSON.parse(decodeURIComponent(match[1])); } catch { return [0, 5000]; }
}
function setMarketCapFilter(range) {
  const val = encodeURIComponent(JSON.stringify(range));
  document.cookie = `stock_mcap_filter=${val}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

// ── Cookie helpers for the card sort-by control ──
// Lets the dashboard remember how the user wants cards ordered across
// sessions. Default 'strength' preserves the original strongest-first sort.
const SORT_MODES = ['strength', 'updated', 'newest', 'oldest', 'best', 'worst'];
function getSortMode() {
  if (typeof document === 'undefined') return 'strength';
  const match = document.cookie.match(/(?:^|; )stock_sort_mode=([^;]*)/);
  if (!match) return 'strength';
  const val = decodeURIComponent(match[1]);
  return SORT_MODES.includes(val) ? val : 'strength';
}
function setSortModeCookie(mode) {
  document.cookie = `stock_sort_mode=${encodeURIComponent(mode)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
}

// lastActivityMs — the "last updated" timestamp for a pick. Mirrors the
// AlertCard's own lastChatterMs logic so the sort order and the on-card
// "Updated" badge always agree: MAX of last_updated, last_resignal_at, the
// newest signal_change entry, and alert_date as a floor fallback.
function lastActivityMs(alert) {
  const cands = [];
  if (alert.last_updated) {
    const t = new Date(alert.last_updated).getTime();
    if (!Number.isNaN(t)) cands.push(t);
  }
  if (alert.last_resignal_at) {
    const t = new Date(alert.last_resignal_at).getTime();
    if (!Number.isNaN(t)) cands.push(t);
  }
  if (Array.isArray(alert.signal_change_history)) {
    for (const sc of alert.signal_change_history) {
      const ts = new Date(sc?.change_date || sc?.created_at || 0).getTime();
      if (!Number.isNaN(ts) && ts > 0) cands.push(ts);
    }
  }
  if (alert.latest_signal_change) {
    const ts = new Date(alert.latest_signal_change.change_date || alert.latest_signal_change.created_at || 0).getTime();
    if (!Number.isNaN(ts) && ts > 0) cands.push(ts);
  }
  if (alert.alert_date) {
    const ts = new Date(alert.alert_date + 'T00:00:00').getTime();
    if (!Number.isNaN(ts) && ts > 0) cands.push(ts);
  }
  return cands.length ? Math.max(...cands) : 0;
}

// Short "2d ago" / "today" style relative-time label for the card date badge.
function relTimeLabel(ms) {
  if (!ms) return null;
  const diffDays = Math.floor((Date.now() - ms) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays === 1) return '1d ago';
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

// ── Reddit link builder ──
function getRedditLinks(ticker) {
  return [
    { label: 'r/wallstreetbets', url: `https://www.reddit.com/r/wallstreetbets/search/?q=${ticker}&restrict_sr=1&sort=new` },
    { label: 'r/stocks', url: `https://www.reddit.com/r/stocks/search/?q=${ticker}&restrict_sr=1&sort=new` },
    { label: 'r/investing', url: `https://www.reddit.com/r/investing/search/?q=${ticker}&restrict_sr=1&sort=new` },
    { label: 'r/options', url: `https://www.reddit.com/r/options/search/?q=${ticker}&restrict_sr=1&sort=new` },
    { label: 'r/StockMarket', url: `https://www.reddit.com/r/StockMarket/search/?q=${ticker}&restrict_sr=1&sort=new` },
  ];
}

// ── Analyst Badge Component ──
// Prefers batched data from StockMetaCtx; falls back to /api/analyst only if
// this ticker wasn't part of the batch response (shouldn't normally happen).
function AnalystBadge({ ticker }) {
  const batched = useStockMetaEntry(ticker, 'analyst');
  const [fallback, setFallback] = useState(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  useEffect(() => {
    if (batched.fromBatch) return;   // batch already has the data
    if (batched.loading) return;     // batch still in flight — wait
    // Batch finished without this ticker — individual fallback.
    let cancelled = false;
    setFallbackLoading(true);
    fetch(`/api/analyst?ticker=${encodeURIComponent(ticker)}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(d => { if (!cancelled) { setFallback(d); setFallbackLoading(false); } })
      .catch(() => { if (!cancelled) setFallbackLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, batched.fromBatch, batched.loading]);

  const data = batched.data ?? fallback;
  const loading = batched.fromBatch ? false : (batched.loading || fallbackLoading);

  if (loading) return <div className="analyst-badge analyst-loading">Loading analyst data...</div>;
  if (!data || (!data.recommendationKey && !data.averageRating)) return null;

  const key = data.recommendationKey || '';
  const isBullish = ['strong_buy', 'buy'].includes(key);
  const isBearish = ['sell', 'underperform'].includes(key);
  const colorClass = isBullish ? 'analyst-bullish' : isBearish ? 'analyst-bearish' : 'analyst-neutral';

  return (
    <div className={`analyst-badge ${colorClass}`}>
      <div className="analyst-header">
        <span className="analyst-icon">{"\u{1F4CA}"}</span>
        <span className="analyst-title">Analyst Consensus</span>
      </div>
      <div className="analyst-rating">
        {data.averageRating || key.replace('_', ' ').toUpperCase()}
      </div>
      {data.numberOfAnalysts > 0 && (
        <div className="analyst-count">{data.numberOfAnalysts} analyst{data.numberOfAnalysts !== 1 ? 's' : ''}</div>
      )}
      {data.targetMeanPrice && (
        <div className="analyst-target">
          Target: <strong>${data.targetMeanPrice.toFixed(2)}</strong>
          {data.targetLowPrice && data.targetHighPrice && (
            <span className="analyst-range"> (${data.targetLowPrice.toFixed(2)} {"\u{2013}"} ${data.targetHighPrice.toFixed(2)})</span>
          )}
        </div>
      )}
      {data.breakdown && (
        <div className="analyst-breakdown">
          {data.breakdown.strongBuy > 0 && <span className="ab-strong-buy">{data.breakdown.strongBuy} Strong Buy</span>}
          {data.breakdown.buy > 0 && <span className="ab-buy">{data.breakdown.buy} Buy</span>}
          {data.breakdown.hold > 0 && <span className="ab-hold">{data.breakdown.hold} Hold</span>}
          {data.breakdown.sell > 0 && <span className="ab-sell">{data.breakdown.sell} Sell</span>}
          {data.breakdown.strongSell > 0 && <span className="ab-strong-sell">{data.breakdown.strongSell} Strong Sell</span>}
        </div>
      )}
    </div>
  );
}

// ── Profit/Loss Calculator Component ──
function ProfitLossCalc({ priceAtAlert, latestPrice }) {
  const [amount, setAmount] = useState('');
  const [showCalc, setShowCalc] = useState(false);

  if (!latestPrice || !priceAtAlert) return null;

  const investedAmount = parseFloat(amount);
  const shares = investedAmount / parseFloat(priceAtAlert);
  const currentValue = shares * latestPrice;
  const profitLoss = currentValue - investedAmount;
  const profitLossPct = ((currentValue - investedAmount) / investedAmount) * 100;
  const isValid = !isNaN(investedAmount) && investedAmount > 0;

  return (
    <div className="calc-section">
      <button className="calc-toggle" onClick={() => setShowCalc(!showCalc)}>
        {showCalc ? '\u{25BE}' : '\u{25B8}'} {"\u{1F4B0}"} What-If Calculator
      </button>
      {showCalc && (
        <div className="calc-body">
          <div className="calc-input-row">
            <span className="calc-dollar">$</span>
            <input
              type="number"
              className="calc-input"
              placeholder="Enter amount..."
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
              step="100"
            />
          </div>
          {isValid && (
            <div className="calc-results">
              <div className="calc-row">
                <span>Shares bought:</span>
                <span className="calc-val">{shares.toFixed(2)}</span>
              </div>
              <div className="calc-row">
                <span>Current value:</span>
                <span className="calc-val">${currentValue.toFixed(2)}</span>
              </div>
              <div className={`calc-row calc-pl ${profitLoss >= 0 ? 'calc-profit' : 'calc-loss'}`}>
                <span>{profitLoss >= 0 ? 'Profit' : 'Loss'}:</span>
                <span className="calc-val-big">
                  {profitLoss >= 0 ? '+' : ''}${profitLoss.toFixed(2)} ({profitLossPct >= 0 ? '+' : ''}{profitLossPct.toFixed(1)}%)
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Reddit Links Component ──
function RedditLinks({ ticker }) {
  const [showLinks, setShowLinks] = useState(false);
  const links = getRedditLinks(ticker);

  return (
    <div className="reddit-section">
      <button className="reddit-toggle" onClick={() => setShowLinks(!showLinks)}>
        {showLinks ? '\u{25BE}' : '\u{25B8}'} {"\u{1F517}"} Reddit Discussions
      </button>
      {showLinks && (
        <div className="reddit-links">
          {links.map(link => (
            <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer" className="reddit-link">
              {link.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── News Headlines (foldable, last 7 days) ──
function NewsHeadlines({ ticker }) {
  const [news, setNews] = useState(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || news !== null) return;
    let cancelled = false;
    setLoading(true);
    fetch(`/api/news?ticker=${encodeURIComponent(ticker)}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(d => { if (!cancelled) { setNews(d.news || []); setLoading(false); } })
      .catch(() => { if (!cancelled) { setNews([]); setLoading(false); } });
    return () => { cancelled = true; };
  }, [ticker, open, news]);

  return (
    <div className="news-section">
      <button className="news-toggle" onClick={() => setOpen(!open)}>
        {open ? '\u25BE' : '\u25B8'} {"\uD83D\uDCF0"} News Headlines (7d)
      </button>
      {open && (
        <div className="news-body">
          {loading && <div className="news-loading">Loading news...</div>}
          {!loading && news && news.length === 0 && (
            <div className="news-empty">No recent news found</div>
          )}
          {!loading && news && news.length > 0 && (
            <div className="news-list">
              {news.map((item, i) => {
                const dateStr = item.publishedAt
                  ? new Date(item.publishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                  : '';
                return (
                  <a key={i} href={item.link} target="_blank" rel="noopener noreferrer" className="news-item">
                    <span className="news-title">{item.title}</span>
                    <span className="news-meta">
                      {item.publisher && <span className="news-publisher">{item.publisher}</span>}
                      {dateStr && <span className="news-date">{dateStr}</span>}
                    </span>
                  </a>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Next Earnings Date ──
// Prefers batched data; falls back to /api/earnings if ticker missing from batch.
function EarningsDate({ ticker }) {
  const batched = useStockMetaEntry(ticker, 'earnings');
  const [fallback, setFallback] = useState(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  useEffect(() => {
    if (batched.fromBatch) return;
    if (batched.loading) return;
    let cancelled = false;
    setFallbackLoading(true);
    fetch(`/api/earnings?ticker=${encodeURIComponent(ticker)}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(d => { if (!cancelled) { setFallback(d); setFallbackLoading(false); } })
      .catch(() => { if (!cancelled) setFallbackLoading(false); });
    return () => { cancelled = true; };
  }, [ticker, batched.fromBatch, batched.loading]);

  const data = batched.data ?? fallback;
  const loading = batched.fromBatch ? false : (batched.loading || fallbackLoading);

  if (loading || !data || !data.earningsDate) return null;

  const days = data.daysUntilEarnings;
  const isPast = days !== null && days < 0;
  const isSoon = days !== null && days >= 0 && days <= 7;

  return (
    <div className={`earnings-badge ${isSoon ? 'earnings-soon' : ''} ${isPast ? 'earnings-past' : ''}`}>
      <span className="earnings-icon">{"\uD83D\uDCC5"}</span>
      <span className="earnings-label">Next Earnings:</span>
      <span className="earnings-value">
        {data.earningsDateFormatted}
        {data.earningsDateEnd && data.earningsDateEnd !== data.earningsDate && (
          <> {"\u2013"} {data.earningsDateEndFormatted}</>
        )}
      </span>
      {days !== null && !isPast && (
        <span className={`earnings-countdown ${isSoon ? 'earnings-countdown-soon' : ''}`}>
          ({days === 0 ? 'Today' : `${days}d away`})
        </span>
      )}
      {isPast && (
        <span className="earnings-countdown earnings-countdown-past">
          (Passed)
        </span>
      )}
    </div>
  );
}

// ── Historic Chart ──
// Prefers batched history data; falls back to /api/history if ticker missing.
function HistoricChart({ ticker, canvasId }) {
  const canvasRef = useRef(null);
  const batched = useStockMetaEntry(ticker, 'history');
  const [fallback, setFallback] = useState(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);
  const [fallbackError, setFallbackError] = useState(false);

  useEffect(() => {
    if (batched.fromBatch) return;
    if (batched.loading) return;
    let cancelled = false;
    setFallbackLoading(true);
    fetch(`/api/history?ticker=${encodeURIComponent(ticker)}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => { if (!cancelled) { setFallback(data); setFallbackLoading(false); } })
      .catch(() => { if (!cancelled) { setFallbackError(true); setFallbackLoading(false); } });
    return () => { cancelled = true; };
  }, [ticker, batched.fromBatch, batched.loading]);

  // Treat a batched history with an `error` field as a failure signal.
  const batchedError = batched.fromBatch && batched.data && batched.data.error;
  const histData = batchedError ? null : (batched.data ?? fallback);
  const loading = batched.fromBatch ? false : (batched.loading || fallbackLoading);
  const error = batchedError || fallbackError;

  useEffect(() => {
    if (!canvasRef.current || !window.Chart || !histData?.prices?.length) return;
    const ctx = canvasRef.current;
    const priceValues = histData.prices.map(p => p.price);
    const labels = histData.prices.map(p => {
      const d = new Date(p.date);
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    });
    const isUp = priceValues[priceValues.length - 1] >= priceValues[0];
    const minPrice = Math.min(...priceValues);
    const maxPrice = Math.max(...priceValues);
    const padding = (maxPrice - minPrice) * 0.1;

    const chart = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: priceValues,
          borderColor: isUp ? '#22c55e' : '#ef4444',
          backgroundColor: isUp ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
          borderWidth: 1.5,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: true, mode: 'index', intersect: false,
            backgroundColor: '#0f1d30', borderColor: '#1e3a5f', borderWidth: 1,
            titleColor: '#7a9bc0', bodyColor: '#e0e6f0',
            titleFont: { size: 10 }, bodyFont: { size: 11, weight: 'bold' },
            padding: 8, displayColors: false,
            callbacks: { label: (ctx) => `$${ctx.parsed.y.toFixed(2)}` },
          },
        },
        scales: {
          x: {
            display: true,
            ticks: { color: '#3a5a78', font: { size: 9 }, maxTicksLimit: 5, maxRotation: 0 },
            grid: { display: false }, border: { display: false },
          },
          y: {
            display: true, position: 'right', min: minPrice - padding, max: maxPrice + padding,
            ticks: { color: '#3a5a78', font: { size: 9 }, maxTicksLimit: 4, callback: (val) => '$' + val.toFixed(0) },
            grid: { color: 'rgba(30,58,95,0.3)', drawTicks: false }, border: { display: false },
          },
        },
        interaction: { mode: 'index', intersect: false },
      },
    });
    return () => chart.destroy();
  }, [histData]);

  if (error) return null;
  if (loading) {
    return (
      <div className="historic-chart-section">
        <div className="historic-label">{"\u{1F4CA}"} 3-Month History</div>
        <div className="historic-loading">Loading chart...</div>
      </div>
    );
  }
  if (!histData?.prices?.length) return null;

  const changeColor = histData.change3mo >= 0 ? '#22c55e' : '#ef4444';
  const changeSign = histData.change3mo >= 0 ? '+' : '';

  return (
    <div className="historic-chart-section">
      <div className="historic-header">
        <span className="historic-label">{"\u{1F4CA}"} 3-Month History</span>
        <span className="historic-change" style={{ color: changeColor }}>
          {changeSign}{histData.change3mo?.toFixed(1)}%
        </span>
      </div>
      <div className="historic-prices-range">
        <span>${histData.startPrice?.toFixed(2)}</span>
        <span className="historic-arrow">{"\u{2192}"}</span>
        <span>${histData.endPrice?.toFixed(2)}</span>
      </div>
      <div className="historic-chart-container">
        <canvas ref={canvasRef} id={canvasId}></canvas>
      </div>
    </div>
  );
}

// ── Sparkline ──
function SparklineChart({ prices, canvasId }) {
  const canvasRef = useRef(null);
  useEffect(() => {
    if (!canvasRef.current || !window.Chart || prices.length < 2) return;
    const ctx = canvasRef.current;
    const priceValues = prices.map(p => p.price);
    const labels = prices.map(p => p.date?.slice(5) || '');
    const isUp = priceValues[priceValues.length - 1] >= priceValues[0];
    const chart = new window.Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          data: priceValues,
          borderColor: isUp ? '#22c55e' : '#ef4444',
          backgroundColor: isUp ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
          borderWidth: 2, pointRadius: 0, tension: 0.3, fill: true,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: { x: { display: false }, y: { display: false } },
      },
    });
    return () => chart.destroy();
  }, [prices]);

  if (prices.length < 2) return null;
  return (
    <div className="sparkline-container">
      <canvas ref={canvasRef} className="sparkline-canvas" id={canvasId}></canvas>
    </div>
  );
}

// ── Rating Buttons Component ──
function RatingButtons({ alertId, currentRating, onRate }) {
  // Single "Not for me" action. Tapping 👎 marks the pick as a bad one
  // (writes to user_ratings) AND dismisses it from the user's feed in
  // one gesture. The dismiss is handled inside the parent's handleRate.
  // We dropped the thumbs-up because users already express positive
  // intent by tapping "+ Track" on a card — adding a stock IS the upvote.
  return (
    <div className="rating-buttons">
      <button
        className={`rating-btn rating-down ${currentRating === 'down' ? 'active' : ''}`}
        onClick={() => onRate(alertId, currentRating === 'down' ? null : 'down')}
        title="Not for me — hide this card and tell the AI"
        aria-label="Not for me"
      >
        {"\u{1F44E}"}
      </button>
    </div>
  );
}

// ── Alert Card ──
// Redesigned card layout (Apr 2026). Key structure:
//   HEADER: status dot · ticker · live price · live % change · signal bars · dismiss (×)
//           company · market-hours dot · ET time
//   HERO:   AI recommendation chip (BUY/HOLD/TRIM/EXIT/SELL) · since-alert % · days-ago
//   BADGES: WSB (↑/↓) · Polymarket · market cap · volume spike · earnings
//   PLAN:   Entry zone · Take profit (🎯) · Stop loss
//   AI READ: one-line plain-English rationale
//   52-WEEK BAR · 3-month chart · alert reason · analyst · signal change · notes
// Fields that come from the AI/daily-job (entry/target/stop/ai_read/volume_ratio/
// week52/wsb_trend/TRIM/EXIT) gracefully hide if null so the card always renders.
// Robinhood-style audit trail of every time the daily scan flagged this
// ticker. Collapsed by default (just shows count + chevron); tap to expand
// to a 5-row list of date / source / one-line reason. Mobile-first: full
// width tap target, 44px row height.
function SignalHistoryAccordion({ entries, totalCount }) {
  const [open, setOpen] = useState(false);
  if (!entries || entries.length === 0) return null;
  const fmtDate = (s) => {
    if (!s) return '';
    const d = new Date(s + 'T00:00:00');
    if (Number.isNaN(d.getTime())) return s;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const yest  = new Date(today.getTime() - 86400000);
    if (d.getTime() === today.getTime()) return 'Today';
    if (d.getTime() === yest.getTime())  return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };
  return (
    <div className={`ac-sig-history${open ? ' open' : ''}`}>
      <button
        type="button"
        className="ac-sig-history-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="ac-sig-history-lbl">
          Signal history <span className="ac-sig-history-count">({totalCount})</span>
        </span>
        <span className="ac-sig-history-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <ul className="ac-sig-history-list">
          {entries.map((e, i) => (
            <li key={i} className="ac-sig-history-row">
              <span className="ac-sig-history-date">{fmtDate(e?.date)}</span>
              {e?.source && (
                <span className="ac-sig-history-src">{e.source}</span>
              )}
              <span className="ac-sig-history-note">
                {e?.ai_read || e?.signal_type || '—'}
                {typeof e?.score === 'number' && (
                  <span className="ac-sig-history-score"> · score {Math.round(e.score)}</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Search result row (2026-05-12) ──
// Compact, mobile-first row used in the unified-search dropdown. Mirrors
// the visual language of AlertCard (Buy/Hold/Trim/Exit colour dot, live
// price, rec mini-chip) but at a single-line cadence so the dropdown
// surfaces 10+ matches without scrolling.
function SearchResultRow({ alert, sharedPrices, tracked, onTap }) {
  const ticker = String(alert.ticker || '').toUpperCase();
  const rec = (alert.recommendation || 'HOLD').toUpperCase();
  const live = sharedPrices?.[ticker]?.price;
  const prevClose = sharedPrices?.[ticker]?.previous_close;
  const todayPct = (live != null && prevClose != null && prevClose > 0)
    ? ((live - prevClose) / prevClose) * 100
    : null;
  return (
    <button
      type="button"
      className={`search-result-row ${tracked ? 'is-tracked' : ''}`}
      onClick={onTap}
      onMouseDown={(e) => e.preventDefault()}  // keep input focus until click fires
      role="option"
    >
      <span
        className={`search-result-dot ${tracked ? `dot-${recClass(rec)}` : 'dot-untracked'}`}
        aria-hidden="true"
      />
      <span className="search-result-ticker">{ticker}</span>
      <span className="search-result-company">{alert.company || ''}</span>
      <span className="search-result-right">
        {live != null && (
          <span className="search-result-price">${Number(live).toFixed(2)}</span>
        )}
        {todayPct != null && (
          <span className={`search-result-pct ${todayPct >= 0 ? 'pos' : 'neg'}`}>
            {todayPct >= 0 ? '+' : ''}{todayPct.toFixed(1)}%
          </span>
        )}
        <span className="search-result-chev" aria-hidden="true">›</span>
      </span>
    </button>
  );
}

function AlertCard({
  alert, index, sectionPrefix, watchlist, sharedPrices,
  forceCompact, forceCompactNonce,
  onToggleWatchlist, onRate, onDismiss, onSaveNote,
  userNote, openPosition, onOpenBuyModal, onOpenSellModal,
  // Optional ticker meta for the new Sector Pulse feature. Always falls back
  // to null so legacy callers that don't pass it keep working unchanged.
  tickerMeta,
  // NEW (Phase 5): handler for the "+ Track this stock" button. Opens the
  // unified AddStockSheet pre-filled with this card's ticker + AI data.
  // Optional — if not provided, the button falls back to legacy watchlist toggle.
  onOpenAddSheet,
  // NEW: server-side watchlist (Supabase) — used to determine if THIS card's
  // ticker is already in the user's watchlist (drives the + Track button state).
  serverWatchlist
}) {
  const [compact, setCompact] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState(userNote || '');
  const [sigHistOpen, setSigHistOpen] = useState(false);

  useEffect(() => { setNoteDraft(userNote || ''); }, [userNote]);

  // Sync with parent-driven collapse-all/expand-all toggle. The nonce bumps
  // every time the user clicks the page-level button, guaranteeing this
  // effect re-fires even if the target state equals the previous one — and
  // overriding any intermediate per-card toggles.
  useEffect(() => {
    if (forceCompactNonce && (forceCompact === true || forceCompact === false)) {
      setCompact(forceCompact);
    }
  }, [forceCompact, forceCompactNonce]);

  // Price resolution — prefer the shared current_prices map (single source
  // of truth, fresh for every ticker including dropped ones). Fall back to
  // the per-user stock_prices history; if that's also empty, fall back to
  // the alert's entry price so the header never goes blank.
  // Matches the pattern used by Portfolio/Leaderboard.
  const lastHist = alert.prices[alert.prices.length - 1];
  const sharedRow = sharedPrices?.[alert.ticker];
  const sharedLive = sharedRow?.price;
  const sharedPrevClose = sharedRow?.previous_close;

  // Extended-hours data — Robinhood-style "AH $X.XX  ±Y%" chip below the
  // main price. Prefer post-market when both are present; whichever has
  // the more recent timestamp wins. /api/prices already strips data older
  // than 6 hours, so anything we see here is "fresh enough to display".
  const postT = sharedRow?.post_market_time ? new Date(sharedRow.post_market_time).getTime() : 0;
  const preT  = sharedRow?.pre_market_time  ? new Date(sharedRow.pre_market_time).getTime()  : 0;
  let extLabel = null, extPrice = null, extPct = null;
  if (sharedRow?.post_market_price != null && postT >= preT) {
    extLabel = 'After Hours';
    extPrice = sharedRow.post_market_price;
    extPct   = sharedRow.post_market_change_pct;
  } else if (sharedRow?.pre_market_price != null) {
    extLabel = 'Pre-Market';
    extPrice = sharedRow.pre_market_price;
    extPct   = sharedRow.pre_market_change_pct;
  }
  const price = (sharedLive != null && !Number.isNaN(sharedLive))
    ? sharedLive
    : (lastHist?.price ?? (alert.price_at_alert != null ? parseFloat(alert.price_at_alert) : null));
  const entryPrice = alert.price_at_alert != null ? parseFloat(alert.price_at_alert) : null;
  // Recompute pct vs entry when we're showing the shared live price — the
  // stored pct_change is tied to the per-user history snapshot and can be
  // stale (or zero) if that row didn't update.
  const pct = (price != null && entryPrice != null && entryPrice > 0)
    ? ((price - entryPrice) / entryPrice) * 100
    : (lastHist?.pct_change || 0);
  // Today's % (day-over-day vs. the prior session's close). Null when the
  // daily job hasn't written previous_close yet — the UI hides the chip in
  // that case rather than showing a misleading zero.
  const todayPct = (price != null && sharedPrevClose != null && sharedPrevClose > 0)
    ? ((price - sharedPrevClose) / sharedPrevClose) * 100
    : null;
  const latest = lastHist; // kept for downstream code that uses the full history row
  const isNew = alert.status === 'new';
  const isDropped = alert.status === 'dropped';
  const isWatched = watchlist.includes(alert.ticker);

  // Re-signal — a stock that was already in the user's stock_alerts as
  // active/new and got re-detected by the daily scan within RESIGNAL_WINDOW_HOURS.
  // Triggers the orange "Fresh signal" chip + the Signal History accordion.
  // Write side: SKILL.md Section 3.95.
  const RESIGNAL_WINDOW_MS = 18 * 60 * 60 * 1000;
  const isFreshSignal = !!(
    alert.last_resignal_at &&
    (Date.now() - new Date(alert.last_resignal_at).getTime()) < RESIGNAL_WINDOW_MS
  );
  const signalHistory = Array.isArray(alert.signal_history) ? alert.signal_history : [];
  const visibleSignalHistory = signalHistory.slice(-5).reverse(); // newest first, cap 5
  const resignalCountThisWeek = signalHistory.filter(s => {
    if (!s?.date) return false;
    const t = new Date(s.date + 'T00:00:00').getTime();
    return !Number.isNaN(t) && t >= Date.now() - 7 * 24 * 60 * 60 * 1000;
  }).length;
  const freshSignalLabel = resignalCountThisWeek >= 2
    ? `Fresh signal · ${resignalCountThisWeek}× this week`
    : 'Fresh signal';
  const sourceMeta = getSourceMeta(alert.source);
  const rec = (alert.recommendation || 'HOLD').toUpperCase();

  // Status dot — win/neutral/loss based on since-alert %
  const dotClass = pct >= 5 ? 'win' : pct <= -5 ? 'loss' : 'neutral';

  // Rec chip variant + hero tone
  const recVariant = ['BUY', 'HOLD', 'SELL', 'TRIM', 'EXIT', 'RIDING'].includes(rec)
    ? rec.toLowerCase() : 'hold';
  const heroTone = rec === 'SELL' ? 'loss'
    : (rec === 'TRIM' || rec === 'EXIT') ? 'neutral'
    : rec === 'RIDING' ? 'win' : '';

  // Days since alert
  const alertDateObj = new Date(alert.alert_date + 'T00:00:00');
  const daysSinceAlert = Math.floor((Date.now() - alertDateObj.getTime()) / 86400000);
  const daysLabel = daysSinceAlert <= 0 ? 'today'
    : daysSinceAlert === 1 ? '1 day ago' : `${daysSinceAlert} days ago`;

  // ────────────────────────────────────────────────────────────────────
  // Quiet / stale-chatter detection (2026-05-12). Cards whose newest
  // AI chatter is 30+ days old get a "Quiet · 47d" pill and a muted
  // visual treatment so users can scan freshness at a glance.
  //
  // We compute "last chatter" as the MAX of:
  //   - last_resignal_at  (a recent re-detection by the daily scan)
  //   - the newest signal_change_history entry
  //   - alert_date        (the original AI flag date — fallback)
  // ────────────────────────────────────────────────────────────────────
  const lastChatterMs = (() => {
    const cands = [];
    if (alert.last_resignal_at) {
      const t = new Date(alert.last_resignal_at).getTime();
      if (!Number.isNaN(t)) cands.push(t);
    }
    if (Array.isArray(alert.signal_change_history) && alert.signal_change_history.length > 0) {
      for (const sc of alert.signal_change_history) {
        const ts = new Date(sc.change_date || sc.created_at || 0).getTime();
        if (!Number.isNaN(ts) && ts > 0) cands.push(ts);
      }
    }
    if (alert.latest_signal_change) {
      const ts = new Date(alert.latest_signal_change.change_date || alert.latest_signal_change.created_at || 0).getTime();
      if (!Number.isNaN(ts) && ts > 0) cands.push(ts);
    }
    if (alert.alert_date) {
      const ts = new Date(alert.alert_date + 'T00:00:00').getTime();
      if (!Number.isNaN(ts) && ts > 0) cands.push(ts);
    }
    return cands.length ? Math.max(...cands) : null;
  })();
  const quietDays = lastChatterMs != null
    ? Math.floor((Date.now() - lastChatterMs) / 86400000)
    : null;
  const QUIET_THRESHOLD_DAYS = 30;
  const isQuiet = quietDays != null && quietDays >= QUIET_THRESHOLD_DAYS;
  const quietLabel = isQuiet
    ? `Quiet · ${quietDays}d`
    : null;

  // Market-hours indicator was moved to the page-level MarketClock.
  // Each card no longer displays its own ET time.

  // 52-week position (0–100)
  const wkLo = alert.week52_low != null ? parseFloat(alert.week52_low) : null;
  const wkHi = alert.week52_high != null ? parseFloat(alert.week52_high) : null;
  const wkPct = (wkLo != null && wkHi != null && price != null && wkHi > wkLo)
    ? Math.min(100, Math.max(0, ((price - wkLo) / (wkHi - wkLo)) * 100))
    : null;

  // Trade-plan flags
  const hasPlan = alert.entry_low != null || alert.target_low != null || alert.stop_loss != null;
  const stopHit = alert.stop_loss != null && price != null && price <= parseFloat(alert.stop_loss);
  const targetHit = alert.target_low != null && price != null && price >= parseFloat(alert.target_low);

  // Volume spike (>= 1.5×)
  const volSpike = alert.volume_ratio != null && parseFloat(alert.volume_ratio) >= 1.5;

  // Market cap label
  const mc = alert.market_cap;
  const mcLabel = mc != null
    ? `${mc >= 1000 ? '$' + (mc/1000).toFixed(1) + 'T' : '$' + mc.toFixed(1) + 'B'} ${mc >= 200 ? 'Mega' : mc >= 10 ? 'Large' : mc >= 2 ? 'Mid' : 'Small'}`
    : null;

  // WSB trend arrow (only meaningful for WSB-sourced picks)
  const isWsb = sourceMeta.cls === 'src-wsb';
  const wsbArrow = isWsb && alert.wsb_trend === 'up' ? ' trend-up'
    : isWsb && alert.wsb_trend === 'down' ? ' trend-down' : '';

  // AI read tone
  const aiReadTone = rec === 'SELL' ? 'danger'
    : rec === 'TRIM' || rec === 'EXIT' ? 'warn'
    : rec === 'RIDING' ? 'riding' : '';

  // ── RIDING trail-stop metadata ──────────────────────────────────
  // For RIDING cards we surface the trail stop + locked-in gain.
  // Falls back gracefully when trail_stop hasn't been written yet
  // (e.g. the scan just flipped to RIDING but refresh-prices hasn't
  //  ratcheted yet — the card still renders, just without the badge).
  const trailStop = alert.trail_stop != null ? parseFloat(alert.trail_stop) : null;
  const recentHigh = alert.recent_high != null ? parseFloat(alert.recent_high) : null;
  const entryRef = alert.entry_low != null ? parseFloat(alert.entry_low) : null;
  const lockedInPct = (entryRef && trailStop && entryRef > 0)
    ? ((trailStop - entryRef) / entryRef) * 100
    : null;

  const handleDismiss = () => {
    if (!onDismiss) return;
    if (typeof window !== 'undefined' && window.confirm(`Dismiss ${alert.ticker}? It'll move to your personal archive (only affects your view — other users still see it).`)) {
      onDismiss(alert.id);
    }
  };
  const handleSaveNote = async () => {
    if (onSaveNote) await onSaveNote(alert.ticker, noteDraft);
    setNoteEditing(false);
  };
  const cancelNote = () => { setNoteDraft(userNote || ''); setNoteEditing(false); };

  const recDisplay = rec === 'EXIT'
    ? <><Ico name="flag" size={12} /> EXIT</>
    : rec === 'TRIM'
    ? <><Ico name="scissors" size={12} /> TRIM</>
    : rec === 'RIDING'
    ? <><Ico name="flame" size={12} /> RIDING</>
    : rec;

  return (
    <div
      id={`card-${alert.ticker}`}
      className={`ac ac-${recVariant}${compact ? ' ac-compact' : ''}${isNew ? ' ac-new' : ''}${isDropped ? ' ac-dropped' : ''}${isWatched ? ' ac-watched' : ''}${isQuiet ? ' ac-quiet' : ''}`}
    >
      {/* HEADER — ticker, live price, signal bars, dismiss */}
      <div className="ac-header">
        <div className="ac-left">
          <div className="ac-ticker-row">
            <span className={`ac-dot ac-dot-${dotClass}`} title={`Since alert: ${fmtPct(pct)}`}></span>
            <span className="ac-ticker">{alert.ticker}</span>
            {price != null && (
              <>
                <span className="ac-live">${price.toFixed(2)}</span>
                {todayPct != null && (
                  <span className={`ac-today-pct ${todayPct >= 0 ? 'pos' : 'neg'}`} title="Today vs. previous close">
                    <span className="ac-today-lbl">Today</span>
                    <span className="ac-today-val">{todayPct >= 0 ? '+' : ''}{todayPct.toFixed(1)}%</span>
                  </span>
                )}
              </>
            )}
            {isNew && <span className="ac-new-pill">NEW</span>}
            {!isNew && isFreshSignal && (
              <span
                className="ac-fresh-pill"
                title="The daily scan re-detected this ticker — see signal history below."
              >
                <span className="ac-fresh-dot" aria-hidden="true"></span>
                {freshSignalLabel}
              </span>
            )}
            {!isNew && !isFreshSignal && isQuiet && (
              <span
                className="ac-quiet-pill"
                title={`No fresh AI chatter on this ticker in ${quietDays} days. The signal may be stale — check the chart and signal history before acting.`}
              >
                <span className="ac-quiet-dot" aria-hidden="true"></span>
                {quietLabel}
              </span>
            )}
            {isDropped && <span className="ac-dropped-pill">DROPPED</span>}
          </div>
          <div className="ac-company-row">
            <span className="ac-company">{alert.company}</span>
          </div>
          {extPrice != null && (
            <div
              className={`ac-ext-hours ${extPct != null ? (extPct >= 0 ? 'pos' : 'neg') : ''}`}
              title={`${extLabel} price from Yahoo`}
            >
              <span className="ac-ext-dot" aria-hidden="true">●</span>
              <span className="ac-ext-lbl">{extLabel}</span>
              <span className="ac-ext-price">${Number(extPrice).toFixed(2)}</span>
              {extPct != null && (
                <span className="ac-ext-pct">
                  {extPct >= 0 ? '+' : ''}{Number(extPct).toFixed(2)}%
                </span>
              )}
            </div>
          )}
        </div>
        <div className="ac-right">
          <div className="ac-right-top">
            <SignalBars
              score={alert.signal_strength}
              subScores={alert.signal_sub_scores}
              sourceCount={alert.signal_source_count}
              mentionCount={alert.signal_mention_count}
            />
            {/* The × dismiss button was removed in Phase 5 — its action now
                folds into the 👎 below: tapping 👎 both rates and dismisses. */}
          </div>
          <div className="ac-actions">
            <RatingButtons alertId={alert.id} currentRating={alert.user_rating} onRate={onRate} />
            {/* The ⭐ watchlist star was removed in Phase 5. The new prominent
                "+ Track this stock" button at the bottom of the card replaces it. */}
          </div>
        </div>
      </div>

      {/* HERO — AI recommendation + since-alert (with original entry price) */}
      <div className={`ac-hero ac-hero-${heroTone || recVariant}`}>
        <span className={`ac-rec-chip ac-rec-${recVariant}`}>{recDisplay}</span>
        <div className="ac-since-block">
          {entryPrice != null && (
            <span className="ac-since-from">From ${entryPrice.toFixed(2)}</span>
          )}
          <span className="ac-since-arrow" aria-hidden="true">→</span>
          <span className={`ac-since ${pct >= 0 ? 'pos' : 'neg'}`}>
            {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
          </span>
        </div>
        <span className="ac-since-lbl">since alert<br/>{daysLabel}</span>
      </div>

      {/* BADGES — source, market cap, volume spike, sector */}
      <div className="ac-badges">
        <span className={`ac-b ac-b-source ${sourceMeta.cls}${wsbArrow}`}>
          <Ico name={sourceMeta.icon} /> {sourceMeta.label}
        </span>
        {mcLabel && <span className="ac-b ac-b-mcap"><Ico name="building" /> {mcLabel}</span>}
        {volSpike && (
          <span className="ac-b ac-b-vol">
            <Ico name="flame" /> {parseFloat(alert.volume_ratio).toFixed(1)}× vol
          </span>
        )}
        {/* Sector chip — only shown when ticker_meta has been classified.
            Hidden gracefully on unclassified tickers; doesn't disturb the
            existing badge row when absent. */}
        {tickerMeta?.industry && (
          <span className="ac-sector-chip" title={`${tickerMeta.industry}${tickerMeta.sector ? ' · ' + tickerMeta.sector : ''}`}>
            {tickerMeta.industry}
          </span>
        )}
      </div>

      {/* DATE META (2026-05-14) — first-picked + last-activity dates.
          Lets AJ scan a big tab for freshness at a glance and pairs with
          the new Sort-by control. "Picked" = alert_date (when the AI first
          flagged it); "Updated" = lastChatterMs (most recent re-signal or
          recommendation change). */}
      <div className="ac-datemeta">
        <span
          className="ac-datemeta-item"
          title={`First flagged by the AI on ${alertDateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' })}`}
        >
          <Ico name="calendar" size={11} className="ac-datemeta-ico" />
          Picked {alertDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
        {lastChatterMs != null && (
          <span
            className="ac-datemeta-item"
            title="Most recent AI activity on this pick — a re-signal or a recommendation change"
          >
            <Ico name="clock" size={11} className="ac-datemeta-ico" />
            Updated {relTimeLabel(lastChatterMs) || 'today'}
          </span>
        )}
      </div>

      {/* TRADE PLAN — entry / take profit / stop loss */}
      {hasPlan && (() => {
        // Smart decimal formatting — stocks ≥$100 drop the cents so the chip
        // range (e.g. $138–$144) fits in the narrow 3-column layout.
        const fmtP = (n) => {
          const v = parseFloat(n);
          return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`;
        };
        const fmtRange = (lo, hi) => {
          const l = parseFloat(lo);
          const h = parseFloat(hi || lo);
          if (Math.abs(l - h) < 0.01) return fmtP(l);
          return `${fmtP(l)}–${fmtP(h)}`;
        };
        return (
          <div className="ac-plan">
            {alert.entry_low != null && (
              <div className="ac-plan-item ac-plan-entry">
                <span className="ac-plan-lbl">Entry</span>
                <span className="ac-plan-val">{fmtRange(alert.entry_low, alert.entry_high)}</span>
              </div>
            )}
            {alert.target_low != null && (
              <div className={`ac-plan-item ac-plan-target${targetHit ? ' hit' : ''}`}>
                <span className="ac-plan-lbl"><Ico name="target" size={11} /> {targetHit ? <>Hit <Ico name="check" size={11} /></> : 'Target'}</span>
                <span className="ac-plan-val">{fmtRange(alert.target_low, alert.target_high)}</span>
              </div>
            )}
            {/* RIDING swaps the hard stop for the live trail stop. The
                trail stop ratchets up in /api/refresh-prices every 30 min,
                so the value here is always the latest. Falls back to the
                original stop if trail_stop hasn't been written yet. */}
            {rec === 'RIDING' && trailStop != null ? (
              <div className="ac-plan-item ac-plan-trail">
                <span className="ac-plan-lbl"><Ico name="shield" size={11} /> Trail stop</span>
                <span className="ac-plan-val">{fmtP(trailStop)}</span>
              </div>
            ) : (
              alert.stop_loss != null && (
                <div className={`ac-plan-item ac-plan-stop${stopHit ? ' hit' : ''}`}>
                  <span className="ac-plan-lbl">{stopHit ? <>Stop hit <Ico name="check" size={11} /></> : 'Stop'}</span>
                  <span className="ac-plan-val">{fmtP(alert.stop_loss)}</span>
                </div>
              )
            )}
          </div>
        );
      })()}

      {/* RIDING momentum strip — appears between the plan row and the AI
          read, only on cards in the RIDING state. Tells the user at a
          glance that this is a winner we're still riding + how much
          profit is locked in by the trail stop. Inline price format
          here (not the inner fmtP helper) because that helper is scoped
          to the IIFE above. */}
      {rec === 'RIDING' && (() => {
        const fmtP2 = (n) => {
          const v = parseFloat(n);
          if (!Number.isFinite(v)) return '';
          return v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(2)}`;
        };
        return (
          <div className="ac-riding-strip">
            <span className="ac-riding-pill">
              <Ico name="flame" size={12} /> Riding momentum
            </span>
            {lockedInPct != null && lockedInPct > 0 && (
              <span className="ac-riding-locked">
                <Ico name="shield" size={11} /> Locks in <b>+{lockedInPct.toFixed(1)}%</b> if hit
              </span>
            )}
            {recentHigh != null && (
              <span className="ac-riding-high">
                <Ico name="trend" size={11} /> High {fmtP2(recentHigh)}
              </span>
            )}
          </div>
        );
      })()}

      {/* AI READ — one-line call-explanation from the daily job */}
      {(alert.ai_read || alert.recommendation_reason) && (
        <div className={`ac-ai-read ${aiReadTone}`}>
          <span className="ac-ai-icon"><Ico name="sparkles" size={15} /></span>
          <span><b>AI read:</b> {alert.ai_read || alert.recommendation_reason}</span>
        </div>
      )}

      {/* SIGNAL HISTORY — Robinhood-style collapsible audit trail of every
          time the daily scan flagged this ticker. Shows last 5 entries from
          stock_alerts.signal_history JSONB. Only renders if there's at least
          one re-signal worth surfacing. */}
      {signalHistory.length > 1 && (
        <SignalHistoryAccordion entries={visibleSignalHistory} totalCount={signalHistory.length} />
      )}

      {/* 52-WEEK RANGE */}
      {wkPct != null && (
        <div className="ac-range">
          <div className="ac-range-top">52-week range</div>
          <div className="ac-range-bar">
            <div className="ac-range-marker" style={{ left: `${wkPct}%` }}></div>
          </div>
          <div className="ac-range-labels">
            <span>${wkLo.toFixed(2)}</span>
            <span>{wkPct.toFixed(0)}%</span>
            <span>${wkHi.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* CHART */}
      <HistoricChart ticker={alert.ticker} canvasId={`${sectionPrefix}-hist-${index}`} />

      {/* ALERT REASON */}
      {alert.alert_reason && <div className="ac-reason">{alert.alert_reason}</div>}

      {/* ANALYST + EARNINGS */}
      <AnalystBadge ticker={alert.ticker} />
      <EarningsDate ticker={alert.ticker} />

      {/* SIGNAL CHANGE — latest visible, expandable to last 5 */}
      {alert.latest_signal_change && (() => {
        const history = (alert.signal_change_history && alert.signal_change_history.length > 0)
          ? alert.signal_change_history
          : [alert.latest_signal_change];
        const latest = history[0];
        const older = history.slice(1, 5); // up to 4 older, total 5
        const hasMore = older.length > 0;
        const fmtDate = (sc) =>
          new Date(sc.change_date || sc.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return (
          <div className={`ac-sig-change ${hasMore ? 'ac-sig-expandable' : ''} ${sigHistOpen ? 'is-open' : ''}`}>
            <div
              className="ac-sig-row ac-sig-latest"
              onClick={hasMore ? () => setSigHistOpen(o => !o) : undefined}
              role={hasMore ? 'button' : undefined}
              tabIndex={hasMore ? 0 : undefined}
              aria-expanded={hasMore ? sigHistOpen : undefined}
            >
              <span className="ac-sig-icon"><Ico name="megaphone" size={13} /></span>
              <span className="ac-sig-label">Signal changed:</span>
              <span className={`ac-mini-chip ${recClass(latest.old_recommendation)}`}>
                {latest.old_recommendation}
              </span>
              <span className="ac-sig-arrow">→</span>
              <span className={`ac-mini-chip ${recClass(latest.new_recommendation)}`}>
                {latest.new_recommendation}
              </span>
              <span className="ac-sig-date">{fmtDate(latest)}</span>
              {hasMore && (
                <span className="ac-sig-chevron" aria-hidden="true">
                  <Ico name={sigHistOpen ? 'chevronup' : 'chevrondown'} size={11} />
                </span>
              )}
            </div>
            {hasMore && sigHistOpen && (
              <div className="ac-sig-history">
                <div className="ac-sig-history-title">Earlier signals</div>
                {older.map((sc, i) => (
                  <div key={sc.id || `${sc.alert_id}-${i}`} className="ac-sig-row ac-sig-prev">
                    <span className={`ac-mini-chip ${recClass(sc.old_recommendation)}`}>
                      {sc.old_recommendation}
                    </span>
                    <span className="ac-sig-arrow">→</span>
                    <span className={`ac-mini-chip ${recClass(sc.new_recommendation)}`}>
                      {sc.new_recommendation}
                    </span>
                    <span className="ac-sig-date">{fmtDate(sc)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* PAPER TRADE (watchlist only) */}
      {sectionPrefix === 'watchlist' && onOpenBuyModal && (
        <div className="paper-trade-row">
          {openPosition ? (() => {
            const invested = parseFloat(openPosition.entry_amount);
            const shares = parseFloat(openPosition.shares);
            const currentPrice = price ?? parseFloat(openPosition.entry_price);
            const currentValue = currentPrice * shares;
            const pnl = currentValue - invested;
            const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
            return (
              <>
                <div className="paper-trade-holding">
                  <div className="pth-top">
                    <span className="pth-label"><Ico name="briefcase" size={12} /> PAPER POSITION</span>
                    <span className={`pth-pnl ${pnl >= 0 ? 'pct-pos' : 'pct-neg'}`}>
                      {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                    </span>
                  </div>
                  <div className="pth-bot">
                    <span>{shares.toFixed(4)} sh @ ${parseFloat(openPosition.entry_price).toFixed(2)} = ${invested.toFixed(2)}</span>
                    <span>Now: ${currentValue.toFixed(2)}</span>
                  </div>
                </div>
                <button className="paper-trade-btn paper-trade-sell" onClick={() => onOpenSellModal(openPosition, currentPrice)}>
                  <Ico name="dollar" size={14} /> Paper Sell
                </button>
              </>
            );
          })() : (
            <button
              className="paper-trade-btn paper-trade-buy"
              onClick={() => onOpenBuyModal(alert, price ?? parseFloat(alert.price_at_alert))}
            >
              <Ico name="trend" size={14} /> Paper Buy
            </button>
          )}
        </div>
      )}

      {/* PERSONAL NOTE */}
      <div className="ac-note">
        {noteEditing ? (
          <div className="ac-note-edit">
            <input
              className="ac-note-input"
              value={noteDraft}
              maxLength={500}
              autoFocus
              placeholder="Why you're watching this…"
              onChange={(e) => setNoteDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSaveNote();
                else if (e.key === 'Escape') cancelNote();
              }}
            />
            <button className="ac-note-save" onClick={handleSaveNote}>Save</button>
            <button className="ac-note-cancel" onClick={cancelNote}>Cancel</button>
          </div>
        ) : (
          <div className="ac-note-view" onClick={() => setNoteEditing(true)} title="Click to edit">
            <b>My note:</b>{' '}
            {userNote ? userNote : <span className="ac-note-empty">— click to add</span>}
          </div>
        )}
      </div>

      {/* TRACK BUTTON (Phase 5, updated Phase 8) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
          Prominent CTA replacing the small \u2B50 star icon. Opens the unified
          AddStockSheet pre-filled with this card's ticker + AI data so the
          user can either add to watchlist (1 tap) or log a paper position
          (2 taps with AI-suggested entry/target/stop already filled in).

          Three visual states:
            - Holding a position \u2192 green "\u25CF Holding X shares" pill
            - Already on watchlist \u2192 subtle gray "\u2713 Watching \u00B7 tap to log position"
            - Not tracked \u2192 bright blue "+ Add to Portfolio" gradient

          Phase 8 (2026-05-12) addition: on the New + Active tabs, also show
          a small one-tap "+ Watch" pill ABOVE the gradient CTA when the
          ticker isn't already tracked. This routes straight to the
          watchlist (no sheet) so users can park a pick in their Portfolio
          > Watching list with a single tap, Robinhood-style. The gradient
          CTA is preserved for the heavier "log a position" path.
      */}
      {onOpenAddSheet && (() => {
        const isServerWatched = !!(serverWatchlist || []).find(
          (w) => (w.ticker || '').toUpperCase() === alert.ticker.toUpperCase()
        );
        const hasPosition = !!openPosition;
        const showQuickWatch =
          (sectionPrefix === 'new' || sectionPrefix === 'active') &&
          !hasPosition &&
          !isServerWatched &&
          typeof onToggleWatchlist === 'function';
        let label, classMod;
        if (hasPosition) {
          const shares = parseFloat(openPosition.shares || 0);
          label = `\u{2713} Holding ${shares.toFixed(2)} sh \u00B7 tap to manage`;
          classMod = 'ac-track-cta-holding';
        } else if (isServerWatched) {
          label = '\u{2713} Watching \u00B7 tap to log a position';
          classMod = 'ac-track-cta-watching';
        } else {
          label = '+ Add to Portfolio';
          classMod = '';
        }
        return (
          <>
            {showQuickWatch && (
              <button
                type="button"
                className="ac-quick-watch-btn"
                onClick={(e) => { e.stopPropagation(); onToggleWatchlist(alert.ticker); }}
                aria-label={`Watch ${alert.ticker} \u2014 add to Portfolio`}
              >
                + Watch
              </button>
            )}
            <button
              type="button"
              className={`ac-track-cta ${classMod}`}
              onClick={() => onOpenAddSheet({
                ticker: alert.ticker,
                company: alert.company,
                alert: alert,
              })}
              aria-label={`Add ${alert.ticker} to Portfolio`}
            >
              {label}
            </button>
          </>
        );
      })()}

      {/* COLLAPSE TOGGLE */}
      <button className="ac-expand-btn" onClick={() => setCompact(!compact)}>
        {compact ? '\u25BE Show details' : '\u25B4 Collapse to compact'}
      </button>

      {/* RESEARCH FOOTER */}
      <NewsHeadlines ticker={alert.ticker} />
      <RedditLinks ticker={alert.ticker} />
      <div className="research-row">
        <a href={`https://finance.yahoo.com/quote/${alert.ticker}`} target="_blank" rel="noopener noreferrer" className="research-link">
          Yahoo Finance →
        </a>
      </div>
    </div>
  );
}

// ── Distribution List Manager ──
function DistributionListManager() {
  const [members, setMembers] = useState([]);
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetch('/api/distribution-list', { credentials: 'same-origin' })
      .then(res => {
        if (res.status === 401) { router.replace('/login'); return null; }
        if (!res.ok) throw new Error();
        return res.json();
      })
      .then(data => { if (data) setMembers(data.members || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [router]);

  const addMember = async () => {
    if (!newEmail) return;
    setMessage('');
    try {
      const res = await fetch('/api/distribution-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: newEmail, name: newName }),
      });
      if (res.status === 401) { router.replace('/login'); return; }
      if (res.status === 409) { setMessage('Email already exists'); return; }
      if (!res.ok) throw new Error();
      const data = await res.json();
      setMembers([...members, data.member]);
      setNewEmail('');
      setNewName('');
      setMessage('Added!');
    } catch {
      setMessage('Failed to add');
    }
  };

  const removeMember = async (id) => {
    try {
      const res = await fetch(`/api/distribution-list?id=${id}`, { method: 'DELETE', credentials: 'same-origin' });
      if (res.status === 401) { router.replace('/login'); return; }
      setMembers(members.filter(m => m.id !== id));
    } catch { /* silently fail */ }
  };

  return (
    <div className="dist-list-section">
      <p className="section-title">{"\u{1F4E7}"} Signal Change Alert List</p>
      <p className="section-hint" style={{ marginLeft: 0 }}>When a stock changes from BUY to SELL (or vice versa), everyone on this list gets notified.</p>

      <div className="dist-list-form">
        <input type="email" placeholder="Email address" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="dist-input" />
        <input type="text" placeholder="Name (optional)" value={newName} onChange={(e) => setNewName(e.target.value)} className="dist-input dist-input-name" />
        <button onClick={addMember} className="dist-add-btn">+ Add</button>
      </div>
      {message && <div className="dist-message">{message}</div>}

      {loading ? (
        <div style={{ color: '#4a6a85', fontSize: '0.85rem', padding: '12px 0' }}>Loading list...</div>
      ) : (
        <div className="dist-list-members">
          {members.map(m => (
            <div key={m.id} className="dist-member">
              <div>
                <span className="dist-member-email">{m.email}</span>
                {m.name && <span className="dist-member-name">{m.name}</span>}
              </div>
              <button onClick={() => removeMember(m.id)} className="dist-remove-btn">{"\u{2715}"}</button>
            </div>
          ))}
          {members.length === 0 && (
            <div style={{ color: '#4a6a85', fontSize: '0.85rem' }}>No members yet.</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Market Cap Slider Component ──
function MarketCapSlider({ range, onChange }) {
  const [localMin, setLocalMin] = useState(range[0]);
  const [localMax, setLocalMax] = useState(range[1]);
  const [isOpen, setIsOpen] = useState(false);

  const presets = [
    { label: 'All', min: 0, max: 5000 },
    { label: 'Small <$2B', min: 0, max: 2 },
    { label: 'Mid $2-10B', min: 2, max: 10 },
    { label: 'Large $10-200B', min: 10, max: 200 },
    { label: 'Mega $200B+', min: 200, max: 5000 },
  ];

  const handleApply = () => {
    onChange([localMin, localMax]);
    setMarketCapFilter([localMin, localMax]);
  };

  const handlePreset = (min, max) => {
    setLocalMin(min);
    setLocalMax(max);
    onChange([min, max]);
    setMarketCapFilter([min, max]);
  };

  const formatVal = (v) => {
    if (v >= 1000) return `$${(v / 1000).toFixed(1)}T`;
    return `$${v}B`;
  };

  const isFiltered = range[0] > 0 || range[1] < 5000;

  return (
    <div className="mcap-filter-wrapper">
      <button className={`mcap-filter-toggle ${isFiltered ? 'active' : ''}`} onClick={() => setIsOpen(!isOpen)}>
        {"\u{1F3E2}"} Market Cap {isFiltered ? `(${formatVal(range[0])} \u{2013} ${formatVal(range[1])})` : '(All)'}
      </button>
      {isOpen && (
        <div className="mcap-filter-dropdown">
          <div className="mcap-presets">
            {presets.map(p => (
              <button
                key={p.label}
                className={`mcap-preset-btn ${localMin === p.min && localMax === p.max ? 'active' : ''}`}
                onClick={() => handlePreset(p.min, p.max)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mcap-custom">
            <label className="mcap-label">Custom Range</label>
            <div className="mcap-slider-row">
              <div className="mcap-input-group">
                <span className="mcap-input-label">Min</span>
                <input
                  type="number"
                  className="mcap-input"
                  value={localMin}
                  onChange={(e) => setLocalMin(Math.max(0, parseFloat(e.target.value) || 0))}
                  min="0"
                  step="1"
                />
                <span className="mcap-unit">B</span>
              </div>
              <span className="mcap-dash">{"\u{2013}"}</span>
              <div className="mcap-input-group">
                <span className="mcap-input-label">Max</span>
                <input
                  type="number"
                  className="mcap-input"
                  value={localMax}
                  onChange={(e) => setLocalMax(Math.max(0, parseFloat(e.target.value) || 0))}
                  min="0"
                  step="1"
                />
                <span className="mcap-unit">B</span>
              </div>
              <button className="mcap-apply-btn" onClick={handleApply}>Apply</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Recommendation Quick Filter (Robinhood-style chip row) ──
// Replaces the old Signal-Type dropdown. Filters cards by the AI's action
// recommendation (BUY / HOLD / TRIM / EXIT / SELL) — the dimension AJ actually
// acts on. Lives in its own row under the tabs with live counts per pill, and
// horizontally scrolls on narrow screens.
function RecommendationFilter({ value, onChange, counts }) {
  // Dropped colored-dot emojis 2026-05-13 — the pill's own background already
  // color-codes the recommendation. Robinhood-style: let the color carry the
  // meaning, no redundant glyph.
  const options = [
    { key: 'ALL',    label: 'All',    cls: 'rec-pill--all'    },
    { key: 'BUY',    label: 'Buy',    cls: 'rec-pill--buy'    },
    { key: 'HOLD',   label: 'Hold',   cls: 'rec-pill--hold'   },
    { key: 'TRIM',   label: 'Trim',   cls: 'rec-pill--trim'   },
    { key: 'RIDING', label: 'Riding', cls: 'rec-pill--riding' },
    { key: 'EXIT',   label: 'Exit',   cls: 'rec-pill--exit'   },
    { key: 'SELL',   label: 'Sell',   cls: 'rec-pill--sell'   },
  ];
  return (
    <div
      className="rec-filter-row"
      role="tablist"
      aria-label="Filter picks by recommendation"
    >
      {options.map(opt => {
        const active = value === opt.key;
        const count  = counts?.[opt.key] ?? 0;
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            className={`rec-pill ${opt.cls}${active ? ' rec-pill--active' : ''}`}
            onClick={() => onChange(opt.key)}
            title={opt.key === 'ALL' ? 'Show all picks' : `Show only ${opt.label.toUpperCase()} picks`}
          >
            <span className="rec-pill-label">{opt.label}</span>
            <span className="rec-pill-count">{count}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Sort-By Dropdown (2026-05-14) ──
// A compact, Robinhood-quiet control that re-orders the card grid. Uses a
// native <select> on purpose: on mobile it pops the OS picker wheel (fast,
// familiar, accessible) and on desktop it's a normal dropdown. The visible
// chip (icon + current label) is styled; the <select> sits invisibly on top
// so the whole thing is one big tap target.
function SortByDropdown({ value, onChange }) {
  const options = [
    { key: 'strength', label: 'Strongest signal' },
    { key: 'updated',  label: 'Recently updated' },
    { key: 'newest',   label: 'Newest pick' },
    { key: 'oldest',   label: 'Oldest pick' },
    { key: 'best',     label: 'Best performer' },
    { key: 'worst',    label: 'Worst performer' },
  ];
  const current = options.find(o => o.key === value) || options[0];
  return (
    <label className="sort-by" title="Change how picks are ordered">
      <Ico name="sort" size={13} className="sort-by-ico" />
      <span className="sort-by-text">
        <span className="sort-by-kicker">Sort</span>
        <span className="sort-by-current">{current.label}</span>
      </span>
      <Ico name="chevrondown" size={13} className="sort-by-caret" />
      <select
        className="sort-by-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Sort picks by"
      >
        {options.map(o => (
          <option key={o.key} value={o.key}>{o.label}</option>
        ))}
      </select>
    </label>
  );
}

// ── Active AI Filter Banner ──
// Shows on the home page whenever an AI filter is set to a non-default value,
// so the user can see at a glance that results are being filtered.
function ActiveAIFilterBanner({ settings, onClear, onOpenSettings }) {
  const activeFilters = [];

  const mcap = settings?.market_cap_range;
  const mcapIsDefault = !mcap || (mcap.min === 0 && mcap.max === 5000);
  if (!mcapIsDefault) {
    const fmt = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}T` : `$${v}B`);
    activeFilters.push({
      key: 'market_cap_range',
      label: 'Market Cap',
      value: `${fmt(mcap.min)} \u2013 ${fmt(mcap.max)}`,
      defaultValue: { min: 0, max: 5000 },
    });
  }

  if (activeFilters.length === 0) return null;

  return (
    <div className="ai-filter-banner">
      <span className="ai-filter-banner-icon">{"\u{1F3AF}"}</span>
      <span className="ai-filter-banner-label">AI filter active:</span>
      {activeFilters.map((f) => (
        <span key={f.key} className="ai-filter-banner-chip">
          <span className="ai-filter-banner-chip-name">{f.label}:</span>
          <span className="ai-filter-banner-chip-value">{f.value}</span>
          <button
            type="button"
            className="ai-filter-banner-clear"
            title={`Clear ${f.label} filter`}
            onClick={() => onClear(f.key, f.defaultValue)}
          >
            {"\u00D7"}
          </button>
        </span>
      ))}
      <button
        type="button"
        className="ai-filter-banner-edit"
        onClick={onOpenSettings}
      >
        Edit
      </button>
    </div>
  );
}

// ── Source Health Banner (admin-only) ──
// Shows when one of the daily-scan data sources has been failing. Only
// admins see it (the API returns 403 for everyone else — so on non-admin
// accounts the fetch fails and the banner never renders).
// Current source set (post 2026-05-13 Tier 2 upgrade): 14 sources.
const SOURCE_LABELS = {
  wsb: 'Reddit / r/wallstreetbets',
  apewisdom: 'ApeWisdom (broader Reddit + /biz)',
  reddit_biotech: 'Reddit / r/biotechplays',
  reddit_shortsqueeze: 'Reddit / r/Shortsqueeze',
  reddit_vitards: 'Reddit / r/Vitards',
  yahoo: 'Yahoo Finance (trending)',
  yahoo_premarket: 'Yahoo Pre-market gainers',
  stooq: 'Stooq (fallback prices)',
  polymarket: 'Polymarket',
  kalshi: 'Kalshi (macro dial)',
  sec_edgar: 'SEC EDGAR 8-K feed',
  sec_form4: 'SEC Form 4 insider buys',
  biopharmcatalyst: 'FDA / PDUFA catalyst calendar',
  nasdaq_halt: 'NASDAQ trade-halt feed',
  // Retired (not shown in banner, but documented here for history):
  //   stocktwits — 2026-04-20, public API permanently 403s
  //   google_finance — 2026-04-21, 0 picks / 14 days, duplicative with yahoo
};

function formatRelTime(iso) {
  if (!iso) return 'never';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function SourceHealthBanner() {
  const [data, setData] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch('/api/source-health', { cache: 'no-store' });
        if (!res.ok) return; // 401/403 for non-admins — silently ignore
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (_) { /* network noise — ignore */ }
    };
    load();
    // Refresh every 5 minutes so a degraded source recovering is reflected live.
    const id = setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  if (!data || dismissed) return null;
  if (!data.anyDegraded && !data.anyDown) return null;

  const tone = data.anyDown ? 'down' : 'degraded';
  const badSources = (data.sources || []).filter(
    (s) => s.status === 'down' || s.status === 'degraded'
  );

  return (
    <div className={`source-health-banner source-health-${tone}`}>
      <span className={`source-health-dot source-health-dot-${tone}`} />
      <span className="source-health-label">
        {tone === 'down' ? 'Data source issue' : 'Data source degraded'}
      </span>
      <span className="source-health-summary">{data.summary}</span>
      <button
        type="button"
        className="source-health-expand"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {expanded ? 'Hide details' : 'Details'}
      </button>
      <button
        type="button"
        className="source-health-dismiss"
        onClick={() => setDismissed(true)}
        title="Dismiss for this session"
        aria-label="Dismiss"
      >
        {'\u00D7'}
      </button>
      {expanded && (
        <div className="source-health-details">
          {badSources.map((s) => (
            <div key={s.source} className={`source-health-row source-health-row-${s.status}`}>
              <span className={`source-health-dot source-health-dot-${s.status}`} />
              <span className="source-health-row-name">
                {SOURCE_LABELS[s.source] || s.source}
              </span>
              <span className="source-health-row-status">
                {s.status === 'down' ? 'DOWN' : 'DEGRADED'}
              </span>
              <span className="source-health-row-meta">
                {s.consecutive_failures} fail{s.consecutive_failures === 1 ? '' : 's'} in a row
                {' \u00B7 '}last ok {formatRelTime(s.last_success_at)}
                {s.last_error_code ? ` \u00B7 ${s.last_error_code}` : ''}
              </span>
            </div>
          ))}
          <div className="source-health-note">
            {'\u{1F4A1}'} The daily scan keeps running with remaining sources.
            If this persists, the next pre-market scan may be missing fresh signals
            from the affected source.
          </div>
        </div>
      )}
    </div>
  );
}

// ── AI Settings Panel ──
function AISettingsPanel({ settings, onSave }) {
  const [localMin, setLocalMin] = useState(settings?.market_cap_range?.min ?? 0);
  const [localMax, setLocalMax] = useState(settings?.market_cap_range?.max ?? 5000);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings?.market_cap_range) {
      setLocalMin(settings.market_cap_range.min ?? 0);
      setLocalMax(settings.market_cap_range.max ?? 5000);
    }
  }, [settings]);

  const presets = [
    { label: 'All Sizes', min: 0, max: 5000 },
    { label: 'Small Cap (<$2B)', min: 0, max: 2 },
    { label: 'Mid Cap ($2\u{2013}$10B)', min: 2, max: 10 },
    { label: 'Large Cap ($10\u{2013}$200B)', min: 10, max: 200 },
    { label: 'Mega Cap ($200B+)', min: 200, max: 5000 },
  ];

  const formatVal = (v) => {
    if (v >= 1000) return `$${(v / 1000).toFixed(1)}T`;
    return `$${v}B`;
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    await onSave('market_cap_range', { min: localMin, max: localMax });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  const handlePreset = (min, max) => {
    setLocalMin(min);
    setLocalMax(max);
  };

  const currentRange = settings?.market_cap_range;
  const isDefault = (!currentRange) || (currentRange.min === 0 && currentRange.max === 5000);

  return (
    <div className="ai-settings-panel">
      <div className="ai-settings-header">
        <h3 className="ai-settings-title">{"\u{2699}\u{FE0F}"} AI Engine Settings</h3>
        <p className="ai-settings-subtitle">These rules control what the AI recommends. Changes take effect on the next scan.</p>
      </div>

      <div className="ai-settings-section">
        <div className="ai-setting-row">
          <div className="ai-setting-info">
            <span className="ai-setting-name">{"\u{1F3E2}"} Market Cap Filter</span>
            <span className="ai-setting-desc">Only recommend stocks within this market cap range. Stocks outside this range will be excluded by the AI.</span>
            <span className="ai-setting-current">
              Current: {isDefault ? 'All sizes (no filter)' : `${formatVal(currentRange.min)} \u{2013} ${formatVal(currentRange.max)}`}
            </span>
          </div>
        </div>

        <div className="ai-setting-controls">
          <div className="ai-mcap-presets">
            {presets.map(p => (
              <button
                key={p.label}
                className={`ai-mcap-preset ${localMin === p.min && localMax === p.max ? 'active' : ''}`}
                onClick={() => handlePreset(p.min, p.max)}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="ai-mcap-custom">
            <div className="ai-mcap-input-row">
              <div className="ai-mcap-input-group">
                <label className="ai-mcap-label">Min Market Cap</label>
                <div className="ai-mcap-field">
                  <span className="ai-mcap-prefix">$</span>
                  <input
                    type="number"
                    className="ai-mcap-input"
                    value={localMin}
                    onChange={(e) => setLocalMin(Math.max(0, parseFloat(e.target.value) || 0))}
                    min="0"
                    step="1"
                  />
                  <span className="ai-mcap-suffix">B</span>
                </div>
              </div>
              <span className="ai-mcap-separator">{"\u{2192}"}</span>
              <div className="ai-mcap-input-group">
                <label className="ai-mcap-label">Max Market Cap</label>
                <div className="ai-mcap-field">
                  <span className="ai-mcap-prefix">$</span>
                  <input
                    type="number"
                    className="ai-mcap-input"
                    value={localMax}
                    onChange={(e) => setLocalMax(Math.max(0, parseFloat(e.target.value) || 0))}
                    min="0"
                    step="1"
                  />
                  <span className="ai-mcap-suffix">B</span>
                </div>
              </div>
            </div>
          </div>

          <div className="ai-setting-actions">
            <button
              className={`ai-save-btn ${saving ? 'saving' : ''} ${saved ? 'saved' : ''}`}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : saved ? '\u{2705} Saved!' : '\u{1F4BE} Save Setting'}
            </button>
            {!isDefault && (
              <span className="ai-setting-active-badge">{"\u{1F7E2}"} Active: {formatVal(currentRange.min)} \u{2013} {formatVal(currentRange.max)}</span>
            )}
          </div>
        </div>
      </div>

      {/* ── Signal Strength reference table ── */}
      <div className="ai-settings-section">
        <div className="ai-setting-row">
          <div className="ai-setting-info">
            <span className="ai-setting-name">{"\u{1F4F6}"} Signal Strength &mdash; How It&apos;s Calculated</span>
            <span className="ai-setting-desc">
              Every pick gets a 0&ndash;100 score that blends four ingredients.
              Picks are sorted strongest-first on the dashboard. This table is
              reference-only; scoring logic lives in <code>app/lib/signalStrength.js</code>.
            </span>
          </div>
        </div>

        <div style={{ padding: '0 16px 16px' }}>
          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', marginBottom: 6 }}>
            Weight mix (totals 100%)
          </div>
          <table className="sigweights-table">
            <thead>
              <tr><th>Ingredient</th><th>Weight</th><th>What it measures</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Unique sources</td>
                <td>{Math.round(SIGNAL_WEIGHTS.source_count * 100)}%</td>
                <td>Distinct platforms mentioning the ticker across 14 feeds &mdash; SEC 8-K, SEC Form 4 insider buys, FDA catalysts, Yahoo pre-market, ApeWisdom, r/biotechplays, r/Shortsqueeze, r/Vitards, NASDAQ halts, WSB, Yahoo trending, Polymarket, Kalshi, Stooq. More sources stacking on one ticker = stronger signal.</td>
              </tr>
              <tr>
                <td>Mention volume</td>
                <td>{Math.round(SIGNAL_WEIGHTS.mention_count * 100)}%</td>
                <td>Total alerts + signal-change events for this ticker across the scan window</td>
              </tr>
              <tr>
                <td>Momentum timing</td>
                <td>{Math.round(SIGNAL_WEIGHTS.velocity * 100)}%</td>
                <td>Rewards <strong>early</strong> momentum (bell-curve peaks at ~2% acceleration) and penalizes stocks that already ran far from alert price. If it already surged 15%+, the score drops sharply &mdash; the easy money is gone.</td>
              </tr>
              <tr>
                <td>Sentiment + analyst</td>
                <td>{Math.round(SIGNAL_WEIGHTS.sentiment * 100)}%</td>
                <td>AI recommendation (Buy/Hold/Sell) blended with Yahoo analyst consensus when available</td>
              </tr>
            </tbody>
          </table>

          <div style={{ fontWeight: 700, fontSize: '0.85rem', color: 'rgba(255,255,255,0.8)', margin: '18px 0 6px' }}>
            Score buckets
          </div>
          <table className="sigweights-table">
            <thead>
              <tr><th>Bars</th><th>Label</th><th>Score range</th></tr>
            </thead>
            <tbody>
              {SIGNAL_BUCKETS.slice().reverse().map(b => (
                <tr key={b.label}>
                  <td>
                    <span className="signal-bars" style={{ '--signal-color': b.color }}>
                      {[1,2,3,4].map(n => (
                        <span key={n} className={`bar b${n}${n <= b.bars ? ' on' : ''}`} style={{ background: n <= b.bars ? b.color : undefined, boxShadow: n <= b.bars ? `0 0 6px ${b.color}` : undefined }} />
                      ))}
                    </span>
                  </td>
                  <td>
                    <span className="sigweights-bucket-cell">
                      <span className="sigweights-bucket-dot" style={{ background: b.color }}></span>
                      {b.label}
                    </span>
                  </td>
                  <td>{b.min}&ndash;{b.max}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', marginTop: 10, lineHeight: 1.5 }}>
            {"\u{1F4A1}"} The dashboard computes signal strength live from Supabase data on every page load,
            so the last 7 days of picks are already scored &mdash; no backfill needed.
            Hover any signal-strength badge on a pick card to see its sub-scores.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Source Performance Leaderboard (Peak Gain or Worst Drawdown) ──
// `mode='peak'`     → max price within 14 days → "peak gain"
// `mode='drawdown'` → min price within 14 days → "worst drawdown"
// Both share the same plumbing: dedupe picks, split source string, group.
// Picks tagged with multiple sources are credited to each source.
// Drops obvious data errors (>500% or <-95%).
function SourcePerformanceLeaderboard({ alerts, mode = 'peak' }) {
  const isPeak = mode === 'peak';
  const [windowMode, setWindowMode] = useState('mature'); // 'mature' | 'all'
  const [showHelp, setShowHelp] = useState(false);

  const stats = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 14);

    // Dedupe alerts by (ticker, alert_date) — keep the earliest id per pair
    // and merge their source strings. Prevents the same physical pick from
    // counting 5x just because the daily scan inserted dup rows.
    const dedupMap = new Map();
    (alerts || []).forEach(a => {
      if (!a.ticker || !a.alert_date || a.price_at_alert == null) return;
      const k = `${a.ticker}|${a.alert_date}`;
      const existing = dedupMap.get(k);
      if (!existing || a.id < existing.id) {
        dedupMap.set(k, { ...a, _sources_combined: a.source || 'unknown' });
      } else {
        existing._sources_combined = [existing._sources_combined, a.source].filter(Boolean).join(',');
      }
    });
    const deduped = Array.from(dedupMap.values());

    // For each pick: compute peak gain within 14d of alert_date
    const perPick = [];
    for (const a of deduped) {
      const alertDate = new Date(a.alert_date + 'T00:00:00');
      if (windowMode === 'mature' && alertDate > cutoff) continue; // not mature yet

      const entry = parseFloat(a.price_at_alert);
      if (!entry || entry <= 0) continue;

      const fourteenAfter = new Date(alertDate); fourteenAfter.setDate(fourteenAfter.getDate() + 14);
      // Peak mode: track MAX price (best moment). Drawdown mode: track MIN
      // price (worst moment). Same window, opposite extreme.
      let extremePrice = entry;
      let priceCount = 0;
      for (const p of (a.prices || [])) {
        // API returns prices with field `date`, not `price_date`
        if (!p.date || p.price == null) continue;
        const pd = new Date(p.date + 'T00:00:00');
        if (pd < alertDate || pd > fourteenAfter) continue;
        priceCount++;
        const pr = parseFloat(p.price);
        if (isPeak ? pr > extremePrice : pr < extremePrice) extremePrice = pr;
      }
      if (priceCount < 1) continue;

      const peakGainPct = ((extremePrice - entry) / entry) * 100;
      if (peakGainPct > 500 || peakGainPct < -95) continue; // outlier guard

      // Split source string and credit each source individually
      const rawSources = String(a._sources_combined || a.source || 'unknown')
        .toLowerCase()
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
      const sourceLabels = new Set();
      rawSources.forEach(rs => sourceLabels.add(getSourceMeta(rs).label));
      sourceLabels.forEach(label => perPick.push({ source: label, peakGainPct }));
    }

    // Aggregate per source
    const grouped = {};
    for (const row of perPick) {
      if (!grouped[row.source]) grouped[row.source] = [];
      grouped[row.source].push(row.peakGainPct);
    }
    const out = Object.entries(grouped)
      .filter(([, arr]) => arr.length >= 3)
      .map(([source, arr]) => {
        const sorted = [...arr].sort((a, b) => a - b);
        const avg = arr.reduce((s, v) => s + v, 0) / arr.length;
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
        // Hit-rate semantics flip with mode:
        //   peak     → % of picks that gained at least +10% / +20%
        //   drawdown → % of picks that dropped at least −10% / −20%
        const hit10 = isPeak
          ? (arr.filter(v => v >= 10).length / arr.length) * 100
          : (arr.filter(v => v <= -10).length / arr.length) * 100;
        const hit20 = isPeak
          ? (arr.filter(v => v >= 20).length / arr.length) * 100
          : (arr.filter(v => v <= -20).length / arr.length) * 100;
        const best = Math.max(...arr);
        const worst = Math.min(...arr);
        const meta = (() => {
          // Try to recover emoji/cls for the label by matching back through SOURCE_META
          for (const key of Object.keys(SOURCE_META)) {
            if (SOURCE_META[key].label === source) return SOURCE_META[key];
          }
          return SOURCE_META.unknown;
        })();
        return { source, count: arr.length, median, avg, hit10, hit20, best, worst, meta };
      });
    return out;
  }, [alerts, windowMode, isPeak]);

  // Always sort by median. Peak mode → highest median on top (best gains).
  // Drawdown mode → lowest median on top (deepest typical drop).
  const sorted = useMemo(() =>
    [...stats].sort((a, b) => isPeak ? b.median - a.median : a.median - b.median),
    [stats, isPeak]
  );

  const fmtPctSigned = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;
  const fmtPctRate = (v) => `${Math.round(v)}%`;
  // Color mapping is mode-aware:
  //   peak     → green = bigger gain
  //   drawdown → red = bigger drop
  const colorFor = (v) => {
    if (isPeak) {
      return v >= 15 ? '#22c55e' : v >= 5 ? '#84cc16' : v >= 0 ? '#f59e0b' : '#ef4444';
    }
    // Drawdown mode: 0 is amber, deeper red as drop worsens
    return v <= -15 ? '#ef4444' : v <= -5 ? '#f97316' : v <= 0 ? '#f59e0b' : '#22c55e';
  };
  // Hit-rate "alarm" color (drawdown only): high % is BAD for downside hit-rate
  const hitRateColorFor = (v) =>
    isPeak ? colorFor(v / 3) // re-use peak coloring scale
           : v >= 40 ? '#ef4444' : v >= 20 ? '#f97316' : v >= 10 ? '#f59e0b' : '#22c55e';

  const matureCount = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - 14);
    return (alerts || []).filter(a => a.alert_date && new Date(a.alert_date + 'T00:00:00') <= cutoff).length;
  }, [alerts]);

  // Mode-dependent UI strings
  const ui = isPeak ? {
    iconName: 'trophy',
    title: 'Source Performance — Peak Gain (14d)',
    subtitle: 'Sources ranked by median peak gain — the typical highest price each source\'s picks reached within 14 days of the alert. Picks credited to multiple sources count for each.',
    medianCol: 'Median peak',
    avgCol: 'Avg peak',
    hit10Col: 'Hit +10%',
    hit20Col: 'Hit +20%',
    bestCol: 'Best',
    worstCol: 'Worst',
    footnote: 'Median is the "typical pick" — half did better, half did worse. Average gets pulled by big winners; median is more honest.',
  } : {
    iconName: 'warning',
    title: 'Source Performance — Worst Drawdown (14d)',
    subtitle: 'Sources ranked worst-first by median drop — the typical lowest price each source\'s picks fell to within 14 days. Downside twin of Peak Gain.',
    medianCol: 'Median drop',
    avgCol: 'Avg drop',
    hit10Col: 'Hit \u{2212}10%',
    hit20Col: 'Hit \u{2212}20%',
    bestCol: 'Shallowest',
    worstCol: 'Deepest',
    footnote: 'Median drop is the "typical bottom" — half the source\'s picks fell further, half didn\'t.',
  };

  return (
    <div className="analytics-section">
      <h3 className="analytics-heading"><Ico name={ui.iconName} size={16} /> {ui.title}</h3>
      <p className="analytics-subtitle">{ui.subtitle}</p>

      <div className="spg-controls">
        <div className="spg-seg" role="tablist" aria-label="Sample window">
          <button
            type="button"
            className={windowMode === 'mature' ? 'on' : ''}
            onClick={() => setWindowMode('mature')}
          >Mature picks (14d+)</button>
          <button
            type="button"
            className={windowMode === 'all' ? 'on' : ''}
            onClick={() => setWindowMode('all')}
          >All picks</button>
        </div>
        <button
          type="button"
          className={`spg-help-btn${showHelp ? ' on' : ''}`}
          onClick={() => setShowHelp(v => !v)}
          aria-expanded={showHelp}
          aria-controls="spg-help-panel"
        >
          {showHelp ? '\u{2715} Hide help' : '? How to read this'}
        </button>
      </div>

      {showHelp && (
        <div id="spg-help-panel" className="spg-help-panel" role="region" aria-label="Glossary">
          <dl className="spg-help-dl">
            <dt>{isPeak ? 'Peak gain' : 'Drawdown'}</dt>
            <dd>{isPeak
              ? 'For each pick, the highest price the stock reached within 14 days of the alert, expressed as % above the entry price. Captures "did the AI catch a move?"'
              : 'For each pick, the lowest price the stock fell to within 14 days of the alert, expressed as % below the entry price. Captures "how painful was the dip before any rebound?"'}</dd>

            <dt>Median</dt>
            <dd>The "typical" pick — half a source's picks did {isPeak ? 'better' : 'worse'}, half did {isPeak ? 'worse' : 'better'}. More honest than the average because one giant {isPeak ? 'winner' : 'loser'} can't skew it.</dd>

            <dt>Average</dt>
            <dd>Plain mean across all the source's scored picks. Useful but easily pulled by outliers — a single +100% pick can lift a source's average 10 points.</dd>

            <dt>{isPeak ? 'Hit +10% / Hit +20%' : 'Hit \u{2212}10% / Hit \u{2212}20%'}</dt>
            <dd>{isPeak
              ? 'The % of a source’s picks that reached at least +10% (or +20%) at some point in the 14-day window. A "winners" rate.'
              : 'The % of a source’s picks that fell to −10% (or −20%) or worse at some point in the 14-day window. A "pain rate."'}</dd>

            <dt>{isPeak ? 'Best / Worst' : 'Shallowest / Deepest'}</dt>
            <dd>{isPeak
              ? 'The single best peak gain in the source’s history (Best) and the lowest peak gain — i.e. the pick that came closest to going nowhere (Worst).'
              : 'The shallowest drawdown is the source’s pick that dipped least; the deepest is the one that fell furthest.'}</dd>

            <dt>Mature picks (14d+)</dt>
            <dd>Only picks that are at least 14 days old, so every pick had a full window to {isPeak ? 'peak' : 'bottom'}. Fair apples-to-apples comparison.</dd>

            <dt>All picks</dt>
            <dd>Includes recent picks whose 14-day window isn't complete yet. Useful for early signals but not statistically comparable.</dd>

            <dt>Attribution</dt>
            <dd>If a pick was flagged by multiple sources (e.g. "wsb,apewisdom"), each source gets credit. Duplicate alert rows for the same ticker on the same day are merged before scoring.</dd>

            <dt>What's filtered out</dt>
            <dd>Picks with no price snapshots in the window. Outlier returns above +500% or below −95% (almost always entry-price data errors). Sources with fewer than 3 scorable picks.</dd>
          </dl>
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="spg-empty">
          {windowMode === 'mature' && matureCount === 0
            ? "No picks are at least 14 days old yet. Check back soon — or switch to 'All picks' for an early look."
            : "Not enough scored picks per source yet. Each source needs at least 3 picks with price data to appear here."}
        </div>
      ) : (
        <>
          {/* Leaderboard table — desktop layout. On <600px CSS reshapes
              each row into a 2-col mini-grid card using data-label attrs. */}
          <div className="spg-table-wrap">
            <table className="spg-table">
              <thead>
                <tr>
                  <th className="spg-th-source">Source</th>
                  <th>Picks</th>
                  <th>{ui.medianCol}</th>
                  <th>{ui.avgCol}</th>
                  <th>{ui.hit10Col}</th>
                  <th>{ui.hit20Col}</th>
                  <th>{ui.bestCol}</th>
                  <th>{ui.worstCol}</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(s => (
                  <tr key={s.source}>
                    <td className="spg-td-source" data-label="Source">
                      <span className={`source-badge-sm ${s.meta.cls}`}><Ico name={s.meta.icon} /> {s.source}</span>
                    </td>
                    <td data-label="Picks">{s.count}</td>
                    <td data-label={ui.medianCol} style={{ color: colorFor(s.median), fontWeight: 700 }}>{fmtPctSigned(s.median)}</td>
                    <td data-label={ui.avgCol} style={{ color: colorFor(s.avg), fontWeight: 700 }}>{fmtPctSigned(s.avg)}</td>
                    <td data-label={ui.hit10Col}>{fmtPctRate(s.hit10)}</td>
                    <td data-label={ui.hit20Col} style={{ color: hitRateColorFor(s.hit20), fontWeight: 700 }}>{fmtPctRate(s.hit20)}</td>
                    <td data-label={ui.bestCol} className={isPeak ? 'spg-pos' : ''}>{fmtPctSigned(s.best)}</td>
                    <td data-label={ui.worstCol} className={s.worst < 0 ? 'spg-neg' : ''}>{fmtPctSigned(s.worst)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="spg-foot">{ui.footnote}</div>
        </>
      )}
    </div>
  );
}

// ── Analytics Tab Component ──
function AnalyticsTab({ alerts }) {
  // Source performance analysis
  const sourceStats = useMemo(() => {
    const stats = {};
    alerts.forEach(a => {
      const src = getSourceMeta(a.source);
      const key = src.label;
      if (!stats[key]) stats[key] = { total: 0, wins: 0, losses: 0, neutral: 0, avgPct: 0, totalPct: 0, thumbsUp: 0, thumbsDown: 0, icon: src.icon, cls: src.cls };
      stats[key].total++;
      const latest = a.prices[a.prices.length - 1];
      const pct = latest?.pct_change || 0;
      stats[key].totalPct += pct;
      const s = getStatus(pct);
      if (s === 'win') stats[key].wins++;
      else if (s === 'loss') stats[key].losses++;
      else stats[key].neutral++;
      if (a.user_rating === 'up') stats[key].thumbsUp++;
      if (a.user_rating === 'down') stats[key].thumbsDown++;
    });
    Object.keys(stats).forEach(k => {
      stats[k].avgPct = stats[k].total > 0 ? stats[k].totalPct / stats[k].total : 0;
      stats[k].winRate = stats[k].total > 0 ? (stats[k].wins / stats[k].total * 100) : 0;
    });
    return stats;
  }, [alerts]);

  // Best and worst performing sources
  const sortedSources = Object.entries(sourceStats).sort((a, b) => b[1].winRate - a[1].winRate);

  return (
    <div className="analytics-content">
      {/* Peak-gain leaderboard (best moment within 14 days of alert) */}
      <SourcePerformanceLeaderboard alerts={alerts} mode="peak" />

      {/* Worst-drawdown leaderboard (worst moment within 14 days of alert) */}
      <SourcePerformanceLeaderboard alerts={alerts} mode="drawdown" />

      {/* Source Performance (latest price vs entry) */}
      <div className="analytics-section">
        <h3 className="analytics-heading">{"\u{1F4E1}"} Source Performance — Current Return</h3>
        <p className="analytics-subtitle">Latest price vs entry, plus your thumbs ratings</p>
        <div className="source-stats-grid">
          {sortedSources.map(([name, stats]) => (
            <div key={name} className="source-stat-card">
              <div className="source-stat-header">
                <span className={`source-badge-sm ${stats.cls}`}><Ico name={stats.icon} /> {name}</span>
                <span className="source-stat-count">{stats.total} picks</span>
              </div>
              <div className="source-stat-metrics">
                <div className="source-metric">
                  <span className="source-metric-value" style={{ color: '#22c55e' }}>{stats.winRate.toFixed(0)}%</span>
                  <span className="source-metric-label">Win Rate</span>
                </div>
                <div className="source-metric">
                  <span className={`source-metric-value ${stats.avgPct >= 0 ? 'pct-pos' : 'pct-neg'}`}>{fmtPct(stats.avgPct)}</span>
                  <span className="source-metric-label">Avg Return</span>
                </div>
                <div className="source-metric">
                  <span className="source-metric-value">{stats.wins}/{stats.losses}/{stats.neutral}</span>
                  <span className="source-metric-label">W / L / N</span>
                </div>
              </div>
              <div className="source-stat-bar">
                <div className="bar-win" style={{ width: `${stats.total > 0 ? (stats.wins / stats.total * 100) : 0}%` }}></div>
                <div className="bar-neutral" style={{ width: `${stats.total > 0 ? (stats.neutral / stats.total * 100) : 0}%` }}></div>
                <div className="bar-loss" style={{ width: `${stats.total > 0 ? (stats.losses / stats.total * 100) : 0}%` }}></div>
              </div>
              {(stats.thumbsUp > 0 || stats.thumbsDown > 0) && (
                <div className="source-ratings-row">
                  <span className="source-rating-item">{"\u{1F44D}"} {stats.thumbsUp}</span>
                  <span className="source-rating-item">{"\u{1F44E}"} {stats.thumbsDown}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}

// ══════════════════════════════════════
// ═══ MAIN DASHBOARD ═══
// ══════════════════════════════════════
// ── Paper Trade Buy Modal ──
function BuyTradeModal({ alert, currentPrice, onClose, onConfirm }) {
  const [amount, setAmount] = useState('500');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const amountNum = parseFloat(amount) || 0;
  const shares = currentPrice > 0 ? amountNum / currentPrice : 0;

  const handleConfirm = async () => {
    if (amountNum <= 0) {
      setError('Enter a dollar amount greater than 0');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onConfirm({ amount: amountNum, notes });
    } catch (e) {
      setError(e.message || 'Failed to save trade');
      setSaving(false);
    }
  };

  return (
    <div className="pt-modal-backdrop" onClick={onClose}>
      <div className="pt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pt-modal-header">
          <h3>{"\u{1F4B0}"} Paper Buy <span className="pt-modal-ticker">{alert.ticker}</span></h3>
          <button className="pt-modal-close" onClick={onClose}>{"\u{2715}"}</button>
        </div>
        <div className="pt-modal-body">
          <div className="pt-modal-row">
            <span className="pt-modal-label">Company</span>
            <span className="pt-modal-value">{alert.company}</span>
          </div>
          <div className="pt-modal-row">
            <span className="pt-modal-label">Current price</span>
            <span className="pt-modal-value pt-price">${currentPrice.toFixed(2)}</span>
          </div>
          <div className="pt-modal-row">
            <span className="pt-modal-label">AI rec</span>
            <span className={`rec-chip ${recClass(alert.recommendation || 'HOLD')}`}>{recLabel(alert.recommendation || 'HOLD')}</span>
          </div>

          <div className="pt-modal-input-group">
            <label>Amount to invest ($)</label>
            <div className="pt-amount-input-wrap">
              <span className="pt-amount-prefix">$</span>
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                min="1"
                step="any"
                autoFocus
              />
            </div>
            <div className="pt-amount-presets">
              {[100, 500, 1000, 5000].map(v => (
                <button key={v} type="button" onClick={() => setAmount(String(v))}>${v}</button>
              ))}
            </div>
          </div>

          <div className="pt-modal-summary">
            <div className="pt-summary-row">
              <span>Shares (fractional)</span>
              <span>{shares.toFixed(4)}</span>
            </div>
            <div className="pt-summary-row">
              <span>Position cost</span>
              <span className="pt-price">${amountNum.toFixed(2)}</span>
            </div>
          </div>

          <div className="pt-modal-input-group">
            <label>Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Why are you buying? e.g. 'Strong signal + momentum setup'"
              rows={2}
            />
          </div>

          {error && <div className="pt-modal-error">{error}</div>}
        </div>
        <div className="pt-modal-footer">
          <button className="pt-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="pt-btn-primary" onClick={handleConfirm} disabled={saving || amountNum <= 0}>
            {saving ? 'Saving...' : `\u{1F4C8} Buy $${amountNum.toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Paper Trade Sell Modal ──
function SellTradeModal({ trade, currentPrice, onClose, onConfirm }) {
  const [price, setPrice] = useState(currentPrice > 0 ? currentPrice.toFixed(2) : '');
  const [verdict, setVerdict] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const priceNum = parseFloat(price) || 0;
  const exitAmount = priceNum * parseFloat(trade.shares);
  const pnl = exitAmount - parseFloat(trade.entry_amount);
  const pnlPct = trade.entry_amount > 0 ? (pnl / parseFloat(trade.entry_amount)) * 100 : 0;

  const handleConfirm = async () => {
    if (priceNum <= 0) {
      setError('Enter a sell price greater than 0');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onConfirm({
        price: priceNum,
        ai_review_verdict: verdict || null,
        ai_review_notes: reviewNotes.trim() || null,
      });
    } catch (e) {
      setError(e.message || 'Failed to close trade');
      setSaving(false);
    }
  };

  const verdictOptions = [
    { value: 'right', label: '\u2705 Right', hint: 'AI nailed the call' },
    { value: 'partial', label: '\u{1F7E1} Partial', hint: 'Partly right' },
    { value: 'wrong', label: '\u274C Wrong', hint: 'AI was off' },
    { value: 'unclear', label: '\u2754 Unclear', hint: 'Hard to say' },
  ];

  return (
    <div className="pt-modal-backdrop" onClick={onClose}>
      <div className="pt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pt-modal-header">
          <h3>{"\u{1F4B8}"} Paper Sell <span className="pt-modal-ticker">{trade.ticker}</span></h3>
          <button className="pt-modal-close" onClick={onClose}>{"\u{2715}"}</button>
        </div>
        <div className="pt-modal-body">
          <div className="pt-modal-row">
            <span className="pt-modal-label">Bought</span>
            <span className="pt-modal-value">{parseFloat(trade.shares).toFixed(4)} sh @ ${parseFloat(trade.entry_price).toFixed(2)}</span>
          </div>
          <div className="pt-modal-row">
            <span className="pt-modal-label">Invested</span>
            <span className="pt-modal-value pt-price">${parseFloat(trade.entry_amount).toFixed(2)}</span>
          </div>
          <div className="pt-modal-row">
            <span className="pt-modal-label">Current market price</span>
            <span className="pt-modal-value pt-price">${currentPrice.toFixed(2)}</span>
          </div>

          <div className="pt-modal-input-group">
            <label>Sell price ($)</label>
            <div className="pt-amount-input-wrap">
              <span className="pt-amount-prefix">$</span>
              <input
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                min="0.01"
                step="0.01"
                autoFocus
              />
            </div>
            <button type="button" className="pt-use-market" onClick={() => setPrice(currentPrice.toFixed(2))}>
              Use current market price
            </button>
          </div>

          <div className="pt-modal-summary">
            <div className="pt-summary-row">
              <span>Proceeds</span>
              <span className="pt-price">${exitAmount.toFixed(2)}</span>
            </div>
            <div className="pt-summary-row">
              <span>Profit / Loss</span>
              <span className={pnl >= 0 ? 'pct-pos' : 'pct-neg'}>
                {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
              </span>
            </div>
          </div>

          {/* Post-trade AI review — feedback loop */}
          <div className="pt-review-block">
            <div className="pt-review-title">
              {"\u{1F3AF}"} Post-trade review
              <span className="pt-review-optional">optional</span>
            </div>
            <div className="pt-review-sub">
              Looking back, was the AI recommendation at entry right?
              {trade.ai_recommendation_at_entry && (
                <> AI said <strong>{recLabel(trade.ai_recommendation_at_entry)}</strong>
                {trade.signal_strength_at_entry != null && (
                  <> &middot; strength <strong>{Math.round(parseFloat(trade.signal_strength_at_entry))}/100</strong></>
                )}.</>
              )}
            </div>
            <div className="pt-review-chips">
              {verdictOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`pt-review-chip ${verdict === opt.value ? 'selected' : ''}`}
                  onClick={() => setVerdict(verdict === opt.value ? '' : opt.value)}
                  title={opt.hint}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <label className="pt-review-notes-label">
              Lesson / what happened <span className="pt-review-optional">optional</span>
            </label>
            <textarea
              className="pt-review-notes"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="What did we learn? e.g. 'social surge faded without volume follow-through — wait for confirmation'"
              rows={3}
            />
          </div>

          {error && <div className="pt-modal-error">{error}</div>}
        </div>
        <div className="pt-modal-footer">
          <button className="pt-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="pt-btn-primary" onClick={handleConfirm} disabled={saving || priceNum <= 0}>
            {saving ? 'Closing...' : `\u{1F4B0} Sell @ $${priceNum.toFixed(2)}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Stock Card Modal ─────────────────────────────────────────
// Pops the live AlertCard for a ticker over the Portfolio tab so the user
// can review the latest AI recommendation for a position without losing
// their place. Falls back to a graceful "no live data" message if the AI
// no longer tracks this ticker (e.g. closed trade in a stock that's been
// dropped from the daily scan).
function StockCardModal({
  ticker, alerts, prices, watchlist, userNote, openPosition, onClose,
  onToggleWatchlist, onRate, onDismiss, onSaveNote, onOpenBuyModal, onOpenSellModal,
  // Optional. When undefined (legacy callers), the AlertCard simply hides
  // its sector chip — same fallback the main grid uses for unclassified rows.
  tickerMeta,
  // NEW (Phase 5): forward to AlertCard for the "+ Track" button
  onOpenAddSheet, serverWatchlist,
}) {
  // Close on Escape key.
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const alert = alerts.find(a => a.ticker === ticker) || null;
  const livePrice = prices?.[ticker]?.price;

  return (
    <div className="card-modal-backdrop" onClick={onClose}>
      <div className="card-modal" onClick={(e) => e.stopPropagation()}>
        <div className="card-modal-header">
          <div className="card-modal-title">
            <span className="card-modal-icon">{"\u{1F4C7}"}</span>
            <span>Live AI card</span>
            <span className="card-modal-ticker">{ticker}</span>
            {livePrice != null && (
              <span className="card-modal-price">${livePrice.toFixed(2)}</span>
            )}
          </div>
          <button className="card-modal-close" onClick={onClose} aria-label="Close">
            {"\u{2715}"}
          </button>
        </div>
        <div className="card-modal-body">
          {alert ? (
            <AlertCard
              alert={alert}
              index={0}
              sectionPrefix={`portfolio-modal-${ticker}`}
              watchlist={watchlist}
              sharedPrices={prices}
              forceCompact={false}
              forceCompactNonce={0}
              onToggleWatchlist={onToggleWatchlist}
              onRate={onRate}
              onDismiss={onDismiss}
              onSaveNote={onSaveNote}
              userNote={userNote}
              openPosition={openPosition}
              onOpenBuyModal={onOpenBuyModal}
              onOpenSellModal={onOpenSellModal}
              tickerMeta={tickerMeta}
              onOpenAddSheet={onOpenAddSheet}
              serverWatchlist={serverWatchlist}
            />
          ) : (
            <div className="card-modal-empty">
              <p>
                {"\u{1F4ED}"} The AI doesn&rsquo;t have an active card for <strong>{ticker}</strong> right now.
              </p>
              <p style={{ marginTop: 8, color: '#7a9bc0', fontSize: '0.88rem' }}>
                This usually means the stock isn&rsquo;t in your watchlist yet, or it&rsquo;s been dropped from the daily scan.
                You can still track it — choose an option below.
              </p>
              {onOpenAddSheet && (
                <div className="card-modal-empty-actions">
                  <button
                    className="card-modal-empty-primary"
                    onClick={() => {
                      onOpenAddSheet({ ticker, company: null, alert: null });
                      onClose();
                    }}
                  >
                    {"\u{2795}"} Track {ticker}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Post-trade review verdict helpers ──
function verdictEmoji(v) {
  return v === 'right' ? '\u2705'
    : v === 'wrong' ? '\u274C'
    : v === 'partial' ? '\u{1F7E1}'
    : v === 'unclear' ? '\u2754'
    : '';
}
function verdictLabel(v) {
  return v === 'right' ? 'Right'
    : v === 'wrong' ? 'Wrong'
    : v === 'partial' ? 'Partial'
    : v === 'unclear' ? 'Unclear'
    : '\u2014';
}

// ── Expandable row drawer shown under a portfolio position ──
// ── Closed Trade 3-Point Chart ─────────────────────────────────
// Three connected points: Entry → Exit → Today. The Entry→Exit segment
// is colored by realized P/L (green if you made money, red if not).
// The Exit→Today segment is muted grey — it's the "had I held" tail
// so you can reflect on whether you sold too early or just in time.
// `today` may be null (price not in current_prices map for this ticker);
// in that case we render a 2-point chart and skip the muted tail.
function ClosedTradeChart({ entryPrice, entryDate, exitPrice, exitDate, todayPrice, todayDate }) {
  const fmtDate = (d) => {
    if (!d) return '—';
    try {
      const parsed = typeof d === 'string' ? new Date(d.length <= 10 ? d + 'T00:00:00' : d) : new Date(d);
      return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return String(d); }
  };

  const points = [
    { label: 'Entry', date: entryDate, price: entryPrice },
    { label: 'Exit',  date: exitDate,  price: exitPrice  },
  ];
  if (todayPrice != null && !Number.isNaN(todayPrice)) {
    points.push({ label: 'Today', date: todayDate || new Date().toISOString(), price: todayPrice });
  }

  const W = 560, H = 160;
  const PAD_X = 56, PAD_TOP = 22, PAD_BOTTOM = 38;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_TOP - PAD_BOTTOM;

  const prices = points.map(p => p.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  // Pad min/max by 6% so points don't kiss the top/bottom of the chart.
  const range = (max - min) || Math.max(1, max * 0.05);
  const lo = min - range * 0.12;
  const hi = max + range * 0.12;
  const span = hi - lo || 1;

  const xAt = (i) => PAD_X + (points.length === 1 ? innerW / 2 : (innerW / (points.length - 1)) * i);
  const yAt = (price) => PAD_TOP + innerH - ((price - lo) / span) * innerH;

  const realizedPct = entryPrice > 0 ? ((exitPrice - entryPrice) / entryPrice) * 100 : 0;
  const realizedPos = realizedPct >= 0;
  const realizedColor = realizedPos ? '#22c55e' : '#ef4444';

  const heldPct = (todayPrice != null && entryPrice > 0)
    ? ((todayPrice - entryPrice) / entryPrice) * 100
    : null;

  return (
    <div className="ct-chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} className="ct-chart-svg" preserveAspectRatio="xMidYMid meet">
        {/* Faint baseline at entry price for visual reference */}
        <line
          x1={PAD_X} x2={W - PAD_X}
          y1={yAt(entryPrice)} y2={yAt(entryPrice)}
          stroke="rgba(122,155,192,0.18)" strokeWidth="1" strokeDasharray="3,4"
        />

        {/* Entry → Exit segment (colored) */}
        <line
          x1={xAt(0)} y1={yAt(points[0].price)}
          x2={xAt(1)} y2={yAt(points[1].price)}
          stroke={realizedColor} strokeWidth="2.5" strokeLinecap="round"
        />

        {/* Exit → Today segment (muted) */}
        {points.length === 3 && (
          <line
            x1={xAt(1)} y1={yAt(points[1].price)}
            x2={xAt(2)} y2={yAt(points[2].price)}
            stroke="rgba(122,155,192,0.55)"
            strokeWidth="1.8"
            strokeDasharray="4,3"
            strokeLinecap="round"
          />
        )}

        {/* Points */}
        {points.map((p, i) => {
          const isExit = i === 1;
          const isToday = i === 2;
          const fill = isToday ? '#7a9bc0' : (isExit ? realizedColor : '#9fc5f0');
          const stroke = '#0a1728';
          return (
            <g key={p.label}>
              <circle cx={xAt(i)} cy={yAt(p.price)} r="6" fill={fill} stroke={stroke} strokeWidth="2.5" />
              {/* Price label above the point */}
              <text
                x={xAt(i)}
                y={yAt(p.price) - 12}
                textAnchor="middle"
                fontSize="12"
                fontWeight="700"
                fill="#e6f3ff"
                fontFamily="'SF Mono', Consolas, monospace"
              >${p.price.toFixed(2)}</text>
              {/* Stage label below */}
              <text
                x={xAt(i)}
                y={H - 18}
                textAnchor="middle"
                fontSize="11"
                fontWeight="700"
                fill={isToday ? '#7a9bc0' : '#a0c0dc'}
                letterSpacing="0.5"
              >{p.label.toUpperCase()}</text>
              {/* Date below stage */}
              <text
                x={xAt(i)}
                y={H - 4}
                textAnchor="middle"
                fontSize="10"
                fill="#6a89a8"
              >{fmtDate(p.date)}</text>
            </g>
          );
        })}
      </svg>

      {/* Pct readout strip — keeps the math front-and-center */}
      <div className="ct-chart-stats">
        <div className="ct-chart-stat">
          <div className="ct-chart-stat-label">Realized (Entry → Exit)</div>
          <div className={`ct-chart-stat-value ${realizedPos ? 'pct-pos' : 'pct-neg'}`}>
            {realizedPos ? '+' : ''}{realizedPct.toFixed(2)}%
          </div>
        </div>
        {heldPct != null && (
          <div className="ct-chart-stat">
            <div className="ct-chart-stat-label">Had I held (Entry → Today)</div>
            <div className={`ct-chart-stat-value ${heldPct >= 0 ? 'pct-pos' : 'pct-neg'}`}>
              {heldPct >= 0 ? '+' : ''}{heldPct.toFixed(2)}%
            </div>
          </div>
        )}
        {heldPct != null && (() => {
          // Positive = exit was a win (selling beat holding by X points).
          // Negative = sold too early (holding would've beat selling).
          // Flipping the sign so the number's color/sign matches the label.
          const exitEdge = realizedPct - heldPct;
          const isGoodExit = exitEdge > 0;
          const isEven = exitEdge === 0;
          return (
            <div className="ct-chart-stat">
              <div className="ct-chart-stat-label">
                {isEven ? 'Even' : isGoodExit ? 'Good exit — saved you' : 'Sold too early — missed'}
              </div>
              <div className={`ct-chart-stat-value ${exitEdge >= 0 ? 'pct-pos' : 'pct-neg'}`}>
                {exitEdge >= 0 ? '+' : ''}{exitEdge.toFixed(2)}%
                <span className="ct-chart-stat-sub"> {isGoodExit ? 'vs. holding' : 'in upside'}</span>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

function TradeDetailDrawer({ trade, onUpdateReview, currentPrice, currentPriceDate }) {
  const isClosed = trade.status === 'closed';

  // Editable review state (for closed trades only).
  const [verdict, setVerdict] = useState(trade.ai_review_verdict || '');
  const [reviewNotes, setReviewNotes] = useState(trade.ai_review_notes || '');
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const dirty = (verdict || '') !== (trade.ai_review_verdict || '')
    || (reviewNotes || '') !== (trade.ai_review_notes || '');

  const handleSave = async () => {
    if (!onUpdateReview) return;
    setSaving(true);
    setSavedMsg('');
    try {
      await onUpdateReview(trade.id, {
        verdict: verdict || null,
        notes: reviewNotes.trim() || null,
      });
      setSavedMsg('Saved');
      setTimeout(() => setSavedMsg(''), 1800);
    } catch (e) {
      setSavedMsg('Failed: ' + (e.message || 'unknown'));
    } finally {
      setSaving(false);
    }
  };

  const strength = trade.signal_strength_at_entry != null
    ? Math.round(parseFloat(trade.signal_strength_at_entry))
    : null;
  const rec = trade.ai_recommendation_at_entry || null;
  const mcap = trade.market_cap_at_entry != null
    ? parseFloat(trade.market_cap_at_entry)
    : null;
  const formatMcap = (m) => m == null ? null
    : m >= 1000 ? `$${(m / 1000).toFixed(2)}B`
    : m >= 1 ? `$${m.toFixed(2)}B`
    : `$${(m * 1000).toFixed(0)}M`;

  const verdictOptions = [
    { value: 'right', label: '\u2705 Right' },
    { value: 'partial', label: '\u{1F7E1} Partial' },
    { value: 'wrong', label: '\u274C Wrong' },
    { value: 'unclear', label: '\u2754 Unclear' },
  ];

  return (
    <div className="pt-drawer">
      {/* Closed-trade-only: Entry → Exit → Today price chart */}
      {isClosed && (
        <section className="pt-drawer-section pt-drawer-chart">
          <div className="pt-drawer-heading">
            {"\u{1F4CA}"} Price journey
            <span className="pt-drawer-frozen">entry &#8594; exit &#8594; today</span>
          </div>
          <ClosedTradeChart
            entryPrice={parseFloat(trade.entry_price)}
            entryDate={trade.entry_date}
            exitPrice={parseFloat(trade.exit_price)}
            exitDate={trade.exit_date}
            todayPrice={currentPrice != null && !Number.isNaN(currentPrice) ? currentPrice : null}
            todayDate={currentPriceDate || new Date().toISOString()}
          />
          {currentPrice == null && (
            <p className="pt-drawer-empty" style={{ marginTop: 8 }}>
              Today's price isn't available for {trade.ticker} yet — chart shows entry vs. exit only.
            </p>
          )}
        </section>
      )}

      <div className="pt-drawer-grid">
        {/* 1. Your notes */}
        <section className="pt-drawer-section">
          <div className="pt-drawer-heading">{"\u{1F4DD}"} Your notes at buy</div>
          {trade.notes && trade.notes.trim() ? (
            <p className="pt-drawer-note">{trade.notes}</p>
          ) : (
            <p className="pt-drawer-empty">No notes captured at buy.</p>
          )}
        </section>

        {/* 2. AI reasoning at entry (frozen snapshot) */}
        <section className="pt-drawer-section">
          <div className="pt-drawer-heading">
            {"\u{1F916}"} AI reasoning @ entry
            <span className="pt-drawer-frozen" title="Frozen snapshot from the moment you bought — won't change if the AI re-rates the stock.">snapshot</span>
          </div>
          <div className="pt-drawer-chips">
            {rec && <span className={`rec-chip ${recClass(rec)}`}>{recLabel(rec)}</span>}
            {strength != null && <span className="pt-drawer-chip">Strength {strength}/100</span>}
            {trade.signal_type_at_entry && <span className="pt-drawer-chip">{trade.signal_type_at_entry}</span>}
            {trade.source_at_entry && <span className="pt-drawer-chip">{trade.source_at_entry}</span>}
            {mcap != null && <span className="pt-drawer-chip">Mcap {formatMcap(mcap)}</span>}
            {trade.forecast_sell_date_at_entry && (
              <span className="pt-drawer-chip">
                Target sell: {new Date(trade.forecast_sell_date_at_entry).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
          {trade.recommendation_reason_at_entry && (
            <div className="pt-drawer-reason">
              <div className="pt-drawer-reason-label">Why BUY:</div>
              <p>{trade.recommendation_reason_at_entry}</p>
            </div>
          )}
          {trade.alert_reason_at_entry && (
            <div className="pt-drawer-reason">
              <div className="pt-drawer-reason-label">Catalyst / signal:</div>
              <p>{trade.alert_reason_at_entry}</p>
            </div>
          )}
          {!trade.recommendation_reason_at_entry && !trade.alert_reason_at_entry && (
            <p className="pt-drawer-empty">No AI reasoning captured for this entry.</p>
          )}
        </section>

        {/* 3. Post-trade review — only for closed trades */}
        {isClosed && (
          <section className="pt-drawer-section pt-drawer-review">
            <div className="pt-drawer-heading">
              {"\u{1F3AF}"} Post-trade review
              <span className="pt-drawer-frozen">feedback loop</span>
            </div>
            <div className="pt-drawer-sub">
              Looking back, was the AI call at entry right? Your notes feed back into tuning future picks.
            </div>
            <div className="pt-review-chips">
              {verdictOptions.map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  className={`pt-review-chip ${verdict === opt.value ? 'selected' : ''}`}
                  onClick={() => setVerdict(verdict === opt.value ? '' : opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <textarea
              className="pt-review-notes"
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="What did we learn? (e.g. social surge faded without volume follow-through)"
              rows={3}
            />
            <div className="pt-drawer-review-actions">
              <button
                className="pt-btn-primary"
                disabled={!dirty || saving}
                onClick={handleSave}
              >
                {saving ? 'Saving\u2026' : 'Save review'}
              </button>
              {savedMsg && <span className="pt-drawer-saved">{savedMsg}</span>}
              {trade.ai_review_at && !dirty && (
                <span className="pt-drawer-saved-at">
                  Last reviewed {new Date(trade.ai_review_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

// ── Portfolio Tab ──
function PortfolioTab({ trades, alerts, prices, pricesAsOf, pricesRefreshing, onRefreshPrices, onSell, onDelete, onBuyFromWatchlist, onUpdateReview, onOpenCard }) {
  const [expandedId, setExpandedId] = useState(null);
  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id);

  // Prefer the shared current_prices map (single source of truth, fresh
  // for every ticker including dropped ones). Fall back to the viewer's
  // alerts feed only if a ticker is missing from the map (first run
  // before backfill, or an unknown ticker).
  const getLatest = (ticker) => {
    const live = prices?.[ticker]?.price;
    if (live != null && !Number.isNaN(live)) return live;
    const alert = alerts.find(a => a.ticker === ticker);
    if (!alert) return null;
    const last = alert.prices[alert.prices.length - 1];
    return last?.price ?? parseFloat(alert.price_at_alert);
  };

  // Look up the matching alert (live AI view) for a ticker. Returns null if the
  // AI no longer tracks it (e.g. dropped with no re-scan).
  const getAlert = (ticker) => alerts.find(a => a.ticker === ticker) || null;

  // Live recommendation: what the AI would say RIGHT NOW. Falls back to the
  // frozen entry rec only when we have no live alert for the ticker.
  const getLiveRec = (trade) => {
    const a = getAlert(trade.ticker);
    if (a && a.recommendation) return String(a.recommendation).toUpperCase();
    return trade.ai_recommendation_at_entry || 'HOLD';
  };

  // True if the live price has broken below the AI's stop-loss level.
  const isStopHit = (ticker) => {
    const a = getAlert(ticker);
    if (!a || a.stop_loss == null) return false;
    const p = getLatest(ticker);
    return p != null && p <= parseFloat(a.stop_loss);
  };

  const openTrades = trades.filter(t => t.status === 'open');
  const closedTrades = trades.filter(t => t.status === 'closed');

  // Summary: realized + unrealized
  // We split capital into two buckets so ROI is honest:
  //   - "Open" bucket   = currently deployed (open positions' entry amounts)
  //   - "Closed" bucket = capital that's been recycled out via sells
  // Lumping them together (the old "$22k Total Invested" stat) misled the
  // user because the same $2k slot was double-counted across multiple trades.
  const realizedPnl = closedTrades.reduce((sum, t) =>
    sum + (parseFloat(t.exit_amount) - parseFloat(t.entry_amount)), 0);
  const unrealizedPnl = openTrades.reduce((sum, t) => {
    const latest = getLatest(t.ticker);
    if (latest == null) return sum;
    return sum + (latest * parseFloat(t.shares) - parseFloat(t.entry_amount));
  }, 0);
  const openInvested = openTrades.reduce((s, t) => s + parseFloat(t.entry_amount), 0);
  const closedInvested = closedTrades.reduce((s, t) => s + parseFloat(t.entry_amount), 0);
  const closedProceeds = closedTrades.reduce((s, t) => s + parseFloat(t.exit_amount), 0);
  const totalInvested = openInvested + closedInvested;
  const currentOpenValue = openTrades.reduce((s, t) => {
    const latest = getLatest(t.ticker);
    return s + (latest != null ? latest * parseFloat(t.shares) : parseFloat(t.entry_amount));
  }, 0);
  // ROI on each bucket, computed against THAT bucket's deployed capital
  // (not against the all-time sum). This is the apples-to-apples number.
  const openRoiPct = openInvested > 0 ? (unrealizedPnl / openInvested) * 100 : 0;
  const closedRoiPct = closedInvested > 0 ? (realizedPnl / closedInvested) * 100 : 0;
  const totalPnl = realizedPnl + unrealizedPnl;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  // ── Time-on-market + annualized return ────────────────────────
  // Days from the earliest entry to today gives us a denominator for
  // converting the all-time ROI into an annualized rate. We use CAGR
  // (compound) rather than simple linear extrapolation because that's
  // the industry-standard apples-to-apples metric — same formula a
  // brokerage would quote for "annualized return".
  // Short windows (<7 days) produce silly numbers like "+1,400%
  // annualized" off a 2% gain, so we suppress the annualized chip in
  // that case and just show "too early to annualize".
  const earliestEntryMs = trades.length > 0
    ? Math.min(...trades.map(t => new Date(t.entry_date).getTime()))
    : null;
  const daysTrading = earliestEntryMs != null
    ? Math.max(1, Math.floor((Date.now() - earliestEntryMs) / 86400000))
    : 0;
  const formatTimeSpan = (d) => {
    if (d < 14) return `${d} day${d === 1 ? '' : 's'}`;
    if (d < 60) return `${Math.round(d / 7)} weeks`;
    if (d < 365) return `${Math.round(d / 30)} months`;
    const years = (d / 365).toFixed(1);
    return `${years} year${years === '1.0' ? '' : 's'}`;
  };
  // CAGR: (1 + r)^(365/days) - 1.  Cap inputs to avoid Math.pow blowing
  // up on -100%+ losses (you can't lose more than your basis).
  const annualizedPct = (() => {
    if (daysTrading < 7 || totalInvested <= 0) return null;
    const r = Math.max(-0.9999, totalPnlPct / 100);
    const annualized = Math.pow(1 + r, 365 / daysTrading) - 1;
    return annualized * 100;
  })();

  const wins = closedTrades.filter(t => parseFloat(t.exit_amount) > parseFloat(t.entry_amount)).length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;

  // AI accuracy breakdown: P/L by recommendation at entry
  const byRec = { BUY: [], HOLD: [], SELL: [] };
  trades.forEach(t => {
    const rec = t.ai_recommendation_at_entry || 'HOLD';
    const latest = t.status === 'closed' ? parseFloat(t.exit_price) : getLatest(t.ticker);
    if (latest == null) return;
    const pnlPct = ((latest - parseFloat(t.entry_price)) / parseFloat(t.entry_price)) * 100;
    if (byRec[rec]) byRec[rec].push(pnlPct);
  });
  const avgOf = (arr) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null;

  const daysHeld = (t) => {
    const start = new Date(t.entry_date);
    const end = t.status === 'closed' ? new Date(t.exit_date) : new Date();
    return Math.max(0, Math.floor((end - start) / 86400000));
  };
  const fmt$ = (v) => (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2);
  const fmtDate = (d) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // Find the freshest price timestamp across currently-held tickers.
  // Used in the "Prices updated …" label next to the Refresh button.
  const pricesFreshestAt = (() => {
    const tickersHeld = new Set(openTrades.map(t => t.ticker));
    let freshest = null;
    for (const tk of tickersHeld) {
      const ts = prices?.[tk]?.updated_at;
      if (!ts) continue;
      if (!freshest || new Date(ts) > new Date(freshest)) freshest = ts;
    }
    return freshest || pricesAsOf || null;
  })();

  const fmtAgo = (iso) => {
    if (!iso) return '—';
    const diff = Math.max(0, Date.now() - new Date(iso).getTime());
    const s = Math.round(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h ago`;
    return new Date(iso).toLocaleString();
  };

  // Are US markets open right now? Mon-Fri 9:30 AM - 4:00 PM ET.
  // We don't bother with US holidays — the worst case is we show an
  // amber "stale" badge on, say, July 4, which is harmless.
  const isUSMarketOpen = () => {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
    const wd = parts.weekday;
    if (wd === 'Sat' || wd === 'Sun') return false;
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return minutes >= (9 * 60 + 30) && minutes < (16 * 60);
  };

  // Stale = freshest update more than 30 min ago during market hours,
  // OR more than 24h ago at any time. Either way, the user should see
  // an amber chip and consider clicking Refresh.
  const stalenessMs = pricesFreshestAt
    ? Date.now() - new Date(pricesFreshestAt).getTime()
    : null;
  const isStale =
    stalenessMs != null &&
    ((isUSMarketOpen() && stalenessMs > 30 * 60 * 1000) ||
      stalenessMs > 24 * 60 * 60 * 1000);

  return (
    <div className="portfolio-tab">
      {/* Prices refresh bar */}
      {onRefreshPrices && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 12,
            margin: '0 0 12px',
            fontSize: '0.85rem',
            color: isStale ? '#f5a623' : '#7a9bc0',
          }}
        >
          <span
            title={
              isStale
                ? `Prices last updated ${fmtAgo(pricesFreshestAt)} — click Refresh to fetch the latest from Yahoo Finance.`
                : pricesFreshestAt || ''
            }
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: isStale ? '4px 10px' : 0,
              borderRadius: 6,
              background: isStale ? 'rgba(245, 166, 35, 0.12)' : 'transparent',
              border: isStale ? '1px solid rgba(245, 166, 35, 0.4)' : 'none',
              fontWeight: isStale ? 600 : 400,
            }}
          >
            {isStale && <Ico name="warning" size={13} style={{ color: '#f5a623' }} />}
            {isStale ? 'Prices may be stale — last updated' : 'Prices updated'}{' '}
            {fmtAgo(pricesFreshestAt)}
          </span>
          <button
            type="button"
            onClick={onRefreshPrices}
            disabled={pricesRefreshing}
            style={{
              padding: '6px 12px',
              background: 'rgba(97, 175, 254, 0.15)',
              border: '1px solid rgba(97, 175, 254, 0.4)',
              borderRadius: 6,
              color: '#9fc5f0',
              cursor: pricesRefreshing ? 'wait' : 'pointer',
              fontSize: '0.85rem',
            }}
          >
            {pricesRefreshing ? 'Refreshing…' : '↻ Refresh prices'}
          </button>
        </div>
      )}

      {/* All-time P/L hero */}
      <div className="pt-hero-card">
        <div className="pt-hero-label">{"\u{1F4B0}"} All-time P/L</div>
        <div className={`pt-hero-value ${totalPnl >= 0 ? 'pct-pos' : 'pct-neg'}`}>
          {fmt$(totalPnl)}
          <span className="pt-hero-pct"> ({totalPnl >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%)</span>
        </div>
        {/* Annualized chip — only shown once we have at least a week of data.
            CAGR-based number: what this ROI would be if you sustained the
            same pace for a full year. Short-window output is suppressed
            because (e.g.) +5% in 4 days extrapolates to silly numbers. */}
        {daysTrading > 0 && (
          <div className="pt-hero-annualized">
            {annualizedPct != null ? (
              <span
                className={`pt-hero-annualized-chip ${annualizedPct >= 0 ? 'pct-pos' : 'pct-neg'}`}
                title={`Annualized return = (1 + ${totalPnlPct.toFixed(2)}%)^(365/${daysTrading}) − 1.\nThis is what your current pace would compound to over a full year (CAGR). Treat it as a directional estimate, not a guarantee — short windows can be noisy.`}
              >
                {"\u{1F4C8}"} Annualized: {annualizedPct >= 0 ? '+' : ''}{Math.abs(annualizedPct) >= 1000 ? annualizedPct.toFixed(0) : annualizedPct.toFixed(1)}%
              </span>
            ) : (
              <span className="pt-hero-annualized-chip pt-hero-annualized-pending" title="Need at least 7 days of trading history before an annualized rate becomes meaningful.">
                {"\u{23F1}"} Too early to annualize
              </span>
            )}
            <span className="pt-hero-annualized-sub">
              over {formatTimeSpan(daysTrading)} of trading
              {earliestEntryMs != null && (
                <> {"·"} since {new Date(earliestEntryMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</>
              )}
            </span>
          </div>
        )}
        <div className="pt-hero-meta">
          on ${totalInvested.toFixed(0)} deployed across {trades.length} trade{trades.length === 1 ? '' : 's'}
          {closedTrades.length > 0 && (
            <> {"·"} {winRate.toFixed(0)}% win rate ({closedTrades.length} closed)</>
          )}
        </div>
      </div>

      {/* ROI breakdown — Open (unrealized) vs Closed (realized) */}
      <div className="pt-roi-grid">
        <div className="pt-roi-card pt-roi-open">
          <div className="pt-roi-head">
            <span className="pt-roi-icon">{"\u{1F4C8}"}</span>
            <span className="pt-roi-title">Open Positions</span>
            <span className="pt-roi-count">{openTrades.length}</span>
          </div>
          <div className="pt-roi-rows">
            <div className="pt-roi-row"><span>Deployed</span><span>${openInvested.toFixed(2)}</span></div>
            <div className="pt-roi-row"><span>Now worth</span><span>${currentOpenValue.toFixed(2)}</span></div>
            <div className="pt-roi-row"><span>Unrealized P/L</span><span className={unrealizedPnl >= 0 ? 'pct-pos' : 'pct-neg'}>{fmt$(unrealizedPnl)}</span></div>
          </div>
          <div className="pt-roi-foot">
            <div className="pt-roi-foot-label">Open ROI</div>
            <div className={`pt-roi-foot-value ${openRoiPct >= 0 ? 'pct-pos' : 'pct-neg'}`}>
              {openInvested > 0 ? `${openRoiPct >= 0 ? '+' : ''}${openRoiPct.toFixed(2)}%` : '—'}
            </div>
          </div>
        </div>

        <div className="pt-roi-card pt-roi-closed">
          <div className="pt-roi-head">
            <span className="pt-roi-icon">{"\u{1F4CB}"}</span>
            <span className="pt-roi-title">Closed Trades</span>
            <span className="pt-roi-count">{closedTrades.length}</span>
          </div>
          <div className="pt-roi-rows">
            <div className="pt-roi-row"><span>Recycled capital</span><span>${closedInvested.toFixed(2)}</span></div>
            <div className="pt-roi-row"><span>Proceeds</span><span>${closedProceeds.toFixed(2)}</span></div>
            <div className="pt-roi-row"><span>Realized P/L</span><span className={realizedPnl >= 0 ? 'pct-pos' : 'pct-neg'}>{fmt$(realizedPnl)}</span></div>
          </div>
          <div className="pt-roi-foot">
            <div className="pt-roi-foot-label">Closed ROI</div>
            <div className={`pt-roi-foot-value ${closedRoiPct >= 0 ? 'pct-pos' : 'pct-neg'}`}>
              {closedInvested > 0 ? `${closedRoiPct >= 0 ? '+' : ''}${closedRoiPct.toFixed(2)}%` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* AI Accuracy */}
      <div className="pt-ai-accuracy">
        <h3>{"\u{1F3AF}"} AI Accuracy &mdash; Avg P/L by Recommendation at Entry</h3>
        <div className="pt-ai-grid">
          {['BUY', 'HOLD', 'SELL'].map(rec => {
            const avg = avgOf(byRec[rec]);
            const count = byRec[rec].length;
            return (
              <div key={rec} className={`pt-ai-card ${recClass(rec)}`}>
                <div className="pt-ai-rec">{recLabel(rec)}</div>
                <div className={`pt-ai-avg ${avg == null ? '' : avg >= 0 ? 'pct-pos' : 'pct-neg'}`}>
                  {avg == null ? '\u{2014}' : `${avg >= 0 ? '+' : ''}${avg.toFixed(2)}%`}
                </div>
                <div className="pt-ai-count">{count} trade{count === 1 ? '' : 's'}</div>
              </div>
            );
          })}
        </div>
        <p className="pt-ai-hint">
          If BUY picks consistently outperform HOLD/SELL, the AI recommendations are adding value.
        </p>
      </div>

      {/* Open Positions */}
      <div className="pt-section">
        <h3>{"\u{1F4C8}"} Open Positions <span className="pt-count-badge">{openTrades.length}</span></h3>
        {openTrades.length === 0 ? (
          <p className="pt-empty">
            No open positions yet. Go to your {"\u{2B50}"} Watchlist tab and click "Paper Buy" on any card to simulate a trade.
          </p>
        ) : (
          <div className="pt-table-wrap">
            <table className="pt-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Entry Date</th>
                  <th>Days Held</th>
                  <th>Entry Price</th>
                  <th>Current Price</th>
                  <th>Shares</th>
                  <th>Invested</th>
                  <th>Current Value</th>
                  <th>P/L</th>
                  <th title="What the AI would recommend RIGHT NOW based on the latest scan. Click a row to see the original recommendation at entry.">AI Rec (Live)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {openTrades.map(t => {
                  const latest = getLatest(t.ticker);
                  const invested = parseFloat(t.entry_amount);
                  const current = latest != null ? latest * parseFloat(t.shares) : invested;
                  const pnl = current - invested;
                  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
                  const entryRec = t.ai_recommendation_at_entry || 'HOLD';
                  const liveRec = getLiveRec(t);
                  const stopHit = isStopHit(t.ticker);
                  const recTitle = liveRec !== entryRec
                    ? `AI now says ${liveRec}. At entry it said ${entryRec}.`
                    : `AI still says ${liveRec} (same as at entry).`;
                  const isOpen = expandedId === t.id;
                  const hasNote = !!(t.notes && t.notes.trim());
                  return (
                    <React.Fragment key={t.id}>
                      <tr className={`pt-row ${isOpen ? 'pt-row-expanded' : ''}`}>
                        <td className="pt-table-ticker">
                          <div className="pt-ticker-cell">
                            <button
                              type="button"
                              className="pt-expand-btn"
                              onClick={() => toggleExpand(t.id)}
                              aria-expanded={isOpen}
                              title={hasNote ? t.notes : 'View notes / AI snapshot'}
                            >
                              <span className={`pt-chevron ${isOpen ? 'open' : ''}`}>{"\u25B8"}</span>
                              {t.ticker}
                            </button>
                            {onOpenCard && (
                              <button
                                type="button"
                                className="pt-view-card-btn"
                                onClick={() => onOpenCard(t.ticker)}
                                title={`See live AI card for ${t.ticker}`}
                                aria-label={`View live AI card for ${t.ticker}`}
                              >
                                {"\u{1F4C7}"}
                              </button>
                            )}
                            {hasNote && <span className="pt-note-dot" title="Has notes">{"\u{1F4DD}"}</span>}
                            {stopHit && (
                              <span
                                className="pt-stop-badge"
                                title="Price has broken below the AI's stop-loss level."
                              >
                                {"\u{1F6D1}"} STOP HIT
                              </span>
                            )}
                          </div>
                        </td>
                        <td>{fmtDate(t.entry_date)}</td>
                        <td>{daysHeld(t)}d</td>
                        <td>${parseFloat(t.entry_price).toFixed(2)}</td>
                        <td>{latest != null ? '$' + latest.toFixed(2) : '\u{2014}'}</td>
                        <td>{parseFloat(t.shares).toFixed(4)}</td>
                        <td>${invested.toFixed(2)}</td>
                        <td>${current.toFixed(2)}</td>
                        <td className={pnl >= 0 ? 'pct-pos' : 'pct-neg'}>
                          {fmt$(pnl)} <br />
                          <span className="pt-sub">({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
                        </td>
                        <td>
                          <span className={`rec-chip ${recClass(liveRec)}`} title={recTitle}>
                            {recLabel(liveRec)}
                          </span>
                          {liveRec !== entryRec && (
                            <div
                              className="pt-sub"
                              title={`Entry rec was ${entryRec}`}
                              style={{ marginTop: '2px', fontSize: '0.62rem', opacity: 0.7 }}
                            >
                              was {entryRec}
                            </div>
                          )}
                        </td>
                        <td>
                          <button className="pt-sell-btn" onClick={() => onSell(t, latest != null ? latest : parseFloat(t.entry_price))}>
                            {"\u{1F4B0}"} Sell
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="pt-drawer-row">
                          <td colSpan={11}>
                            <TradeDetailDrawer
                              trade={t}
                              onUpdateReview={onUpdateReview}
                              currentPrice={latest}
                              currentPriceDate={prices?.[t.ticker]?.price_date || prices?.[t.ticker]?.updated_at}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Closed Positions */}
      <div className="pt-section">
        <h3>{"\u{1F4CB}"} Closed Trades <span className="pt-count-badge">{closedTrades.length}</span></h3>
        {closedTrades.length === 0 ? (
          <p className="pt-empty">No closed trades yet.</p>
        ) : (
          <div className="pt-table-wrap">
            <table className="pt-table">
              <thead>
                <tr>
                  <th>Ticker</th>
                  <th>Entry {"\u{2192}"} Exit</th>
                  <th>Days Held</th>
                  <th>Entry</th>
                  <th>Exit</th>
                  <th>Invested</th>
                  <th>Proceeds</th>
                  <th>P/L</th>
                  <th>AI Rec @ Entry</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {closedTrades.map(t => {
                  const invested = parseFloat(t.entry_amount);
                  const proceeds = parseFloat(t.exit_amount);
                  const pnl = proceeds - invested;
                  const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
                  const rec = t.ai_recommendation_at_entry || 'HOLD';
                  const isOpen = expandedId === t.id;
                  const hasNote = !!(t.notes && t.notes.trim());
                  return (
                    <React.Fragment key={t.id}>
                      <tr className={`pt-row ${isOpen ? 'pt-row-expanded' : ''}`}>
                        <td className="pt-table-ticker">
                          <div className="pt-ticker-cell">
                            <button
                              type="button"
                              className="pt-expand-btn"
                              onClick={() => toggleExpand(t.id)}
                              aria-expanded={isOpen}
                              title={hasNote ? t.notes : 'View notes / AI snapshot'}
                            >
                              <span className={`pt-chevron ${isOpen ? 'open' : ''}`}>{"\u25B8"}</span>
                              {t.ticker}
                            </button>
                            {onOpenCard && (
                              <button
                                type="button"
                                className="pt-view-card-btn"
                                onClick={() => onOpenCard(t.ticker)}
                                title={`See live AI card for ${t.ticker}`}
                                aria-label={`View live AI card for ${t.ticker}`}
                              >
                                {"\u{1F4C7}"}
                              </button>
                            )}
                            {hasNote && <span className="pt-note-dot">{"\u{1F4DD}"}</span>}
                            {t.ai_review_verdict && <span className={`pt-verdict-dot pt-verdict-${t.ai_review_verdict}`} title={`Reviewed: ${t.ai_review_verdict}`}>{verdictEmoji(t.ai_review_verdict)}</span>}
                          </div>
                        </td>
                        <td>{fmtDate(t.entry_date)} {"\u{2192}"} {fmtDate(t.exit_date)}</td>
                        <td>{daysHeld(t)}d</td>
                        <td>${parseFloat(t.entry_price).toFixed(2)}</td>
                        <td>${parseFloat(t.exit_price).toFixed(2)}</td>
                        <td>${invested.toFixed(2)}</td>
                        <td>${proceeds.toFixed(2)}</td>
                        <td className={pnl >= 0 ? 'pct-pos' : 'pct-neg'}>
                          {fmt$(pnl)} <br />
                          <span className="pt-sub">({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)</span>
                        </td>
                        <td><span className={`rec-chip ${recClass(rec)}`}>{recLabel(rec)}</span></td>
                        <td>
                          <button className="pt-delete-btn" onClick={() => { if (confirm('Delete this closed trade permanently?')) onDelete(t.id); }}>
                            {"\u{1F5D1}"}
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="pt-drawer-row">
                          <td colSpan={10}>
                            <TradeDetailDrawer
                              trade={t}
                              onUpdateReview={onUpdateReview}
                              currentPrice={getLatest(t.ticker)}
                              currentPriceDate={prices?.[t.ticker]?.price_date || prices?.[t.ticker]?.updated_at}
                            />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Lightweight inline SVG sparkline (no Chart.js) for table rows ──
function MiniSparkline({ prices, width = 90, height = 28 }) {
  const [hoverIdx, setHoverIdx] = useState(null);
  if (!prices || prices.length < 2) return <span className="qt-muted">{"\u{2014}"}</span>;
  const pts = prices.filter(p => typeof p.price === 'number');
  if (pts.length < 2) return <span className="qt-muted">{"\u{2014}"}</span>;
  const vals = pts.map(p => p.price);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const stepX = width / (vals.length - 1);
  const coords = vals.map((v, i) => ({
    x: i * stepX,
    y: height - ((v - min) / range) * height,
  }));
  const polyPoints = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ');
  const isUp = vals[vals.length - 1] >= vals[0];
  const stroke = isUp ? '#22c55e' : '#ef4444';
  const fill = isUp ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';
  const areaPath = `M0,${height} L${polyPoints.replace(/ /g, ' L')} L${width},${height} Z`;

  const handleMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.round((x / rect.width) * (vals.length - 1));
    setHoverIdx(Math.max(0, Math.min(vals.length - 1, idx)));
  };
  const formatDate = (d) => {
    if (!d) return '';
    try {
      return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return d; }
  };

  const hover = hoverIdx !== null ? { c: coords[hoverIdx], p: pts[hoverIdx] } : null;

  return (
    <div
      className="mini-sparkline"
      onMouseMove={handleMove}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <path d={areaPath} fill={fill} stroke="none" />
        <polyline points={polyPoints} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
        {hover && (
          <>
            <line x1={hover.c.x} y1="0" x2={hover.c.x} y2={height} stroke="#7a9bc0" strokeWidth="0.5" strokeDasharray="2,2" />
            <circle cx={hover.c.x} cy={hover.c.y} r="2.5" fill={stroke} stroke="#0a1728" strokeWidth="1" />
          </>
        )}
      </svg>
      {hover && (
        <div className="mini-sparkline-tooltip">
          <span className="mst-date">{formatDate(hover.p.date)}</span>
          <span className="mst-price">${hover.p.price.toFixed(2)}</span>
          {typeof hover.p.pct_change === 'number' && (
            <span className={hover.p.pct_change >= 0 ? 'pct-pos' : 'pct-neg'}>
              {hover.p.pct_change >= 0 ? '+' : ''}{hover.p.pct_change.toFixed(2)}%
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Quick Sortable Table (top-of-dashboard at-a-glance table) ──
function QuickTable({ alerts, watchlist, onToggleWatchlist, onJumpToCard }) {
  const [sortKey, setSortKey] = useState('signal_strength');
  const [sortDir, setSortDir] = useState('desc');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('current');
  const [collapsed, setCollapsed] = useState(false);

  // ── Column definitions (default order) ──
  const DEFAULT_HEADERS = [
    { key: 'ticker',           label: 'Ticker',           sticky: 'ticker' },
    { key: 'company',          label: 'Company' },
    { key: 'status',           label: 'Status' },
    { key: 'alert_date',       label: 'Date' },
    { key: 'days_held',        label: 'Days Since Alert' },
    { key: 'source',           label: 'Source' },
    { key: 'signal_type',      label: 'Signal Type' },
    { key: 'signal_strength',  label: 'Signal Strength' },
    { key: 'price_at_alert',   label: 'Entry' },
    { key: 'latest_price',     label: 'Latest' },
    { key: 'pct',              label: '% Change' },
    { key: 'trend',            label: 'Trend (7d)' },
    { key: 'recommendation',   label: 'AI Rec' },
    { key: 'forecast_price',   label: 'Forecast Sell' },
    { key: 'days_to_forecast', label: 'Days \u{2192} Sell' },
  ];
  const ALL_KEYS = DEFAULT_HEADERS.map(h => h.key);

  // ── Persisted column order & visibility (cookie-based) ──
  const [colOrder, setColOrder] = useState(ALL_KEYS);
  const [hiddenCols, setHiddenCols] = useState([]);
  const [showColSettings, setShowColSettings] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);

  // Load from cookie on mount
  useEffect(() => {
    if (typeof document === 'undefined') return;
    try {
      const m = document.cookie.match(/(?:^|; )qt_columns=([^;]*)/);
      if (m) {
        const parsed = JSON.parse(decodeURIComponent(m[1]));
        if (parsed.order?.length) {
          // Merge: keep saved order, append any new cols not in saved list
          const merged = [...parsed.order.filter(k => ALL_KEYS.includes(k)), ...ALL_KEYS.filter(k => !parsed.order.includes(k))];
          setColOrder(merged);
        }
        if (parsed.hidden?.length) setHiddenCols(parsed.hidden.filter(k => ALL_KEYS.includes(k)));
      }
    } catch {}
  }, []);

  const persistColumns = (order, hidden) => {
    if (typeof document === 'undefined') return;
    const val = encodeURIComponent(JSON.stringify({ order, hidden }));
    document.cookie = `qt_columns=${val}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  };

  const toggleColVisibility = (key) => {
    // Don't allow hiding ticker
    if (key === 'ticker') return;
    setHiddenCols(prev => {
      const next = prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key];
      persistColumns(colOrder, next);
      return next;
    });
  };

  const handleDragStart = (idx) => setDragIdx(idx);
  const handleDragOver = (e, idx) => {
    e.preventDefault();
    if (dragIdx === null || dragIdx === idx) return;
    setColOrder(prev => {
      const next = [...prev];
      const [moved] = next.splice(dragIdx, 1);
      next.splice(idx, 0, moved);
      persistColumns(next, hiddenCols);
      return next;
    });
    setDragIdx(idx);
  };
  const handleDragEnd = () => setDragIdx(null);

  const resetColumns = () => {
    setColOrder(ALL_KEYS);
    setHiddenCols([]);
    persistColumns(ALL_KEYS, []);
  };

  // Build visible headers in user order
  const headerMap = {};
  DEFAULT_HEADERS.forEach(h => { headerMap[h.key] = h; });
  const visibleHeaders = colOrder.filter(k => !hiddenCols.includes(k)).map(k => headerMap[k]);

  // Persist collapsed preference in a cookie
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const m = document.cookie.match(/(?:^|; )qt_collapsed=([^;]*)/);
    if (m && m[1] === '1') setCollapsed(true);
  }, []);
  const toggleCollapsed = () => {
    setCollapsed(prev => {
      const next = !prev;
      if (typeof document !== 'undefined') {
        document.cookie = `qt_collapsed=${next ? '1' : '0'}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
      }
      return next;
    });
  };

  // Forecast sell target — tuned by AI rec AND signal strength.
  // Stronger conviction signals earn higher price targets.
  // Tiers (signal strength 0-100): weak <40, moderate 40-59, strong 60-79, very strong 80+.
  const calcForecast = (alert) => {
    const entry = parseFloat(alert.price_at_alert);
    if (alert.forecast_sell_price) {
      return { price: parseFloat(alert.forecast_sell_price), upsidePct: null, tier: 'ai', source: 'ai' };
    }
    const rec = alert.recommendation || 'HOLD';
    const latest = alert.prices[alert.prices.length - 1];
    const ss = alert.signal_strength ?? 0;
    const tier = ss >= 80 ? 'very-strong' : ss >= 60 ? 'strong' : ss >= 40 ? 'moderate' : 'weak';

    if (rec === 'SELL') {
      return { price: latest?.price || entry, upsidePct: 0, tier, source: 'calc' };
    }
    // BUY / HOLD multipliers by signal tier
    const table = {
      BUY:  { 'very-strong': 0.22, strong: 0.17, moderate: 0.13, weak: 0.10 },
      HOLD: { 'very-strong': 0.13, strong: 0.10, moderate: 0.07, weak: 0.04 },
    };
    const upsidePct = (table[rec] || table.HOLD)[tier];
    return { price: entry * (1 + upsidePct), upsidePct: upsidePct * 100, tier, source: 'calc' };
  };

  const tierLabel = (t) =>
    t === 'very-strong' ? 'Very Strong' :
    t === 'strong'      ? 'Strong' :
    t === 'moderate'    ? 'Moderate' :
    t === 'weak'        ? 'Weak' : 'AI';
  const daysHeld = (a) => Math.max(0, Math.floor((new Date() - new Date(a.alert_date + 'T00:00:00')) / 86400000));
  const daysToForecast = (a) => a.forecast_sell_date
    ? Math.ceil((new Date(a.forecast_sell_date + 'T00:00:00') - new Date()) / 86400000)
    : null;
  const latestPct = (a) => a.prices[a.prices.length - 1]?.pct_change || 0;
  const latestPrice = (a) => a.prices[a.prices.length - 1]?.price ?? null;

  const rows = useMemo(() => {
    let list = alerts;
    if (statusFilter === 'current') list = list.filter(a => a.status !== 'dropped');
    else if (statusFilter !== 'all') list = list.filter(a => a.status === statusFilter);
    if (query.trim()) {
      const q = query.toLowerCase().trim();
      list = list.filter(a =>
        a.ticker.toLowerCase().includes(q) ||
        (a.company || '').toLowerCase().includes(q) ||
        (a.signal_type || '').toLowerCase().includes(q)
      );
    }
    const accessor = {
      ticker: a => a.ticker,
      company: a => a.company || '',
      status: a => a.status || 'active',
      alert_date: a => a.alert_date,
      source: a => getSourceMeta(a.source).label,
      signal_type: a => a.signal_type || '',
      signal_strength: a => a.signal_strength ?? 0,
      price_at_alert: a => parseFloat(a.price_at_alert),
      latest_price: a => latestPrice(a) ?? 0,
      pct: a => latestPct(a),
      recommendation: a => ({ BUY: 0, HOLD: 1, SELL: 2 })[a.recommendation || 'HOLD'],
      forecast_price: a => calcForecast(a).price,
      days_held: a => daysHeld(a),
      days_to_forecast: a => daysToForecast(a) ?? 999999,
    };
    const acc = accessor[sortKey] || accessor.signal_strength;
    return [...list].sort((x, y) => {
      const av = acc(x), bv = acc(y);
      if (typeof av === 'number' && typeof bv === 'number') {
        return sortDir === 'asc' ? av - bv : bv - av;
      }
      return sortDir === 'asc'
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
  }, [alerts, sortKey, sortDir, query, statusFilter]);

  const clickSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortKey(key); setSortDir(key === 'ticker' || key === 'company' ? 'asc' : 'desc'); }
  };
  const sortIcon = (key) => sortKey !== key ? '\u{21C5}' : sortDir === 'asc' ? '\u{25B2}' : '\u{25BC}';

  const headers = visibleHeaders;

  return (
    <div className={`quicktable-section${collapsed ? ' quicktable-collapsed' : ''}`}>
      <div className="quicktable-header">
        <div className="quicktable-title-wrap">
          <button
            className="qt-collapse-btn"
            onClick={toggleCollapsed}
            title={collapsed ? 'Expand Quick Scan table' : 'Collapse Quick Scan table'}
            aria-expanded={!collapsed}
          >
            <span className={`qt-caret ${collapsed ? 'collapsed' : ''}`}>{"\u{25BC}"}</span>
          </button>
          <div>
            <h2 className="quicktable-title">
              {"\u{1F4CA}"} Quick Scan
              <span className="quicktable-count">{rows.length} picks</span>
            </h2>
            {!collapsed && (
              <p className="quicktable-hint">
                Click any column header to sort. Click a ticker or company name to jump to its card.
                <br />
                <span style={{ color: '#7a9bc0', fontSize: 12 }}>
                  {"\u{1F50D}"} Search filters this watchlist only — it does <strong>not</strong> search every US-listed stock. To surface a new ticker, adjust your AI engine settings or wait for the next daily scan.
                </span>
              </p>
            )}
          </div>
        </div>
        {!collapsed && (
          <div className="quicktable-controls">
            <div className="quicktable-search">
              <span className="qt-search-icon">{"\u{1F50D}"}</span>
              <input
                type="text"
                placeholder="Filter surfaced picks (ticker, company, signal)…"
                title="Searches only stocks already surfaced by the AI scan — not every US-listed stock."
                aria-label="Filter your surfaced picks by ticker, company name or signal type"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && <button className="qt-clear" onClick={() => setQuery('')}>{"\u{2715}"}</button>}
            </div>
            <select className="qt-status-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="current">Current (New + Active)</option>
              <option value="new">New only</option>
              <option value="active">Active only</option>
              <option value="dropped">Dropped only</option>
              <option value="all">All (incl. dropped)</option>
            </select>
            <div className="qt-col-settings-wrap">
              <button
                className="qt-col-settings-btn"
                onClick={() => setShowColSettings(prev => !prev)}
                title="Customize columns"
              >
                {"\u{2699}"} Columns
              </button>
              {showColSettings && (
                <div className="qt-col-dropdown">
                  <div className="qt-col-dropdown-header">
                    <span>Drag to reorder, toggle to show/hide</span>
                    <button className="qt-col-reset-btn" onClick={resetColumns}>Reset</button>
                  </div>
                  <ul className="qt-col-list">
                    {colOrder.map((key, idx) => {
                      const h = headerMap[key];
                      if (!h) return null;
                      const isHidden = hiddenCols.includes(key);
                      const isTicker = key === 'ticker';
                      return (
                        <li
                          key={key}
                          className={`qt-col-item ${dragIdx === idx ? 'qt-col-dragging' : ''} ${isTicker ? 'qt-col-locked' : ''}`}
                          draggable={!isTicker}
                          onDragStart={() => handleDragStart(idx)}
                          onDragOver={(e) => handleDragOver(e, idx)}
                          onDragEnd={handleDragEnd}
                        >
                          <span className="qt-col-grip">{isTicker ? '\u{1F512}' : '\u{2630}'}</span>
                          <label className="qt-col-label">
                            <input
                              type="checkbox"
                              checked={!isHidden}
                              disabled={isTicker}
                              onChange={() => toggleColVisibility(key)}
                            />
                            {h.label}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {!collapsed && (
      <div className="quicktable-wrap">
        <table className="quicktable">
          <thead>
            <tr>
              <th className="qt-sticky qt-sticky-star">{"\u{2B50}"}</th>
              {headers.map((h) => {
                const isSortable = h.key && h.key !== 'trend';
                return (
                  <th
                    key={h.key}
                    className={`${isSortable ? 'qt-sortable' : ''}${h.sticky === 'ticker' ? ' qt-sticky qt-sticky-ticker' : ''}`}
                    onClick={isSortable ? () => clickSort(h.key) : undefined}
                  >
                    {h.label} {isSortable && <span className="qt-sort">{sortIcon(h.key)}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={headers.length + 1} className="qt-empty">No picks match your filter.</td></tr>
            )}
            {rows.map((a, idx) => {
              const isW = watchlist.includes(a.ticker);
              const latest = a.prices[a.prices.length - 1];
              const pct = latest?.pct_change || 0;
              const perf = getStatus(pct);
              const rec = a.recommendation || 'HOLD';
              const fc = calcForecast(a);
              const entry = parseFloat(a.price_at_alert);
              const upside = entry > 0 ? ((fc.price - entry) / entry) * 100 : 0;
              const pickStatus = a.status || 'active';
              const pickLabel = pickStatus === 'new'
                ? <><Ico name="belldot" size={11} /> NEW</>
                : pickStatus === 'dropped'
                ? <><Ico name="trash" size={11} /> DROPPED</>
                : <><Ico name="activity" size={11} /> ACTIVE</>;
              const srcMeta = getSourceMeta(a.source);
              const dh = daysHeld(a);
              const dtf = daysToForecast(a);

              // Dynamic cell renderer keyed by column key
              const cellMap = {
                ticker: <td key="ticker" className="qt-sticky qt-sticky-ticker qt-ticker"><button className="qt-ticker-btn" onClick={() => onJumpToCard(a)} title="Jump to card">{a.ticker}</button></td>,
                company: <td key="company" className="qt-company"><button className="qt-company-btn" onClick={() => onJumpToCard(a)} title="View full card">{a.company}</button></td>,
                status: <td key="status"><span className={`pick-status-chip pick-${pickStatus}`}>{pickLabel}</span></td>,
                alert_date: <td key="alert_date" className="qt-muted tbl-alert-date">{a.alert_date}</td>,
                days_held: <td key="days_held" className="qt-muted">{dh}d</td>,
                source: <td key="source"><span className={`source-badge-sm ${srcMeta.cls}`}><Ico name={srcMeta.icon} /> {srcMeta.label}</span></td>,
                signal_type: <td key="signal_type"><span className="signal-chip">{a.signal_type}</span></td>,
                signal_strength: <td key="signal_strength"><SignalBars score={a.signal_strength} subScores={a.signal_sub_scores} sourceCount={a.signal_source_count} mentionCount={a.signal_mention_count} /></td>,
                price_at_alert: <td key="price_at_alert" className="tbl-alert-price">${entry.toFixed(2)}</td>,
                latest_price: <td key="latest_price">{latest?.price != null ? '$' + latest.price.toFixed(2) : '\u{2014}'}</td>,
                pct: <td key="pct" className={`tbl-${perf}`}>{fmtPct(pct)}</td>,
                trend: <td key="trend" className="qt-trend"><MiniSparkline prices={a.prices} /></td>,
                recommendation: <td key="recommendation"><span className={`rec-chip ${recClass(rec)}`}>{recLabel(rec)}</span></td>,
                forecast_price: <td key="forecast_price" className="qt-forecast"><div className="qt-forecast-inner"><span className="qt-forecast-price">${fc.price.toFixed(2)}</span><span className={`qt-forecast-upside ${upside >= 0 ? 'pct-pos' : 'pct-neg'}`}>{fmtPct(upside)}</span>{fc.source === 'calc' && <span className="qt-forecast-est" title={`Estimated: ${rec} + ${tierLabel(fc.tier)} signal \u2192 +${(fc.upsidePct ?? 0).toFixed(0)}%`}>est</span>}</div></td>,
                days_to_forecast: <td key="days_to_forecast" className="qt-muted">{dtf === null ? '\u{2014}' : dtf < 0 ? <span className="pct-neg">Overdue</span> : dtf + 'd'}</td>,
              };
              return (
                <tr key={a.id || `${a.ticker}-${idx}`} className={pickStatus === 'dropped' ? 'row-dropped' : ''}>
                  <td className="qt-sticky qt-sticky-star">
                    <button
                      className={`watchlist-btn-sm ${isW ? 'watched' : ''}`}
                      onClick={() => onToggleWatchlist(a.ticker)}
                      title={isW ? 'Remove from watchlist' : 'Add to watchlist'}
                    >
                      {isW ? '\u{2605}' : '\u{2606}'}
                    </button>
                  </td>
                  {headers.map(h => cellMap[h.key])}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}

// ---------- LEADERBOARD TAB ----------
function LeaderboardTab({ alerts, prices, currentUserId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedUserId, setSelectedUserId] = useState(null);
  const [userTrades, setUserTrades] = useState(null);

  // Refetch the leaderboard data whenever prices refresh. This keeps every
  // user's realized/unrealized P/L in sync with the latest quote without
  // forcing a full page reload.
  const pricesKey = prices ? Object.keys(prices).length : 0;

  useEffect(() => {
    fetch('/api/leaderboard')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [pricesKey]);

  useEffect(() => {
    if (!selectedUserId) { setUserTrades(null); return; }
    fetch(`/api/leaderboard?userId=${selectedUserId}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => setUserTrades(d?.trades || []));
  }, [selectedUserId]);

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#7a9bc0' }}>Loading community portfolios…</div>;
  if (!data?.leaderboard?.length) return <div style={{ padding: 40, textAlign: 'center', color: '#7a9bc0' }}>No approved users yet.</div>;

  // Prefer the shared current_prices map so every user's portfolio is
  // priced the same way regardless of who's viewing. Fall back to the
  // viewer's alerts feed only if a ticker is missing from the map.
  const getPrice = (ticker) => {
    const live = prices?.[ticker]?.price;
    if (live != null && !Number.isNaN(live)) return live;
    const a = alerts.find(x => x.ticker === ticker);
    if (!a) return null;
    const hist = a.prices || [];
    return hist.length ? parseFloat(hist[hist.length - 1].price) : parseFloat(a.price_at_alert);
  };

  // Compute unrealized PL for each user using current live prices
  const rows = data.leaderboard.map(s => {
    let unrealizedPL = 0;
    let openInvested = 0;
    if (s.openTrades) {
      for (const ot of s.openTrades) {
        const cur = getPrice(ot.ticker);
        openInvested += ot.entry_amount;
        if (cur != null) {
          unrealizedPL += (cur * ot.shares) - ot.entry_amount;
        }
      }
    }
    const closedInvested = s.totalInvested - openInvested;
    return {
      ...s,
      unrealizedPL,
      openInvested,
      closedInvested,
      totalPL: s.realizedPL + unrealizedPL,
    };
  }).sort((a, b) => (b.totalPL || 0) - (a.totalPL || 0));

  const selectedSummary = selectedUserId ? rows.find(r => r.profile.id === selectedUserId) : null;

  return (
    <div className="leaderboard-tab">
      {!selectedUserId && (
        <>
          <p className="section-hint" style={{ marginLeft: 0, marginTop: 0 }}>
            See how everyone's picks are doing. Click any user to view their full portfolio.
          </p>
          <div className="lb-grid">
            {rows.map((r, i) => (
              <button
                key={r.profile.id}
                className={`lb-card ${r.profile.id === currentUserId ? 'lb-card-you' : ''}`}
                onClick={() => setSelectedUserId(r.profile.id)}
              >
                <div className="lb-rank">#{i + 1}</div>
                {r.profile.avatar_url ? (
                  <img src={r.profile.avatar_url} alt="" className="lb-avatar" referrerPolicy="no-referrer" />
                ) : (
                  <span className="lb-avatar lb-avatar-fallback">
                    {(r.profile.display_name || r.profile.email || '?').charAt(0).toUpperCase()}
                  </span>
                )}
                <div className="lb-name">
                  {r.profile.display_name || r.profile.email.split('@')[0]}
                  {r.profile.id === currentUserId && <span className="lb-you-badge">You</span>}
                  {r.profile.is_admin && <span className="lb-admin-badge">Admin</span>}
                </div>
                <div className="lb-pl-section">
                  {r.closedCount > 0 && (
                    <div className="lb-pl-row">
                      <span className="lb-pl-label">Actual</span>
                      <span className={r.realizedPL >= 0 ? 'pct-pos' : 'pct-neg'}>
                        {r.realizedPL >= 0 ? '+' : ''}{'\u0024'}{Math.abs(r.realizedPL).toFixed(2)}
                        {r.closedInvested > 0 && (
                          <span className="lb-pl-pct"> ({r.realizedPL >= 0 ? '+' : ''}{((r.realizedPL / r.closedInvested) * 100).toFixed(1)}%)</span>
                        )}
                      </span>
                    </div>
                  )}
                  {r.openCount > 0 && (
                    <div className="lb-pl-row">
                      <span className="lb-pl-label">Paper</span>
                      <span className={r.unrealizedPL >= 0 ? 'pct-pos' : 'pct-neg'}>
                        {r.unrealizedPL >= 0 ? '+' : ''}{'\u0024'}{Math.abs(r.unrealizedPL).toFixed(2)}
                        {r.openInvested > 0 && (
                          <span className="lb-pl-pct"> ({r.unrealizedPL >= 0 ? '+' : ''}{((r.unrealizedPL / r.openInvested) * 100).toFixed(1)}%)</span>
                        )}
                      </span>
                    </div>
                  )}
                </div>
                <div className="lb-stats-row">
                  <span>${r.totalInvested.toFixed(0)} invested</span>
                  <span>{r.closedCount} closed</span>
                  <span>{r.openCount} open</span>
                  {r.winRate !== null && <span>{(r.winRate * 100).toFixed(0)}% win</span>}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {selectedUserId && selectedSummary && (
        <div className="lb-detail">
          <button className="lb-back-btn" onClick={() => setSelectedUserId(null)}>&larr; Back to leaderboard</button>
          <div className="lb-detail-header">
            {selectedSummary.profile.avatar_url ? (
              <img src={selectedSummary.profile.avatar_url} alt="" className="lb-avatar-lg" referrerPolicy="no-referrer" />
            ) : (
              <span className="lb-avatar-lg lb-avatar-fallback">
                {(selectedSummary.profile.display_name || selectedSummary.profile.email || '?').charAt(0).toUpperCase()}
              </span>
            )}
            <div>
              <div className="lb-detail-name">
                {selectedSummary.profile.display_name || selectedSummary.profile.email.split('@')[0]}
                {selectedSummary.profile.is_admin && <span className="lb-admin-badge">Admin</span>}
              </div>
              <div className="lb-detail-sub">
                ${selectedSummary.totalInvested.toFixed(2)} invested {"\u{B7}"} {selectedSummary.closedCount} closed {"\u{B7}"} {selectedSummary.openCount} open
                {selectedSummary.totalInvested > 0 && <> {"\u{B7}"} <span className={selectedSummary.realizedPL >= 0 ? 'pct-pos' : 'pct-neg'}>{selectedSummary.realizedPL >= 0 ? '+' : ''}{((selectedSummary.realizedPL / selectedSummary.totalInvested) * 100).toFixed(1)}% return</span></>}
              </div>
            </div>
          </div>

          {!userTrades && <div style={{ padding: 20, textAlign: 'center', color: '#7a9bc0' }}>Loading trades…</div>}

          {userTrades && (() => {
            const open = userTrades.filter(t => t.status === 'open');
            const closed = userTrades.filter(t => t.status === 'closed');
            return (
              <>
                {open.length > 0 && (
                  <div className="pt-table-wrap">
                    <h3 style={{ margin: '16px 0 8px' }}>Open positions ({open.length})</h3>
                    <table className="pt-table">
                      <thead><tr><th>Ticker</th><th>Entered</th><th>Entry $</th><th>Current</th><th>P/L</th></tr></thead>
                      <tbody>
                        {open.map(t => {
                          const cur = getPrice(t.ticker);
                          const invested = parseFloat(t.entry_amount);
                          const curVal = cur ? cur * parseFloat(t.shares) : null;
                          const pl = curVal ? curVal - invested : null;
                          const plPct = (pl !== null && invested > 0) ? (pl / invested) * 100 : null;
                          return (
                            <tr key={t.id}>
                              <td><strong>{t.ticker}</strong></td>
                              <td>{new Date(t.entry_date).toLocaleDateString()}</td>
                              <td>${invested.toFixed(2)}</td>
                              <td>{curVal ? `$${curVal.toFixed(2)}` : '\u{2014}'}</td>
                              <td className={pl === null ? '' : pl >= 0 ? 'pct-pos' : 'pct-neg'}>
                                {pl === null ? '\u{2014}' : <>{pl >= 0 ? '+' : ''}${pl.toFixed(2)}<br /><span className="pt-sub">({plPct >= 0 ? '+' : ''}{plPct.toFixed(1)}%)</span></>}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {closed.length > 0 && (
                  <div className="pt-table-wrap">
                    <h3 style={{ margin: '16px 0 8px' }}>Closed trades ({closed.length})</h3>
                    <table className="pt-table">
                      <thead><tr><th>Ticker</th><th>Entered</th><th>Exited</th><th>Entry $</th><th>Exit $</th><th>P/L</th></tr></thead>
                      <tbody>
                        {closed.map(t => {
                          const invested = parseFloat(t.entry_amount) || 0;
                          const pl = (parseFloat(t.exit_amount) || 0) - invested;
                          const plPct = invested > 0 ? (pl / invested) * 100 : 0;
                          return (
                            <tr key={t.id}>
                              <td><strong>{t.ticker}</strong></td>
                              <td>{new Date(t.entry_date).toLocaleDateString()}</td>
                              <td>{new Date(t.exit_date).toLocaleDateString()}</td>
                              <td>${invested.toFixed(2)}</td>
                              <td>${parseFloat(t.exit_amount).toFixed(2)}</td>
                              <td className={pl >= 0 ? 'pct-pos' : 'pct-neg'}>
                                {pl >= 0 ? '+' : ''}${pl.toFixed(2)}<br />
                                <span className="pt-sub">({plPct >= 0 ? '+' : ''}{plPct.toFixed(1)}%)</span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {open.length === 0 && closed.length === 0 && (
                  <p style={{ textAlign: 'center', color: '#7a9bc0', marginTop: 20 }}>No trades yet.</p>
                )}
              </>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ---------- ADMIN USERS TAB ----------
// Helpers shared by the admin user rows.
//
// `planPill` returns the coloured pill describing the user's monetisation
// state — paid / on trial / trial ended / free. The states come from
// /api/admin/users which folds together the `subscriptions` table (paid
// users from the Lemon Squeezy webhook) and the in-app trial flow on
// `profiles.trial_ends_at`.
function planPill(u) {
  if (u.plan === 'paid') {
    const cancelled = u.subscription?.status === 'cancelled';
    return <span className="admin-plan admin-plan-paid" title={cancelled ? 'Subscription cancelled — access until period ends' : 'Active paid subscriber'}><Ico name="star" size={11} /> {cancelled ? 'Cancelling' : 'Paid'}</span>;
  }
  if (u.plan === 'trial') {
    const d = u.trial_days_left;
    const label = d === 0 ? 'Trial · last day' : d === 1 ? 'Trial · 1d left' : `Trial · ${d}d left`;
    return <span className="admin-plan admin-plan-trial" title="Free 7-day trial in progress">{label}</span>;
  }
  if (u.plan === 'expired') {
    return <span className="admin-plan admin-plan-expired" title="Trial ended — has not upgraded">Trial ended</span>;
  }
  return <span className="admin-plan admin-plan-free" title="No trial or paid subscription">Free</span>;
}

// Relative "last active" label with a colour-coded dot.
//   < 24h    → green   (active)
//   1–7d     → amber   (slipping)
//   8d+ or null → red  (cold / never logged in)
//
// Prefer profiles.last_active_at (bumped on every authed request) over
// auth.users.last_sign_in_at (only updates on a fresh login event) so the
// column reflects true app activity, not session age.
function lastActiveCell(u) {
  const ts = u.last_active_at || u.last_sign_in_at;
  const source = u.last_active_at ? 'Last active' : 'Last sign-in';
  if (!ts) {
    return <span className="admin-active admin-active-cold" title="Never signed in">● Never</span>;
  }
  const diffMs = Date.now() - new Date(ts).getTime();
  const diffMinutes = diffMs / 60_000;
  const diffHours = diffMs / 3_600_000;
  const diffDays = diffMs / 86_400_000;
  let cls = 'admin-active-warm';
  let label;
  if (diffMinutes < 5) label = 'Just now';
  else if (diffHours < 1) label = `${Math.floor(diffMinutes)}m ago`;
  else if (diffHours < 24) label = `${Math.floor(diffHours)}h ago`;
  else label = `${Math.floor(diffDays)}d ago`;

  if (diffHours < 24) cls = 'admin-active-warm';
  else if (diffDays < 7) cls = 'admin-active-mid';
  else cls = 'admin-active-cold';

  const tip = new Date(ts).toLocaleString();
  return <span className={`admin-active ${cls}`} title={`${source}: ${tip}`}>● {label}</span>;
}

function UsersAdminTab({ currentUserId }) {
  const [users, setUsers] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const load = () => {
    fetch('/api/admin/users')
      .then(r => r.ok ? r.json() : null)
      .then(d => setUsers(d?.users || []));
  };
  useEffect(() => { load(); }, []);

  const updateUser = async (id, payload) => {
    setBusyId(id);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...payload }),
      });
      if (res.ok) load();
    } finally {
      setBusyId(null);
    }
  };

  if (!users) return <div style={{ padding: 40, textAlign: 'center', color: '#7a9bc0' }}>Loading users…</div>;

  const pending = users.filter(u => u.status === 'pending');
  const approved = users.filter(u => u.status === 'approved');
  const disabled = users.filter(u => u.status === 'disabled');

  const renderRow = (u) => {
    const joinedTip = `Joined ${new Date(u.created_at).toLocaleDateString()}`;
    return (
      <tr key={u.id}>
        <td>
          <div className="admin-user-cell" title={joinedTip}>
            {u.avatar_url ? (
              <img src={u.avatar_url} alt="" className="admin-avatar" referrerPolicy="no-referrer" />
            ) : (
              <span className="admin-avatar admin-avatar-fallback">{(u.display_name || u.email).charAt(0).toUpperCase()}</span>
            )}
            <div>
              <div className="admin-name">
                {u.display_name || '—'} {u.is_admin && <span className="lb-admin-badge">Admin</span>}
              </div>
              <div className="admin-email">{u.email}</div>
            </div>
          </div>
        </td>
        <td data-label="Plan">{planPill(u)}</td>
        <td data-label="Last active">{lastActiveCell(u)}</td>
        <td data-label="Alerts">
          {/* Per-row "Subscribed to alerts" toggle. Maps to a row in
              alert_distribution_list keyed by the user's email. New
              signups are auto-subscribed in /auth/callback. */}
          <label
            className="admin-sub-toggle"
            title={u.is_subscribed
              ? 'Receiving the daily 6:30 AM ET pre-market digest. Uncheck to unsubscribe.'
              : 'Not on the daily digest list. Check to subscribe.'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, cursor: busyId === u.id ? 'wait' : 'pointer' }}
          >
            <input
              type="checkbox"
              checked={!!u.is_subscribed}
              disabled={busyId === u.id}
              onChange={(e) => updateUser(u.id, { is_subscribed: e.target.checked })}
            />
            <span style={{ fontSize: 12, color: u.is_subscribed ? '#4fc3f7' : '#7a9bc0' }}>
              {u.is_subscribed ? 'Subscribed' : 'Not subscribed'}
            </span>
          </label>
        </td>
        <td>
          <div className="admin-actions">
            {u.status !== 'approved' && (
              <button className="admin-btn admin-btn-approve" disabled={busyId === u.id}
                onClick={() => updateUser(u.id, { status: 'approved' })}>Approve</button>
            )}
            {u.status !== 'disabled' && u.id !== currentUserId && (
              <button className="admin-btn admin-btn-disable" disabled={busyId === u.id}
                onClick={() => updateUser(u.id, { status: 'disabled' })}>Disable</button>
            )}
            {u.status === 'disabled' && (
              <button className="admin-btn admin-btn-approve" disabled={busyId === u.id}
                onClick={() => updateUser(u.id, { status: 'approved' })}>Re-enable</button>
            )}
            {u.id !== currentUserId && (
              <button className="admin-btn admin-btn-secondary" disabled={busyId === u.id}
                onClick={() => updateUser(u.id, { is_admin: !u.is_admin })}>
                {u.is_admin ? 'Remove Admin' : 'Make Admin'}
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  // Shared header row used by all three sub-tables. Status + Joined got
  // folded into the Plan and Last active columns — Status was redundant
  // (everyone in the Approved section was "approved") and Joined is now
  // a tooltip on the user cell, freeing room for the two business-critical
  // metrics: monetisation state and recent activity.
  const tableHead = (
    <thead>
      <tr>
        <th>User</th>
        <th>Plan</th>
        <th>Last active</th>
        <th>Alerts</th>
        <th>Actions</th>
      </tr>
    </thead>
  );

  // Funnel summary — counted across the Approved cohort only. Pending
  // signups haven't started a trial yet, and disabled users aren't
  // monetisable, so we exclude both.
  const now = Date.now();
  const summary = approved.reduce((acc, u) => {
    if (u.plan === 'paid') acc.paid += 1;
    else if (u.plan === 'trial') acc.trial += 1;
    else if (u.plan === 'expired') acc.expired += 1;
    // Prefer the real activity timestamp; fall back to sign-in for users
    // who haven't yet been bumped since the last_active_at rollout.
    const activityTs = u.last_active_at || u.last_sign_in_at;
    if (activityTs) {
      const days = (now - new Date(activityTs).getTime()) / 86_400_000;
      if (days <= 7) acc.active7d += 1;
    }
    return acc;
  }, { paid: 0, trial: 0, expired: 0, active7d: 0 });

  return (
    <div className="admin-users-tab">
      <p className="section-hint" style={{ marginLeft: 0, marginTop: 0 }}>
        Approve new signups, disable access, or promote others to admin. New users are auto-added to the daily pre-market alert list — toggle <strong>Alerts</strong> to subscribe or unsubscribe anyone.
      </p>

      {pending.length > 0 && (
        <>
          <h3 className="admin-section-title">{"\u{23F3}"} Pending approval ({pending.length})</h3>
          <div className="pt-table-wrap"><table className="pt-table admin-table">
            {tableHead}
            <tbody>{pending.map(renderRow)}</tbody>
          </table></div>
        </>
      )}

      <h3 className="admin-section-title">{"\u{2705}"} Approved ({approved.length})</h3>

      {/* Funnel snapshot — quick at-a-glance view of monetisation state
          across the approved cohort. Lets us answer "how's the trial
          funnel doing today?" without scrolling rows. */}
      <div className="admin-stats">
        <div className="admin-stat admin-stat-paid">
          <div className="admin-stat-label">Paid</div>
          <div className="admin-stat-value">{summary.paid}</div>
        </div>
        <div className="admin-stat admin-stat-trial">
          <div className="admin-stat-label">On trial</div>
          <div className="admin-stat-value">{summary.trial}</div>
        </div>
        <div className="admin-stat admin-stat-expired">
          <div className="admin-stat-label">Trial expired</div>
          <div className="admin-stat-value">{summary.expired}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Active in 7d</div>
          <div className="admin-stat-value">{summary.active7d}</div>
        </div>
      </div>

      <div className="pt-table-wrap"><table className="pt-table admin-table">
        {tableHead}
        <tbody>{approved.map(renderRow)}</tbody>
      </table></div>

      {disabled.length > 0 && (
        <>
          <h3 className="admin-section-title">{"\u{1F6AB}"} Disabled ({disabled.length})</h3>
          <div className="pt-table-wrap"><table className="pt-table admin-table">
            {tableHead}
            <tbody>{disabled.map(renderRow)}</tbody>
          </table></div>
        </>
      )}
    </div>
  );
}

// ── Market Clock ──
// Single page-level clock showing current ET time + market status (open /
// closed / pre-market / after-hours) + a countdown to the next state change.
// Replaces the per-card "2:35 AM ET · closed" rows, which were redundant 59x.
function MarketClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    // Tick every 30s — enough granularity for a minute-resolution display
    // without spamming re-renders.
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Helpers to pull discrete ET fields from a Date object. Using
  // Intl.DateTimeFormat lets us avoid pulling in a tz library.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: '2-digit', weekday: 'short', hour12: true,
  }).formatToParts(now);
  const timeStr = parts.filter(p => ['hour','minute','literal','dayPeriod'].includes(p.type))
    .map(p => p.value).join('');
  const hour24 = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false,
  }).format(now), 10);
  const minute = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', minute: 'numeric',
  }).format(now), 10);
  const weekday = parts.find(p => p.type === 'weekday')?.value;
  const isWeekend = ['Sat','Sun'].includes(weekday);

  // Minutes since midnight ET for easy state math
  const mins = hour24 * 60 + minute;
  const PRE_OPEN  = 4 * 60;        //  4:00 AM ET — pre-market opens
  const OPEN      = 9 * 60 + 30;   //  9:30 AM ET — regular session opens
  const CLOSE     = 16 * 60;       //  4:00 PM ET — regular session closes
  const AFTER_END = 20 * 60;       //  8:00 PM ET — after-hours ends

  let status, statusCls, detail;
  if (isWeekend) {
    status = 'Closed';
    statusCls = 'mc-closed';
    // Days until Monday
    const daysToMonday = weekday === 'Sat' ? 2 : 1;
    const hoursToOpen  = daysToMonday * 24 + (OPEN - mins) / 60;
    detail = `Opens Monday ${fmtHoursCountdown(hoursToOpen * 60)}`;
  } else if (mins < PRE_OPEN) {
    status = 'Closed';
    statusCls = 'mc-closed';
    detail = `Pre-market in ${fmtCountdown(PRE_OPEN - mins)}`;
  } else if (mins < OPEN) {
    status = 'Pre-market';
    statusCls = 'mc-pre';
    detail = `Opens in ${fmtCountdown(OPEN - mins)}`;
  } else if (mins < CLOSE) {
    status = 'Open';
    statusCls = 'mc-open';
    detail = `Closes in ${fmtCountdown(CLOSE - mins)}`;
  } else if (mins < AFTER_END) {
    status = 'After-hours';
    statusCls = 'mc-after';
    detail = `After-hours ends ${fmtCountdown(AFTER_END - mins)}`;
  } else {
    status = 'Closed';
    statusCls = 'mc-closed';
    // next trading day
    const daysToNext = weekday === 'Fri' ? 3 : 1;
    const hoursToOpen = daysToNext * 24 + (OPEN - mins) / 60;
    detail = `Opens ${daysToNext === 1 ? 'tomorrow' : 'Monday'} ${fmtHoursCountdown(hoursToOpen * 60)}`;
  }

  return (
    <div className="market-clock" title={`Current Eastern Time: ${timeStr}`}>
      <span className="mc-time">{timeStr} ET</span>
      <span className={`mc-status ${statusCls}`}>
        <span className="mc-dot" />
        {status}
      </span>
      <span className="mc-detail">{detail}</span>
    </div>
  );
}

// Format N minutes as "1h 23m" or "23m"
function fmtCountdown(totalMins) {
  const m = Math.max(0, Math.round(totalMins));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}
// Format N minutes over long spans — renders "2d 14h" style
function fmtHoursCountdown(totalMins) {
  const m = Math.max(0, Math.round(totalMins));
  const d = Math.floor(m / (60 * 24));
  const h = Math.floor((m % (60 * 24)) / 60);
  return d > 0 ? `in ${d}d ${h}h` : `in ${h}h`;
}

export default function Dashboard() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [recFilter, setRecFilter] = useState('ALL');   // 'ALL' | 'BUY' | 'HOLD' | 'TRIM' | 'RIDING' | 'EXIT' | 'SELL'
  const [activeTab, setActiveTab] = useState('active');
  const [searchQuery, setSearchQuery] = useState('');
  // Drives the unified-search results dropdown (2026-05-12). Mirrors the
  // input's focused state but also stays open while the user is hovering
  // / tapping results — onBlur uses a 200ms timeout so the click registers
  // before we close. Cleared on tap-outside via the document-level handler.
  const [searchFocused, setSearchFocused] = useState(false);
  const [mcapRange, setMcapRange] = useState([0, 5000]);
  const [showArchive, setShowArchive] = useState(false);
  const [showDistList, setShowDistList] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [aiSettings, setAISettings] = useState({});
  const [watchlist, setWatchlistState] = useState([]);
  const [paperTrades, setPaperTrades] = useState([]);
  // "Collapse all / Expand all" toggle. allCompact remembers the target
  // state; compactNonce bumps every click so cards' useEffect re-fires and
  // re-syncs even if the user individually re-toggled a card in between.
  const [allCompact, setAllCompact] = useState(false);
  const [compactNonce, setCompactNonce] = useState(0);
  // Live ticker -> { price, price_date, updated_at } map. Single source of
  // truth for Portfolio + Leaderboard P/L so staleness in one user's
  // alerts[] can't skew everyone else's view. Refreshed on a 2-min timer
  // plus on tab focus, plus on the manual "Refresh prices" button.
  const [prices, setPrices] = useState({});
  const [pricesAsOf, setPricesAsOf] = useState(null);
  const [pricesRefreshing, setPricesRefreshing] = useState(false);
  const [buyModalState, setBuyModalState] = useState(null);   // { alert, currentPrice }
  const [sellModalState, setSellModalState] = useState(null); // { trade, currentPrice }
  // ticker (string) when the user clicks "view card" inside the Portfolio tab.
  // The modal renders the live AlertCard for that ticker so they can review
  // current AI rec / entry / target / stop without leaving Portfolio.
  const [cardModalTicker, setCardModalTicker] = useState(null);
  const [profile, setProfile] = useState(null);
  // Lemon Squeezy subscription (status, renews_at, ends_at, customer_portal_url, ...)
  // Used to render a "Manage subscription" link in the profile menu when the
  // user has an active LS sub — deep-links to LS's hosted customer portal.
  const [subscription, setSubscription] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  // More-menu (kebab) in the header — holds secondary destinations
  // (Quick Scan, Dropped, Archive, Alert List, Analytics, AI Settings, Users)
  // so the primary tab row stays focused on 5 workflow tabs.
  const [kebabOpen, setKebabOpen] = useState(false);
  // Quick Scan table is hidden by default (takes a lot of vertical space);
  // revealed on demand via the ⋯ kebab menu, same UX as Archive.
  const [showQuickScan, setShowQuickScan] = useState(false);
  // ─── Card / Table view toggle (2026-05-12 v3) ──────────────────────
  // Global view switcher in the header — applies to the New, Active and
  // Portfolio tabs. 'cards' renders the existing .ac-* AlertCard grid
  // (mobile-first, Robinhood-style). 'table' renders the QuickTable
  // component (dense, sortable, power-user friendly). Default = 'cards'
  // for the beautiful first impression. User's choice persists in the
  // `sc_view_mode` cookie so it sticks across sessions and devices that
  // share a browser profile.
  const [viewMode, setViewMode] = useState('cards'); // 'cards' | 'table'
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const m = document.cookie.match(/(?:^|; )sc_view_mode=([^;]*)/);
    if (m && (m[1] === 'table' || m[1] === 'cards')) setViewMode(m[1]);
  }, []);
  const handleSetViewMode = useCallback((m) => {
    setViewMode(m);
    if (typeof document !== 'undefined') {
      document.cookie = `sc_view_mode=${m}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
    }
  }, []);
  // ─── Card sort-by control (2026-05-14) ─────────────────────────────
  // The Active tab can hold 100+ cards, so AJ asked for a way to re-order
  // them. 'strength' (default) keeps the original strongest-signal-first
  // sort; the other modes sort by date or performance. Persists in the
  // `stock_sort_mode` cookie. Initialised to 'strength' on the server and
  // synced from the cookie after mount to avoid a hydration mismatch.
  const [sortMode, setSortMode] = useState('strength');
  useEffect(() => { setSortMode(getSortMode()); }, []);
  const handleSetSortMode = useCallback((m) => {
    setSortMode(m);
    setSortModeCookie(m);
  }, []);
  // Close the ⋯ kebab dropdown when the user clicks anywhere outside it.
  useEffect(() => {
    if (!kebabOpen) return;
    const onDocClick = (e) => {
      if (!e.target.closest('.kebab-menu-wrap')) setKebabOpen(false);
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, [kebabOpen]);
  // Per-user ticker notes, keyed by ticker symbol. Loaded alongside alerts.
  const [userNotes, setUserNotes] = useState({});
  // ─── Sector Pulse (added 2026-05-08) ──────────────────────────────
  // tickerMetaMap: { TICKER: { sector, industry, display_name } } populated
  //   by /api/ticker-meta. Drives the sector chip on each card AND the
  //   per-sector card-count shown in the Sector Pulse row.
  // sectorFilter: 'ALL' (default) or the industry name to filter by. Wired
  //   into applyAllFilters as an additional, optional filter step. Existing
  //   filter behaviour is unchanged when sectorFilter === 'ALL'.
  const [tickerMetaMap, setTickerMetaMap] = useState({});
  const [sectorFilter, setSectorFilter] = useState('ALL');
  // Sector Pulse inline accordion was retired 2026-05-12 v2 — see the
  // "Filters & Sectors" panel below. localStorage key `sectorPulseOpen`
  // is now ignored; left orphaned for users who had it set, no harm.

  // ─── Filters & Sectors panel (2026-05-12) ─────────────────────────
  // The Market Cap slider and Sector Pulse bar used to live inline in
  // the chip row / accordion right below the tabs. On mobile they ate
  // valuable real estate, and the Sector Pulse fetch made the inline
  // expand feel laggy. Both filters are now hidden behind one entry in
  // the ⋯ kebab menu ("Filters & Sectors"), and the Sector Pulse data
  // is preloaded on dashboard mount so the panel snaps open instantly.
  const [showFiltersPanel, setShowFiltersPanel] = useState(false);
  const [preloadedSectorPulse, setPreloadedSectorPulse] = useState(null);
  useEffect(() => {
    if (!profile) return;
    let cancelled = false;
    fetch('/api/sector-pulse', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!cancelled && d?.sectors) setPreloadedSectorPulse(d.sectors); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [profile]);

  // ─── Portfolio sub-filter (Phase 8 — 2026-05-12) ────────────────────
  // Filter chip selection inside the unified Portfolio tab — replaces
  // the older split between Watchlist + Portfolio tabs by letting the user
  // see everything personal in one place and filter by lifecycle state.
  //   all       → every ticker on the user's watchlist
  //   watching  → in watchlist + no open paper position
  //   holding   → has an open paper position
  //   sold      → has a closed paper position (no open one)
  // Default = 'watching' so the tab opens to the user's biggest, most-
  // checked bucket (pre-buy research list), matching Robinhood UX.
  const [myStocksFilter, setMyStocksFilter] = useState('watching');

  // ─── AddStockSheet (new unified add flow) ──────────────────────────
  // sheetOpen        — boolean, controls the bottom-sheet's visibility
  // sheetPrefill     — { ticker, company, alert } when opened from a card's "+ Track"
  // serverWatchlist  — Supabase-backed watchlist (replaces cookie-based eventually).
  //                    Loaded on mount; refetched after every add/remove.
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetPrefill, setSheetPrefill] = useState(null);
  const [serverWatchlist, setServerWatchlist] = useState([]);
  const refreshServerWatchlist = useCallback(async () => {
    try {
      const r = await fetch('/api/watchlist', { credentials: 'include' });
      if (r.ok) {
        const data = await r.json();
        setServerWatchlist(data.watchlist || []);
        // Keep the legacy cookie-based `watchlist` state in sync with the
        // server, so the existing Watchlist tab + filter logic keeps working
        // unchanged. The cookie becomes a write-cache of the server list.
        const tickers = (data.watchlist || []).map((w) => (w.ticker || '').toUpperCase()).filter(Boolean);
        setWatchlistState(tickers);
        setWatchlist(tickers);    // also persist to cookie (legacy compatibility)
      }
    } catch { /* non-fatal */ }
  }, []);

  // ── One-time cookie → Supabase migration ──
  // On the first dashboard load after Phase 6 deploys, any tickers in the
  // legacy `stock_watchlist` cookie are POSTed to /api/watchlist (so they
  // persist server-side, per-user, cross-device). Migration runs at most
  // once per browser, gated by the `wl_migrated_v1` cookie flag.
  const migrateCookieWatchlist = useCallback(async () => {
    if (typeof document === 'undefined') return;
    if (document.cookie.match(/(?:^|; )wl_migrated_v1=1/)) return; // already done
    const cookieList = getWatchlist();
    if (!cookieList || cookieList.length === 0) {
      document.cookie = `wl_migrated_v1=1; path=/; max-age=${60 * 60 * 24 * 3650}; SameSite=Lax`;
      return;
    }
    // Fetch current server watchlist so we don't re-add tickers already there
    let existing = new Set();
    try {
      const r = await fetch('/api/watchlist', { credentials: 'include' });
      if (r.ok) {
        const data = await r.json();
        (data.watchlist || []).forEach((w) => existing.add((w.ticker || '').toUpperCase()));
      }
    } catch { /* ignore */ }

    // POST every cookie ticker that isn't already on the server
    let added = 0;
    for (const t of cookieList) {
      const ticker = (t || '').toUpperCase();
      if (!ticker || existing.has(ticker)) continue;
      try {
        const r = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ticker, source: 'cookie_migration' }),
        });
        if (r.ok) added += 1;
      } catch { /* skip this one, keep going */ }
    }

    // Mark done so we don't run again. Keep the cookie itself for now in
    // case the server lookup fails on slow first paint — refreshServerWatchlist
    // will overwrite it with the canonical list right after.
    document.cookie = `wl_migrated_v1=1; path=/; max-age=${60 * 60 * 24 * 3650}; SameSite=Lax`;
    if (added > 0) await refreshServerWatchlist();
  }, [refreshServerWatchlist]);
  const openAddSheet = useCallback((prefill = null) => {
    setSheetPrefill(prefill);
    setSheetOpen(true);
  }, []);
  const closeAddSheet = useCallback(() => {
    setSheetOpen(false);
    // Clear prefill after close animation finishes
    setTimeout(() => setSheetPrefill(null), 400);
  }, []);

  const router = useRouter();

  useEffect(() => {
    setWatchlistState(getWatchlist());
    setMcapRange(getMarketCapFilter());
    // First load: migrate legacy cookie watchlist to Supabase (one-shot),
    // then pull the canonical server list. After this, the cookie is just
    // a write-through cache kept in sync by refreshServerWatchlist.
    migrateCookieWatchlist().finally(() => refreshServerWatchlist());

    // Load the logged-in user's profile (Google-auth). If none, send to /
    fetch('/api/profile')
      .then(res => {
        if (res.status === 401) { router.replace('/login'); return null; }
        return res.json();
      })
      .then(data => {
        if (data?.profile) {
          if (data.profile.status !== 'approved') { router.replace('/pending'); return; }

          // ─── 7-DAY NO-CC TRIAL GATE ─────────────────────────────
          // If the user is on the auto-approved trial path AND the trial
          // has expired AND they don't have an active LS subscription,
          // bounce them to /upgrade. Existing approved users have
          // trial_ends_at = NULL → this check is skipped for them.
          const trialEndsAt = data.profile.trial_ends_at
            ? new Date(data.profile.trial_ends_at)
            : null;
          const subStatus = (data.subscription?.status || '').toLowerCase();
          const hasActiveSub = subStatus === 'active'
            || subStatus === 'on_trial'
            || subStatus === 'past_due';
          if (trialEndsAt && trialEndsAt.getTime() <= Date.now() && !hasActiveSub) {
            router.replace('/upgrade');
            return;
          }

          setProfile(data.profile);
          setSubscription(data.subscription || null);
          // Apply the user's saved card-expand preference. 'compact' means
          // every card starts collapsed; 'expanded' (default) means every
          // card starts fully expanded. Still respects per-card toggles
          // afterwards — this only sets the initial global default.
          if (data.profile.card_expand_default === 'compact') {
            setAllCompact(true);
            setCompactNonce(n => n + 1);
          }
        }
      })
      .catch(() => {});

    fetch('/api/alerts')
      .then(res => {
        if (res.status === 401) { router.replace('/login'); return null; }
        return res.json();
      })
      .then(data => {
        if (data?.alerts) setAlerts(data.alerts);
        setLoading(false);
      })
      .catch(() => router.replace('/login'));

    // Fetch paper trades
    fetch('/api/paper-trades')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.trades) setPaperTrades(data.trades); })
      .catch(() => {});

    // Fetch per-user notes ({ ticker: { note, updated_at } })
    fetch('/api/notes')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data?.notes) return;
        const map = {};
        Object.entries(data.notes).forEach(([t, v]) => { map[t] = v.note; });
        setUserNotes(map);
      })
      .catch(() => {});

    // Fetch AI settings
    fetch('/api/settings')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.settings) setAISettings(data.settings); })
      .catch(() => {});

    // Fetch ticker_meta lookup ({ TICKER: { sector, industry, display_name } })
    // for the new Sector Pulse feature. Optional — if the endpoint 404s or
    // ticker_meta is empty, the dashboard renders identically to before.
    fetch('/api/ticker-meta')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data?.items) return;
        const map = {};
        for (const m of data.items) {
          if (m.ticker) map[String(m.ticker).toUpperCase()] = m;
        }
        setTickerMetaMap(map);
      })
      .catch(() => {});
  }, [router]);

  // ── Live price refresh ─────────────────────────────────────────────
  // Fetches the shared current_prices map from /api/prices. Called on
  // mount, every 2 minutes while the tab is visible, whenever the user
  // switches back to the tab, and on-demand via the Refresh button.
  // refreshPrices(forceRefetch?) — by default just rereads /api/prices
  // (cheap, fires on a 2-minute timer). When `forceRefetch` is true (the
  // user clicked the Refresh button), POST /api/refresh-prices first to
  // actually go fetch from Yahoo, then re-read.
  const refreshPrices = useCallback(async (forceRefetch = false) => {
    try {
      setPricesRefreshing(true);
      if (forceRefetch) {
        // Don't block on the response body — the timeout is generous and
        // we want to show the user fresh data ASAP. If it fails, the read
        // below still returns whatever we had.
        try {
          await fetch('/api/refresh-prices', {
            method: 'POST',
            cache: 'no-store',
          });
        } catch {
          // ignore — fall through to the read
        }
      }
      const res = await fetch('/api/prices', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.prices) setPrices(data.prices);
      if (data?.as_of) setPricesAsOf(data.as_of);
    } catch {
      // Intentionally swallow — next poll will retry. A failed refresh
      // should never break the dashboard.
    } finally {
      setPricesRefreshing(false);
    }
  }, []);

  useEffect(() => {
    // Initial fetch
    refreshPrices();

    // 2-minute polling, paused while tab is hidden to save bandwidth.
    let intervalId = null;
    const startPolling = () => {
      if (intervalId != null) return;
      intervalId = setInterval(refreshPrices, 120_000);
    };
    const stopPolling = () => {
      if (intervalId == null) return;
      clearInterval(intervalId);
      intervalId = null;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshPrices(); // Catch up immediately on focus
        startPolling();
      } else {
        stopPolling();
      }
    };

    // Start polling if tab is currently visible
    if (document.visibilityState === 'visible') startPolling();
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', refreshPrices);

    return () => {
      stopPolling();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', refreshPrices);
    };
  }, [refreshPrices]);

  // Also refetch paper trades alongside prices so Portfolio P/L stays
  // consistent when another tab/session closes a trade.
  const refreshPaperTrades = useCallback(async () => {
    try {
      const res = await fetch('/api/paper-trades');
      if (!res.ok) return;
      const data = await res.json();
      if (data?.trades) setPaperTrades(data.trades);
    } catch {}
  }, []);

  const handleToggleWatchlist = useCallback(async (ticker) => {
    // Legacy entry point still wired into a few places (archive restore,
    // archive table row, etc). Now also syncs to the Supabase watchlist
    // table so the new server-of-truth stays current.
    const t = (ticker || '').toUpperCase();
    if (!t) return;
    const wasOnList = getWatchlist().includes(t);
    const newList = toggleWatchlist(t);
    setWatchlistState([...newList]);
    try {
      if (wasOnList) {
        await fetch(`/api/watchlist?ticker=${encodeURIComponent(t)}`, { method: 'DELETE', credentials: 'include' });
      } else {
        await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ ticker: t, source: 'manual' }),
        });
      }
      refreshServerWatchlist();
    } catch { /* non-fatal — cookie already updated, server will re-sync next refresh */ }
  }, [refreshServerWatchlist]);

  const handleSignOut = useCallback(async () => {
    try {
      const { createSupabaseBrowserClient } = await import('../lib/supabase/browser');
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      // Also clear the legacy cookie
      document.cookie = 'stock_auth=; Path=/; Max-Age=0; SameSite=Lax';
      router.replace('/login');
    } catch {
      router.replace('/login');
    }
  }, [router]);

  const handleSaveDisplayName = useCallback(async () => {
    const newName = nameInput.trim();
    if (newName.length < 2) return;
    try {
      const res = await fetch('/api/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ display_name: newName }),
      });
      if (res.ok) {
        const data = await res.json();
        setProfile(data.profile);
        setEditingName(false);
      }
    } catch {}
  }, [nameInput]);

  const handleRate = useCallback(async (alertId, rating) => {
    // Optimistic update — and if the user is marking 'down' ("Not for me"),
    // also dismiss the card from their feed in the same gesture. One tap
    // does both: rates negatively AND hides from view. The card is still
    // reachable from the Archive view via "Bring back".
    setAlerts(prev => prev.map(a => {
      if (a.id !== alertId) return a;
      const next = { ...a, user_rating: rating };
      if (rating === 'down') next.dismissed_at = new Date().toISOString();
      return next;
    }));

    try {
      if (rating === null) {
        await fetch(`/api/ratings?alert_id=${alertId}`, { method: 'DELETE' });
      } else {
        await fetch('/api/ratings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alert_id: alertId, rating }),
        });
        // Auto-dismiss on negative rating (folds the old × button into 👎)
        if (rating === 'down') {
          await fetch('/api/dismiss', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alert_id: alertId }),
          }).catch(() => {});
        }
      }
    } catch {
      // Revert on error
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, user_rating: a.user_rating } : a));
    }
  }, []);

  // ── Note save (per-ticker, per-user) ──
  // Empty string deletes the note server-side. Optimistic local update either way.
  const handleSaveNote = useCallback(async (ticker, note) => {
    const trimmed = (note || '').trim();
    setUserNotes(prev => {
      const next = { ...prev };
      if (trimmed) next[ticker] = trimmed;
      else delete next[ticker];
      return next;
    });
    try {
      await fetch('/api/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker, note: trimmed }),
      });
    } catch {
      // On error, leave the optimistic state — user can retry on next edit
    }
  }, []);

  // ── Dismiss / archive a pick (user-scoped) ──
  // Optimistically sets dismissed_at locally so the card drops out of
  // the active view immediately. Archive tab can still find it.
  const handleDismiss = useCallback(async (alertId) => {
    setAlerts(prev => prev.map(a =>
      a.id === alertId ? { ...a, dismissed_at: new Date().toISOString() } : a
    ));
    try {
      await fetch('/api/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ alert_id: alertId }),
      });
    } catch {
      // revert
      setAlerts(prev => prev.map(a =>
        a.id === alertId ? { ...a, dismissed_at: null } : a
      ));
    }
  }, []);

  // ── Un-dismiss / restore a pick from the archive ──
  const handleUnDismiss = useCallback(async (alertId) => {
    setAlerts(prev => prev.map(a =>
      a.id === alertId ? { ...a, dismissed_at: null } : a
    ));
    try {
      await fetch(`/api/dismiss?alert_id=${alertId}`, { method: 'DELETE' });
    } catch {
      // revert: leave as dismissed on failure (user can retry)
    }
  }, []);

  // ── Paper-trading handlers ──
  const openTradeFor = useCallback((ticker) => {
    return paperTrades.find(t => t.ticker === ticker && t.status === 'open');
  }, [paperTrades]);

  const handleOpenBuyModal = useCallback((alert, currentPrice) => {
    setBuyModalState({ alert, currentPrice });
  }, []);

  const handleOpenSellModal = useCallback((trade, currentPrice) => {
    setSellModalState({ trade, currentPrice });
  }, []);

  const handleConfirmBuy = useCallback(async ({ amount, notes }) => {
    const { alert, currentPrice } = buyModalState;
    const res = await fetch('/api/paper-trades', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ticker: alert.ticker,
        company: alert.company,
        alert_id: alert.id,
        entry_price: currentPrice,
        entry_amount: amount,
        ai_recommendation_at_entry: alert.recommendation || 'HOLD',
        signal_strength_at_entry: alert.signal_strength ?? null,
        signal_type_at_entry: alert.signal_type || null,
        notes,
        // Freeze the AI reasoning at the moment of purchase so audit trail
        // survives even if the underlying alert is re-rated or dropped.
        recommendation_reason_at_entry: alert.recommendation_reason || null,
        alert_reason_at_entry: alert.alert_reason || null,
        forecast_sell_date_at_entry: alert.forecast_sell_date || null,
        market_cap_at_entry: alert.market_cap ?? null,
        source_at_entry: alert.source || null,
      }),
    });
    if (!res.ok) throw new Error('Server rejected the trade');
    const data = await res.json();
    if (data?.trade) setPaperTrades(prev => [data.trade, ...prev]);
    setBuyModalState(null);
  }, [buyModalState]);

  const handleConfirmSell = useCallback(async ({ price, ai_review_verdict, ai_review_notes }) => {
    const { trade } = sellModalState;
    const res = await fetch('/api/paper-trades', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: trade.id,
        exit_price: price,
        ai_review_verdict: ai_review_verdict ?? null,
        ai_review_notes: ai_review_notes ?? null,
      }),
    });
    if (!res.ok) throw new Error('Server rejected the sell');
    const data = await res.json();
    if (data?.trade) {
      setPaperTrades(prev => prev.map(t => t.id === data.trade.id ? data.trade : t));
    }
    setSellModalState(null);
  }, [sellModalState]);

  const handleDeleteTrade = useCallback(async (id) => {
    const res = await fetch(`/api/paper-trades?id=${id}`, { method: 'DELETE' });
    if (res.ok) setPaperTrades(prev => prev.filter(t => t.id !== id));
  }, []);

  // Save / edit the AI review on an already-closed trade (post-trade feedback loop).
  const handleUpdateReview = useCallback(async (id, { verdict, notes }) => {
    const res = await fetch('/api/paper-trades', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        ai_review_verdict: verdict ?? null,
        ai_review_notes: notes ?? null,
      }),
    });
    if (!res.ok) throw new Error('Failed to save review');
    const data = await res.json();
    if (data?.trade) {
      setPaperTrades(prev => prev.map(t => t.id === data.trade.id ? data.trade : t));
    }
  }, []);

  const handleJumpToCard = useCallback((alert) => {
    // Active picks may live in the Chatter tab if they had a recent
    // recommendation flip — route to the same tab the card actually renders in.
    const isChatter = alert.status === 'active' && hasRecentFlip(alert);
    const tab = alert.status === 'dropped' ? 'dropped'
      : alert.status === 'new' ? 'new'
      : isChatter ? 'chatter'
      : 'active';
    setActiveTab(tab);
    setSearchQuery('');
    setRecFilter('ALL');
    setTimeout(() => {
      const el = document.getElementById(`card-${alert.ticker}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('card-flash');
        setTimeout(() => el.classList.remove('card-flash'), 1600);
      }
    }, 120);
  }, []);

  const handleSaveAISetting = useCallback(async (key, value) => {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      });
      if (res.ok) {
        setAISettings(prev => ({ ...prev, [key]: value }));
      }
    } catch (err) {
      console.error('Failed to save AI setting:', err);
    }
  }, []);

  const getLatestPct = useCallback((alert) => {
    const latest = alert.prices[alert.prices.length - 1];
    return latest?.pct_change || 0;
  }, []);

  // Sort picks STRONGEST-FIRST by signal_strength, then performance as a tiebreaker.
  const sortByPerf = (list) => [...list].sort((a, b) => {
    const ssa = a.signal_strength ?? 0;
    const ssb = b.signal_strength ?? 0;
    if (ssb !== ssa) return ssb - ssa;
    const pa = getLatestPct(a);
    const pb = getLatestPct(b);
    const sa = getStatus(pa) === 'win' ? 0 : getStatus(pa) === 'neutral' ? 1 : 2;
    const sb = getStatus(pb) === 'win' ? 0 : getStatus(pb) === 'neutral' ? 1 : 2;
    if (sa !== sb) return sa - sb;
    return pb - pa;
  });

  // sortPicks — re-orders a (already filtered) pick list per the user's
  // chosen sortMode. 'strength' is the original sortByPerf behaviour; the
  // other modes let AJ scan a big Active tab by recency or performance.
  // Always returns a new array so we never mutate the memoised lists.
  const sortPicks = useCallback((list) => {
    if (!Array.isArray(list)) return [];
    if (sortMode === 'strength') return sortByPerf(list);
    const arr = [...list];
    const alertMs = (a) => {
      const t = a.alert_date ? new Date(a.alert_date + 'T00:00:00').getTime() : 0;
      return Number.isNaN(t) ? 0 : t;
    };
    switch (sortMode) {
      case 'updated':
        arr.sort((a, b) => lastActivityMs(b) - lastActivityMs(a));
        break;
      case 'newest':
        arr.sort((a, b) => alertMs(b) - alertMs(a) || lastActivityMs(b) - lastActivityMs(a));
        break;
      case 'oldest':
        arr.sort((a, b) => alertMs(a) - alertMs(b) || lastActivityMs(a) - lastActivityMs(b));
        break;
      case 'best':
        arr.sort((a, b) => getLatestPct(b) - getLatestPct(a));
        break;
      case 'worst':
        arr.sort((a, b) => getLatestPct(a) - getLatestPct(b));
        break;
      default:
        return sortByPerf(list);
    }
    return arr;
  }, [sortMode, getLatestPct]);

  // Apply all filters: search + recommendation + market cap
  // (Old signal-type filter was removed 2026-04-21 — replaced by the
  // quick Buy/Hold/Trim/Exit/Sell chip row under the tabs.)
  const applyAllFilters = useCallback((list) => {
    let filtered = list;

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(a =>
        a.ticker.toLowerCase().includes(q) ||
        a.company.toLowerCase().includes(q)
      );
    }

    // Recommendation filter (BUY / HOLD / TRIM / EXIT / SELL)
    if (recFilter !== 'ALL') filtered = filtered.filter(a => a.recommendation === recFilter);

    // Market cap filter
    if (mcapRange[0] > 0 || mcapRange[1] < 5000) {
      filtered = filtered.filter(a => {
        if (a.market_cap === null || a.market_cap === undefined) return true; // Show stocks without market cap data
        return a.market_cap >= mcapRange[0] && a.market_cap <= mcapRange[1];
      });
    }

    // Sector filter (added 2026-05-08). Only narrows when the user has picked
    // a specific sector in the new Sector Pulse bar. ALL is the default and
    // is a no-op so all existing card flows behave identically.
    if (sectorFilter !== 'ALL') {
      filtered = filtered.filter(a => {
        const meta = tickerMetaMap[String(a.ticker).toUpperCase()];
        return meta && meta.industry === sectorFilter;
      });
    }

    return filtered;
  }, [recFilter, searchQuery, mcapRange, sectorFilter, tickerMetaMap]);

  // Dismissed rows drop out of the normal tabs (they reappear in the Archive section).
  const notDismissed = (a) => !a.dismissed_at;

  // Tab routing rules (2026-05-13):
  //   - New     → status='new' only. Truly brand-new overnight picks.
  //   - Chatter → status='active' AND the AI's recommendation flipped
  //               (e.g. HOLD→BUY) in the last 24h. Carved out of Active so
  //               each card lives in exactly one tab.
  //   - Active  → status='active' AND no recent flip. Still tracked, quiet.
  //   - Dropped → status='dropped'.
  // The 6:30 AM email digest has its own split ("Brand-new picks" vs.
  // "Fresh signals on existing picks") and is unaffected by tab routing.

  // hasRecentFlip — drives Chatter tab. Returns true if any signal change
  // in the last 24h actually changed the recommendation (old !== new), so
  // pure re-detections without a call change don't count.
  const FLIP_WINDOW_HOURS = 24;
  const hasRecentFlip = (a) => {
    const cutoffMs = Date.now() - FLIP_WINDOW_HOURS * 60 * 60 * 1000;
    const isFlip = (sc) => {
      if (!sc) return false;
      const ts = new Date(sc.change_date || sc.created_at || 0).getTime();
      if (!(ts >= cutoffMs)) return false;
      return sc.old_recommendation && sc.new_recommendation
        && sc.old_recommendation !== sc.new_recommendation;
    };
    if (isFlip(a.latest_signal_change)) return true;
    if (Array.isArray(a.signal_change_history)) {
      for (const sc of a.signal_change_history) if (isFlip(sc)) return true;
    }
    return false;
  };

  // ────────────────────────────────────────────────────────────────────
  // Dedupe alerts by ticker (2026-05-12). Older signal cycles for the
  // same stock used to render as separate cards. Now one card per
  // ticker — older cycles' signal_change_history is merged into the
  // most-recent (kept) row so the accordion history captures it all.
  //
  // /api/alerts returns rows ordered by alert_date DESC, so the FIRST
  // occurrence of each ticker we encounter is the most recent —
  // that's our "headline" alert for the card. We then walk the older
  // duplicates and fold their history into the kept alert's history.
  // ────────────────────────────────────────────────────────────────────
  const dedupedAlerts = useMemo(() => {
    const byTicker = new Map();   // ticker -> kept alert object (the headline)
    const extraHistory = new Map(); // ticker -> array of signal_changes from dropped duplicates

    for (const a of alerts) {
      const t = String(a.ticker || '').toUpperCase();
      if (!t) continue;

      if (!byTicker.has(t)) {
        // First time seeing this ticker → it's the most recent (headline)
        byTicker.set(t, a);
        continue;
      }

      // Duplicate row — fold its history into the kept ticker's bucket.
      // We also fold its latest_signal_change in case signal_change_history
      // wasn't populated for the duplicate row.
      const bucket = extraHistory.get(t) || [];
      if (Array.isArray(a.signal_change_history)) {
        bucket.push(...a.signal_change_history);
      }
      if (a.latest_signal_change) bucket.push(a.latest_signal_change);
      extraHistory.set(t, bucket);
    }

    // Now produce the result array. For each kept alert, merge its own
    // history with any extras, dedupe by id (or change_date+old+new key
    // for legacy rows), and sort newest first.
    const out = [];
    for (const [t, kept] of byTicker.entries()) {
      const extras = extraHistory.get(t) || [];
      if (extras.length === 0) {
        out.push(kept);
        continue;
      }
      const combined = [...(kept.signal_change_history || []), ...extras];
      const seen = new Map();
      for (const sc of combined) {
        if (!sc) continue;
        const key = sc.id || `${sc.change_date || sc.created_at}-${sc.old_recommendation}-${sc.new_recommendation}`;
        if (!seen.has(key)) seen.set(key, sc);
      }
      const merged = Array.from(seen.values()).sort((x, y) => {
        const xt = new Date(x.change_date || x.created_at || 0).getTime();
        const yt = new Date(y.change_date || y.created_at || 0).getTime();
        return yt - xt; // newest first
      });
      out.push({ ...kept, signal_change_history: merged });
    }
    return out;
  }, [alerts]);

  // RIDING tab carve-out (added 2026-05-14). A RIDING alert is status=active,
  // but it deserves its own spotlight: target's been hit, signals still firing,
  // trail stop locked in. We carve these out of BOTH Active and Chatter so
  // each card lives in exactly one tab (preserves the 2026-05-13 routing rule).
  const isRiding = (a) => (a.recommendation || '').toUpperCase() === 'RIDING';

  const newPicks = useMemo(() => sortByPerf(dedupedAlerts.filter(a =>
    a.status === 'new' && notDismissed(a)
  )), [dedupedAlerts]);
  const chatterPicks = useMemo(() => sortByPerf(dedupedAlerts.filter(a =>
    a.status === 'active' && notDismissed(a) && hasRecentFlip(a) && !isRiding(a)
  )), [dedupedAlerts]);
  const activePicks = useMemo(() => sortByPerf(dedupedAlerts.filter(a =>
    a.status === 'active' && notDismissed(a) && !hasRecentFlip(a) && !isRiding(a)
  )), [dedupedAlerts]);
  const ridingPicks = useMemo(() => sortByPerf(dedupedAlerts.filter(a =>
    a.status === 'active' && notDismissed(a) && isRiding(a)
  )), [dedupedAlerts]);
  const droppedPicks = useMemo(() => sortByPerf(dedupedAlerts.filter(a => a.status === 'dropped' && notDismissed(a))), [dedupedAlerts]);
  // My Stocks tab data (was: watchlist tab). Includes any ticker that is
  //   - in the user's watchlist (cookie + server), OR
  //   - has any paper_trade (open or closed)
  // ...so the new unified "My Stocks" view shows everything the user is
  // tracking, regardless of whether the AI is currently flagging it.
  const watchlistPicks = useMemo(() => {
    const wlTickers = new Set((watchlist || []).map((t) => String(t).toUpperCase()));
    const tradeTickers = new Set((paperTrades || []).map((t) => String(t.ticker).toUpperCase()));
    const universe = dedupedAlerts.filter((a) => {
      const tk = String(a.ticker).toUpperCase();
      return (wlTickers.has(tk) || tradeTickers.has(tk)) && notDismissed(a);
    });
    const filtered = universe.filter((a) => {
      const tk = String(a.ticker).toUpperCase();
      const openTrade = (paperTrades || []).find((t) => String(t.ticker).toUpperCase() === tk && t.status === 'open');
      const closedTrade = (paperTrades || []).find((t) => String(t.ticker).toUpperCase() === tk && t.status === 'closed');
      switch (myStocksFilter) {
        case 'watching': return wlTickers.has(tk) && !openTrade;
        case 'holding':  return !!openTrade;
        case 'sold':     return !openTrade && !!closedTrade;
        case 'all':
        default:         return true;
      }
    });
    return sortByPerf(filtered);
  }, [dedupedAlerts, watchlist, paperTrades, myStocksFilter]);

  const filteredNew = useMemo(() => applyAllFilters(newPicks), [newPicks, applyAllFilters]);
  const filteredChatter = useMemo(() => applyAllFilters(chatterPicks), [chatterPicks, applyAllFilters]);
  const filteredActive = useMemo(() => applyAllFilters(activePicks), [activePicks, applyAllFilters]);
  const filteredRiding = useMemo(() => applyAllFilters(ridingPicks), [ridingPicks, applyAllFilters]);
  const filteredDropped = useMemo(() => applyAllFilters(droppedPicks), [droppedPicks, applyAllFilters]);
  const filteredWatchlist = useMemo(() => applyAllFilters(watchlistPicks), [watchlistPicks, applyAllFilters]);

  // ────────────────────────────────────────────────────────────────────
  // Unified-search results (2026-05-12). The top search bar is now a
  // discovery hub — it surfaces matches across the WHOLE deduped alert
  // universe (not just the current tab), grouped into:
  //   1. On your watchlist (tickers you're tracking OR have a paper-trade
  //      position in)
  //   2. All stocks (everything else the AI has flagged at some point)
  //   3. Add new TICKER (when the typed string looks like a fresh ticker
  //      that isn't in either group — bridges to the AddStockSheet flow)
  //
  // Tapping any group-1 / group-2 result opens the StockCardModal for that
  // ticker (the existing detail-modal hook), so search is no longer a
  // dead-end. Tapping "Add new" opens the position-logging sheet pre-filled
  // with that ticker.
  // ────────────────────────────────────────────────────────────────────
  const TICKER_REGEX = /^[A-Z0-9.\-]{1,10}$/;
  const searchResults = useMemo(() => {
    const q = (searchQuery || '').trim().toUpperCase();
    if (!q) return null;
    const wlSet = new Set((watchlist || []).map(t => String(t).toUpperCase()));
    const tradeSet = new Set((paperTrades || []).map(t => String(t.ticker).toUpperCase()));
    const tracked = (t) => wlSet.has(t) || tradeSet.has(t);
    const matchesQuery = (a) => {
      const t = String(a.ticker || '').toUpperCase();
      const c = String(a.company || '').toUpperCase();
      return t.includes(q) || c.includes(q);
    };
    const onWatchlist = [];
    const allStocks = [];
    for (const a of dedupedAlerts) {
      if (a.dismissed_at) continue;
      if (!matchesQuery(a)) continue;
      const t = String(a.ticker).toUpperCase();
      if (tracked(t)) onWatchlist.push(a);
      else allStocks.push(a);
    }
    const present = new Set([
      ...onWatchlist.map(a => String(a.ticker).toUpperCase()),
      ...allStocks.map(a => String(a.ticker).toUpperCase()),
    ]);
    const showAddNew = TICKER_REGEX.test(q) && !present.has(q);
    return {
      onWatchlist: onWatchlist.slice(0, 6),
      allStocks: allStocks.slice(0, 12),
      addNew: showAddNew ? q : null,
      onWatchlistTotal: onWatchlist.length,
      allStocksTotal: allStocks.length,
    };
  }, [searchQuery, dedupedAlerts, watchlist, paperTrades]);

  // Tap-handler for a search result row. Closes the dropdown + clears the
  // input so the cards return to their unfiltered view, then pops the
  // StockCardModal for the chosen ticker — the same detail view the
  // Portfolio tab uses, so the experience is consistent across the app.
  const handleSearchResultTap = useCallback((ticker) => {
    setCardModalTicker(String(ticker).toUpperCase());
    setSearchFocused(false);
    setSearchQuery('');
  }, []);

  // Tap-handler for the "Add new TICKER" footer row. Opens the existing
  // AddStockSheet pre-filled with the typed ticker so the user can finish
  // adding it to their watchlist or logging a position.
  const handleSearchAddNew = useCallback((ticker) => {
    const t = String(ticker || '').toUpperCase();
    if (!t) return;
    openAddSheet({ ticker: t, company: null, alert: null });
    setSearchFocused(false);
    setSearchQuery('');
  }, [openAddSheet]);

  // Which pick-list feeds the rec-filter chip counts — depends on active tab.
  // Counts reflect what's available to filter in the current view so users
  // never tap a pill that'd empty the grid.
  const currentTabPicks = useMemo(() => {
    switch (activeTab) {
      case 'new':       return newPicks;
      case 'chatter':   return chatterPicks;
      case 'watchlist': return watchlistPicks;
      case 'dropped':   return droppedPicks;
      case 'active':    return activePicks;
      case 'riding':    return ridingPicks;
      default:          return [];
    }
  }, [activeTab, newPicks, chatterPicks, activePicks, ridingPicks, watchlistPicks, droppedPicks]);

  const recCounts = useMemo(() => {
    const c = { ALL: 0, BUY: 0, HOLD: 0, TRIM: 0, RIDING: 0, EXIT: 0, SELL: 0 };
    for (const a of currentTabPicks) {
      c.ALL++;
      const r = a.recommendation;
      if (r && c[r] !== undefined) c[r]++;
    }
    return c;
  }, [currentTabPicks]);

  // Hide the rec-filter row on tabs that don't show pick cards.
  const showRecFilter = ['new', 'chatter', 'active', 'riding', 'watchlist', 'dropped'].includes(activeTab);

  // Global stats (totalCurrent / buys / sells / avgPct) — fold in chatter
  // picks since they're carved out of activePicks but still represent
  // "live, in-play" calls the user is acting on.
  const currentPicks = [...newPicks, ...chatterPicks, ...activePicks];
  const totalCurrent = currentPicks.length;
  const buys = currentPicks.filter(a => a.recommendation === 'BUY').length;
  const sells = currentPicks.filter(a => a.recommendation === 'SELL').length;
  const avgPct = currentPicks.length > 0
    ? (currentPicks.reduce((sum, a) => sum + getLatestPct(a), 0) / currentPicks.length) : 0;

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Primary tab definitions — shown in the main tab bar.
  // Secondary destinations (Dropped, Analytics, Users) live in the ⋯ kebab menu
  // in the header but still set `activeTab` so the tab-content blocks render.
  // The "watchlist" tab is the unified "Portfolio" view (Phase 8 — 2026-05-12).
  // Tab id stays as 'watchlist' for backward compatibility with existing
  // analytics and internal predicates; the LABEL is "Portfolio" and the tab
  // contains sub-pills All · Watching · Holding · Sold so users get one
  // home for everything personal (formerly two tabs: My Stocks + Portfolio).
  // Top tab row + mobile bottom nav share the same icon set — Lucide thin-outline
  // icons (2026-05-13). Active state colored via .tab-btn.active in globals.css.
  const tabs = [
    { id: 'new',         label: <><Ico name="belldot" size={14} /> New</>,     count: newPicks.length },
    { id: 'chatter',     label: <><Ico name="chat" size={14} /> Chatter</>,    count: chatterPicks.length },
    { id: 'active',      label: <><Ico name="flame" size={14} /> Active</>,    count: activePicks.length },
    // Riding tab (2026-05-14) — winners past their target, still firing,
    // protected by a trail stop. Lucide trending-up icon reads as "still
    // going up". Sits between Active and Portfolio per AJ's choice.
    { id: 'riding',      label: <><Ico name="trend" size={14} /> Riding</>,    count: ridingPicks.length },
    { id: 'watchlist',   label: <><Ico name="briefcase" size={14} /> Portfolio</>, count: watchlistPicks.length },
    { id: 'leaderboard', label: <><Ico name="trophy" size={14} /> Leaderboard</>, count: null },
  ];

  // Current tab data
  const getTabData = () => {
    let data;
    switch (activeTab) {
      case 'new': data = filteredNew; break;
      case 'chatter': data = filteredChatter; break;
      case 'active': data = filteredActive; break;
      case 'riding': data = filteredRiding; break;
      case 'dropped': data = filteredDropped; break;
      case 'watchlist': data = filteredWatchlist; break;
      default: data = filteredActive; break;
    }
    return sortPicks(data);
  };

  // Union of every ticker that might render a card on this page. Used by
  // <StockMetaProvider> to batch-fetch analyst + earnings + history data in
  // one round-trip instead of 3 per card.
  const allTickers = useMemo(() => {
    const set = new Set();
    alerts.forEach(a => a?.ticker && set.add(String(a.ticker).toUpperCase()));
    paperTrades.forEach(t => t?.ticker && set.add(String(t.ticker).toUpperCase()));
    watchlist.forEach(t => t && set.add(String(t).toUpperCase()));
    return [...set];
  }, [alerts, paperTrades, watchlist]);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p style={{ color: '#7a9bc0' }}>Loading stock intelligence...</p>
      </div>
    );
  }

  // ─── Trial banner state ─────────────────────────────────────────────
  // Show an always-visible "X days left in your trial — Subscribe" banner
  // for users on the no-CC trial path who don't yet have an active LS sub.
  // Hidden for legacy approved users (trial_ends_at = NULL) and active subs.
  const trialEndsAt = profile?.trial_ends_at ? new Date(profile.trial_ends_at) : null;
  const subStatusForBanner = (subscription?.status || '').toLowerCase();
  const hasActiveSubForBanner = subStatusForBanner === 'active'
    || subStatusForBanner === 'on_trial'
    || subStatusForBanner === 'past_due';
  const trialDaysLeft = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)))
    : null;
  const showTrialBanner = !!trialEndsAt && !hasActiveSubForBanner && trialDaysLeft !== null;
  const trialCheckoutUrl = process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL || '/upgrade';

  return (
    <StockMetaProvider tickers={allTickers}>
      {showTrialBanner && (
        <div
          className="trial-banner"
          role="status"
          aria-live="polite"
          style={{
            background: trialDaysLeft <= 2
              ? 'linear-gradient(90deg,#b91c1c,#ef4444)'
              : 'linear-gradient(90deg,#0b2540,#1565c0)',
            color: '#fff',
            padding: '10px 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            flexWrap: 'wrap',
            fontSize: 14,
            fontWeight: 600,
            position: 'sticky',
            top: 0,
            zIndex: 100,
            boxShadow: '0 2px 6px rgba(0,0,0,0.15)',
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <Ico name={trialDaysLeft <= 1 ? 'warning' : 'gift'} size={14} />
            {trialDaysLeft === 0
              ? 'Your free trial ends today'
              : trialDaysLeft === 1
              ? '1 day left in your free trial'
              : `${trialDaysLeft} days left in your free trial`}
          </span>
          <a
            href={trialCheckoutUrl}
            rel="nofollow"
            style={{
              background: '#fff',
              color: '#0b2540',
              padding: '6px 14px',
              borderRadius: 999,
              fontWeight: 700,
              fontSize: 13,
              textDecoration: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Subscribe — AUD&nbsp;$199/yr
          </a>
        </div>
      )}
      <header className="header">
        <div className="header-main">
          <h1>
            <img src="/logo-sm.png" alt="" className="header-logo" width="36" height="36" />
            Stock <span>Chatter</span>
          </h1>
          <div className="subtitle">Last updated: {dateStr} {"\u{B7}"} Auto-scan complete</div>
          <MarketClock />
        </div>
        <div className="header-tools">
          {/* ─── ASK GEMINI AI ───
              REMOVED 2026-05-11 \u2014 Ask Gemini button was retired from the
              header to declutter. Surge Scout was moved into the kebab
              menu under a "Deeper Research" section (see below). */}

          {/* ─── THE SURGE SCOUT ───
              Quick external link to a specialized Gemini gem tuned for
              spotting pre-surge momentum. Opens in a new tab. */}
          {/* Surge Scout has been moved into the kebab dropdown
              (Deeper Research section). Nothing renders here anymore. */}

          {/* ─── VIEW TOGGLE (Cards / Table) ───
              Global view switcher. Only shown on tabs that render the
              cards-grid (new, active, watchlist) — analytics, portfolio,
              leaderboard and users tabs each have their own bespoke UI
              that the toggle wouldn't apply to. Selection persists in
              the `sc_view_mode` cookie. */}
          {['new', 'active', 'watchlist'].includes(activeTab) && (
            <div className="view-toggle" role="group" aria-label="View mode">
              <button
                type="button"
                className={`view-toggle-btn${viewMode === 'cards' ? ' active' : ''}`}
                onClick={() => handleSetViewMode('cards')}
                aria-pressed={viewMode === 'cards'}
                title="Card view — beautiful, mobile-friendly"
              >
                <span className="view-toggle-ic" aria-hidden="true">{"\u{25A6}"}</span>
                <span className="view-toggle-label">Cards</span>
              </button>
              <button
                type="button"
                className={`view-toggle-btn${viewMode === 'table' ? ' active' : ''}`}
                onClick={() => handleSetViewMode('table')}
                aria-pressed={viewMode === 'table'}
                title="Table view — dense, sortable"
              >
                <span className="view-toggle-ic" aria-hidden="true">{"\u{2630}"}</span>
                <span className="view-toggle-label">Table</span>
              </button>
            </div>
          )}

          {/* ─── MORE MENU (kebab) ───
              Single entry point for less-frequent destinations. As of
              2026-05-12 (v3) the Quick Scan, Dropped, Archive and Alert
              List entries have been removed: Quick Scan is now a global
              Card↔Table view toggle (header), and the Alert List moved
              into AI Settings. The menu keeps Analytics, Deeper Research,
              Filters & Sectors, AI Settings, and Manage Users. */}
          <div className="kebab-menu-wrap">
            <button
              className={`header-tool-btn kebab-trigger ${kebabOpen ? 'active' : ''}`}
              onClick={() => setKebabOpen(v => !v)}
              title="More"
              aria-label="More"
              aria-haspopup="menu"
              aria-expanded={kebabOpen}
            >
              {"\u{22EF}"}
            </button>
            {kebabOpen && (
              <div className="kebab-dropdown" role="menu" onClick={e => e.stopPropagation()}>
                <button
                  className={`kebab-item${activeTab === 'analytics' ? ' active' : ''}`}
                  onClick={() => { setActiveTab('analytics'); setRecFilter('ALL'); setKebabOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                >
                  <span className="kebab-ic">{"\u{1F4CA}"}</span>
                  <span className="kebab-label">Analytics</span>
                </button>
                {/* ─── DEEPER RESEARCH ───
                    External Gemini-powered research tools live here so the
                    header stays clean. Each link opens in a new tab so an
                    in-progress dashboard session is never disrupted. */}
                <div className="kebab-divider" />
                <div className="kebab-section-label">Deeper Research</div>
                <a
                  href="https://gemini.google.com/gem/1W9hF1pMpn8nE2mWzgix83jK6OC6PAkn9?usp=sharing"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="kebab-item"
                  onClick={() => setKebabOpen(false)}
                >
                  <span className="kebab-ic">{"\u{1F680}"}</span>
                  <span className="kebab-label">The Surge Scout</span>
                </a>
                <div className="kebab-divider" />
                {/* Filters & Sectors (2026-05-12) — combines the Market Cap
                    slider and the Sector Pulse bar (which used to live inline
                    under the tabs) into one tucked-away surface so the mobile
                    feed stays clean. Opens an in-page panel like AI Settings. */}
                <button
                  className={`kebab-item${showFiltersPanel ? ' active' : ''}`}
                  onClick={() => {
                    const next = !showFiltersPanel;
                    setShowFiltersPanel(next);
                    setKebabOpen(false);
                    if (next) setTimeout(() => document.getElementById('filters-sectors-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
                  }}
                >
                  <span className="kebab-ic">{"\u{1F39B}\u{FE0F}"}</span>
                  <span className="kebab-label">Filters &amp; Sectors</span>
                  {(mcapRange[0] > 0 || mcapRange[1] < 5000 || sectorFilter !== 'ALL') && (
                    <span className="kebab-badge">ON</span>
                  )}
                </button>
                <button
                  className={`kebab-item${showAISettings ? ' active' : ''}`}
                  onClick={() => {
                    const next = !showAISettings;
                    setShowAISettings(next);
                    setKebabOpen(false);
                    if (next) setTimeout(() => document.getElementById('ai-settings-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
                  }}
                >
                  <span className="kebab-ic">{"\u{2699}\u{FE0F}"}</span>
                  <span className="kebab-label">AI Settings</span>
                </button>
                {profile?.is_admin && (
                  <button
                    className={`kebab-item${activeTab === 'users' ? ' active' : ''}`}
                    onClick={() => { setActiveTab('users'); setRecFilter('ALL'); setKebabOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                  >
                    <span className="kebab-ic">{"\u{1F464}"}</span>
                    <span className="kebab-label">Manage Users</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Profile menu (avatar + name + sign out) */}
          {profile && (
            <div className="profile-menu-wrap">
              <button
                className="profile-menu-btn"
                onClick={() => { setProfileMenuOpen(v => !v); setNameInput(profile.display_name || ''); setEditingName(false); }}
                title="Account"
              >
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="profile-menu-avatar" referrerPolicy="no-referrer" />
                ) : (
                  <span className="profile-menu-avatar profile-menu-avatar-fallback">
                    {(profile.display_name || profile.email || '?').charAt(0).toUpperCase()}
                  </span>
                )}
                <span className="profile-menu-name">{profile.display_name || profile.email}</span>
                {profile.is_admin && <span className="profile-menu-admin-badge">ADMIN</span>}
              </button>

              {profileMenuOpen && (
                <div className="profile-menu-dropdown" onClick={e => e.stopPropagation()}>
                  <div className="profile-menu-header">
                    {profile.avatar_url && <img src={profile.avatar_url} alt="" className="profile-menu-avatar-lg" referrerPolicy="no-referrer" />}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="profile-menu-email">{profile.email}</div>
                      {editingName ? (
                        <div className="profile-menu-name-edit">
                          <input
                            type="text"
                            value={nameInput}
                            onChange={e => setNameInput(e.target.value)}
                            maxLength={40}
                            placeholder="Display name"
                            autoFocus
                          />
                          <button onClick={handleSaveDisplayName}>Save</button>
                          <button onClick={() => setEditingName(false)}>Cancel</button>
                        </div>
                      ) : (
                        <div className="profile-menu-name-row">
                          <span>{profile.display_name || 'No name set'}</span>
                          <button className="profile-menu-edit-btn" onClick={() => setEditingName(true)}>Edit</button>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Manage subscription — deep-links to LS-hosted customer
                      portal where the user can update card or cancel
                      auto-renew. Only render when LS has supplied the URL
                      (it does on every subscription_* event). Opens in a
                      new tab so they don't lose their dashboard state. */}
                  {subscription?.customer_portal_url && (
                    <a
                      className="profile-menu-manage-sub"
                      href={subscription.customer_portal_url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <span>Manage subscription</span>
                      <span className="profile-menu-manage-sub-meta">
                        {subscription.status === 'cancelled'
                          ? `Ends ${new Date(subscription.ends_at).toLocaleDateString()}`
                          : subscription.status === 'active' && subscription.renews_at
                            ? `Renews ${new Date(subscription.renews_at).toLocaleDateString()}`
                            : subscription.status}
                      </span>
                    </a>
                  )}
                  <button className="profile-menu-signout" onClick={handleSignOut}>Sign out</button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* ─── HERO SEARCH BAR ─── (redesigned 2026-05-12)
          The search bar is now the single hero affordance for finding +
          adding stocks — replacing the old FAB. Taller, bolder, focus
          glow, and a clean "Add a new ticker too" hint baked into the
          placeholder. Market Cap filter moved down to the filter chip
          row; Collapse all retired.

          Hidden on the Analytics tab (2026-05-12): adding stocks is
          out-of-context when the user is reviewing source performance,
          and the bar was just visual noise above the leaderboard. */}
      {activeTab !== 'analytics' && (
      <div className="hero-search-container">
        <div className="hero-search-bar">
          <span className="hero-search-icon">{"\u{1F50D}"}</span>
          <input
            type="text"
            className="hero-search-input"
            placeholder="Search or add any stock — ticker or company"
            title="Search your watchlist and the wider Stock Chatter universe. Type a ticker the AI hasn't flagged yet and choose Track to add it."
            aria-label="Search your watchlist and the wider Stock Chatter universe"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => {
              // Delay close so a tap on a result row registers before the
              // dropdown unmounts. 200ms is enough for fast taps without
              // feeling laggy on slower devices.
              setTimeout(() => setSearchFocused(false), 200);
            }}
          />
          {searchQuery && (
            <button className="hero-search-clear" onClick={() => { setSearchQuery(''); setSearchFocused(false); }} aria-label="Clear search">{"\u{2715}"}</button>
          )}
        </div>

        {/* UNIFIED-SEARCH DROPDOWN (2026-05-12) — grouped results that
            replace the old "dead-end" + button search. Renders only when
            the input is focused AND the user has typed something. Tap a
            row to open the stock-detail modal; tap "Add new" to jump into
            the AddStockSheet for that ticker. */}
        {searchFocused && searchResults && (
          <div className="search-results-dropdown" role="listbox" aria-label="Search results">
            {searchResults.onWatchlist.length === 0 &&
             searchResults.allStocks.length === 0 &&
             !searchResults.addNew && (
              <div className="search-results-empty">
                No matches for &ldquo;{searchQuery}&rdquo;. Try a ticker like NVDA or AAPL.
              </div>
            )}

            {searchResults.onWatchlist.length > 0 && (
              <>
                <div className="search-results-group-label">
                  ON YOUR WATCHLIST · {searchResults.onWatchlistTotal}
                </div>
                {searchResults.onWatchlist.map((a) => (
                  <SearchResultRow
                    key={`wl-${a.id}`}
                    alert={a}
                    sharedPrices={prices}
                    tracked={true}
                    onTap={() => handleSearchResultTap(a.ticker)}
                  />
                ))}
              </>
            )}

            {searchResults.allStocks.length > 0 && (
              <>
                <div className="search-results-group-label">
                  ALL STOCKS · {searchResults.allStocksTotal}
                </div>
                {searchResults.allStocks.map((a) => (
                  <SearchResultRow
                    key={`all-${a.id}`}
                    alert={a}
                    sharedPrices={prices}
                    tracked={false}
                    onTap={() => handleSearchResultTap(a.ticker)}
                  />
                ))}
              </>
            )}

            {searchResults.addNew && (
              <button
                type="button"
                className="search-results-addnew"
                onClick={() => handleSearchAddNew(searchResults.addNew)}
              >
                <span className="search-results-addnew-plus" aria-hidden="true">+</span>
                <span className="search-results-addnew-text">
                  Add <strong>{searchResults.addNew}</strong> to Portfolio &mdash; watch or log a position
                </span>
              </button>
            )}
          </div>
        )}
        {/* Market Cap + Collapse all (2026-05-12): both moved out of the
            hero search bar. Market Cap is now reachable from the filter
            chip on the rec-chip row below the tabs. Collapse all retired
            entirely. The blocks below render `null` because their wrappers
            were turned off, but kept here as no-op guards while we settle
            on the new layout. */}
        {false && (
          <button
            className="collapse-all-btn collapse-all-inline"
            onClick={() => {
              setAllCompact(prev => {
                const next = !prev;
                // Persist as saved user preference so the choice sticks
                // across devices. Fire-and-forget; silently no-ops if
                // the column isn't present yet (e.g. before migration).
                fetch('/api/profile', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ card_expand_default: next ? 'compact' : 'expanded' }),
                }).catch(() => {});
                return next;
              });
              setCompactNonce(n => n + 1);
            }}
            title={allCompact ? 'Expand every card (saved to your profile)' : 'Collapse every card (saved to your profile)'}
          >
            {allCompact
              ? <>{"\u25BE"} Expand all</>
              : <>{"\u25B4"} Collapse all</>}
          </button>
        )}
      </div>
      )}

      {/* Search-bar helper retired 2026-05-12. The hero search bar's
          placeholder + the "Track ticker" affordance inside the dropdown
          make the wording self-evident; the extra paragraph just added
          noise above the tabs. AI Settings remains reachable from the
          kebab menu in the header. */}
      {false && (
      <p
        className="search-bar-hint"
        style={{
          margin: '4px 16px 8px',
          fontSize: 12,
          color: '#7a9bc0',
          lineHeight: 1.4,
          textAlign: 'left',
        }}
      >
        {"ℹ️"} Tap any result to view the stock. To pull in a brand-new ticker the AI hasn&rsquo;t flagged yet, type its symbol and choose <strong style={{ color: '#9fc3e6' }}>Track</strong> — or adjust your <strong style={{ color: '#9fc3e6' }}>AI engine settings</strong>.
      </p>
      )}

      {/* Sticky tabs wrapper — tabs stay pinned to top as user scrolls.
          Hidden on Analytics (2026-05-12): the workflow tabs (New /
          Active / Portfolio / Leaderboard) aren't context-relevant to
          analytics review. Users return via the ⋯ More menu (desktop)
          or the mobile bottom nav. */}
      <div id="tabs-anchor" />
      {activeTab !== 'analytics' && (
      <div className="tabs-sticky-wrap">
        <div className="tabs-container">
          <div className="tabs-row">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`tab-btn ${activeTab === tab.id ? 'active' : ''} ${(tab.id === 'new' && newPicks.length > 0) || (tab.id === 'chatter' && chatterPicks.length > 0) ? 'tab-glow' : ''}`}
                onClick={() => { setActiveTab(tab.id); setRecFilter('ALL'); }}
              >
                {tab.label}
                {tab.count !== null && <span className="tab-count">{tab.count}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* Robinhood-style quick filter: one-tap filter by recommendation.
          Hidden on tabs that don't show pick cards (portfolio, leaderboard,
          analytics). Counts update live per tab so users see what's available
          before tapping.

          2026-05-12 (v2) — the Market Cap slider USED to sit alongside these
          chips. On mobile that row got too dense, and the slider is a niche
          control most users never touch. It now lives in the new "Filters &
          Sectors" panel reachable from the ⋯ kebab menu (along with Sector
          Pulse), keeping this row tight and one-tap. */}
      {showRecFilter && (
        <div className="card-filter-row">
          <RecommendationFilter
            value={recFilter}
            onChange={setRecFilter}
            counts={recCounts}
          />
        </div>
      )}

      {/* SECTOR PULSE BAR (rolled out 2026-05-09; moved 2026-05-12 v2)
          Previously rendered as an inline collapsible accordion below the
          rec-chip row. It loaded its data on first expand, so tapping the
          chip felt laggy ("a few seconds to load"). It now lives behind
          the "Filters & Sectors" entry in the ⋯ kebab menu — the dashboard
          preloads /api/sector-pulse on mount so the panel renders instantly
          when the user opens it. */}

      {/* Active filter banner: shows when either Market Cap or Sector is set,
          so the user knows the feed is filtered even though the controls are
          hidden in the kebab menu. Tapping the banner re-opens the panel. */}
      {showRecFilter && (mcapRange[0] > 0 || mcapRange[1] < 5000 || sectorFilter !== 'ALL') && (
        <button
          type="button"
          className="active-filters-banner"
          onClick={() => {
            setShowFiltersPanel(true);
            setTimeout(() => document.getElementById('filters-sectors-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
          }}
        >
          <span className="active-filters-banner-ic">{"\u{1F39B}\u{FE0F}"}</span>
          <span className="active-filters-banner-label">Filters active:</span>
          {(mcapRange[0] > 0 || mcapRange[1] < 5000) && (
            <span className="active-filters-banner-chip">
              Market Cap {mcapRange[0] >= 1000 ? `$${(mcapRange[0]/1000).toFixed(1)}T` : `$${mcapRange[0]}B`}
              {"–"}
              {mcapRange[1] >= 1000 ? `$${(mcapRange[1]/1000).toFixed(1)}T` : `$${mcapRange[1]}B`}
            </span>
          )}
          {sectorFilter !== 'ALL' && (
            <span className="active-filters-banner-chip">{sectorFilter}</span>
          )}
          <span className="active-filters-banner-edit">Edit {"›"}</span>
        </button>
      )}

      {/* SOURCE HEALTH BANNER - admin-only; silently no-ops for everyone else.
          Flags degraded/down scan sources (Reddit, Yahoo, etc.) so we know
          when the daily scan is running blind. */}
      <SourceHealthBanner />

      {/* ACTIVE AI FILTER BANNER - shows when a non-default AI filter is applied */}
      <ActiveAIFilterBanner
        settings={aiSettings}
        onClear={handleSaveAISetting}
        onOpenSettings={() => setShowAISettings(true)}
      />

      {/* Overview stats bar + Top Movers were removed 2026-05-12 — the
          Analytics tab now leads straight into the Peak Gain leaderboard
          and Source Performance. Overview shortcuts were redundant with
          tab navigation; Top Movers duplicated the AI cards themselves. */}

      {/* Quick Scan section retired 2026-05-12 v3 — the QuickTable is now
          rendered inline via the Cards/Table view toggle in the header,
          replacing the cards-grid when viewMode === 'table'. */}

      {/* TAB CONTENT */}
      {activeTab === 'analytics' ? (
        <AnalyticsTab alerts={alerts} />
      ) : activeTab === 'portfolio' ? (
        <PortfolioTab
          trades={paperTrades}
          alerts={alerts}
          prices={prices}
          pricesAsOf={pricesAsOf}
          pricesRefreshing={pricesRefreshing}
          onRefreshPrices={() => { refreshPrices(true); refreshPaperTrades(); }}
          onSell={handleOpenSellModal}
          onDelete={handleDeleteTrade}
          onUpdateReview={handleUpdateReview}
          onOpenCard={(ticker) => setCardModalTicker(ticker)}
        />
      ) : activeTab === 'leaderboard' ? (
        <LeaderboardTab alerts={alerts} prices={prices} currentUserId={profile?.id} />
      ) : activeTab === 'users' && profile?.is_admin ? (
        <UsersAdminTab currentUserId={profile.id} />
      ) : (
        <>
          {/* Tab description */}
          <p className="section-hint" style={{ marginLeft: '40px', marginTop: '8px' }}>
            {activeTab === 'new' && 'Brand-new picks from the last 2 days of scans. Look here first each morning.'}
            {activeTab === 'chatter' && 'Active picks where the AI changed its call in the last 24h. Worth a fresh look.'}
            {activeTab === 'active' && 'Current picks being tracked. Use Sort to scan by signal, date or performance.'}
            {activeTab === 'riding' && 'Winners past their target with signals still firing — protected by a trailing stop, riding the momentum.'}
            {activeTab === 'dropped' && 'Previously tracked stocks where the signal has faded.'}
            {activeTab === 'watchlist' && 'Everything personal — your watchlist, open positions, and closed trades. Filter with the chips below.'}
          </p>

          {/* SORT-BY ROW (2026-05-14) — lets AJ re-order a big card list by
              signal strength, recency or performance. Only on card tabs in
              card view; the Table view has its own column-header sorting. */}
          {showRecFilter && viewMode === 'cards' && getTabData().length > 1 && (
            <div className="sort-by-row">
              <SortByDropdown value={sortMode} onChange={handleSetSortMode} />
            </div>
          )}

          {/* MY STOCKS FILTER CHIPS (Phase 7) ─────────────────────────────
              Lifecycle filter for the unified My Stocks view. Replaces the
              old split between Watchlist and Portfolio tabs by collapsing
              both into one tab with chips: All · Watching · Holding · Sold. */}
          {activeTab === 'watchlist' && (() => {
            const upper = (t) => String(t || '').toUpperCase();
            const tradeMap = {};
            (paperTrades || []).forEach((t) => { (tradeMap[upper(t.ticker)] ||= []).push(t); });
            const wlSet = new Set((watchlist || []).map(upper));
            const wlActive = alerts.filter((a) => (wlSet.has(upper(a.ticker)) || tradeMap[upper(a.ticker)]) && notDismissed(a));
            const counts = { all: 0, watching: 0, holding: 0, sold: 0 };
            for (const a of wlActive) {
              const tr = tradeMap[upper(a.ticker)] || [];
              const hasOpen = tr.some((t) => t.status === 'open');
              const hasClosed = tr.some((t) => t.status === 'closed');
              counts.all++;
              if (hasOpen) counts.holding++;
              else if (hasClosed) counts.sold++;
              else counts.watching++;
            }
            // 2026-05-12 v3 — The "Holding" chip is the only one in this row
            // that maps to real money on the line, so we give it a distinct
            // visual treatment (💰 prefix, "Holdings" plural, green accent)
            // so users immediately see where their actual positions live.
            // The other chips stay neutral so Holdings reads as the standout.
            const chips = [
              { id: 'all', label: 'All', count: counts.all },
              { id: 'watching', label: 'Watching', count: counts.watching },
              { id: 'holding', label: 'Holdings', count: counts.holding, accent: 'holdings', icon: '\u{1F4B0}' },
              { id: 'sold', label: 'Sold', count: counts.sold },
            ];
            return (
              <div className="mystocks-chips" role="tablist" aria-label="My stocks filter">
                {chips.map((c) => (
                  <button
                    key={c.id}
                    role="tab"
                    type="button"
                    aria-selected={myStocksFilter === c.id}
                    className={`mystocks-chip${c.accent ? ' mystocks-chip-' + c.accent : ''}${myStocksFilter === c.id ? ' selected' : ''}`}
                    onClick={() => setMyStocksFilter(c.id)}
                    title={c.id === 'holding' ? 'Stocks you actually own (open paper positions)' : undefined}
                  >
                    {c.icon && <span className="mystocks-chip-icon" aria-hidden="true">{c.icon}</span>}
                    {c.label}
                    <span className="mystocks-chip-count">{c.count}</span>
                  </button>
                ))}
              </div>
            );
          })()}

          {/* PORTFOLIO HEALTH (Holding chip only) ─────────────────────────
              Mobile-first stats block re-added 2026-05-12 after the old
              standalone PortfolioTab was retired. Shows the user what
              their open positions are doing right now: current value,
              cost basis, unrealized P/L, and an annualized rate so they
              can compare against benchmarks. Only renders when the
              Holding chip is active and there is at least one open
              position — keeps the rest of the Portfolio tab clean. */}
          {activeTab === 'watchlist' && myStocksFilter === 'holding' && (() => {
            const upper = (t) => String(t || '').toUpperCase();
            const openTrades = (paperTrades || []).filter((t) => t.status === 'open');
            if (openTrades.length === 0) return null;

            const getLatestPrice = (ticker) => {
              const tk = upper(ticker);
              const live = prices?.[tk]?.price;
              if (live != null && !Number.isNaN(live)) return live;
              const alert = alerts.find((a) => upper(a.ticker) === tk);
              if (alert) {
                const last = alert.prices?.[alert.prices.length - 1];
                const p = last?.price ?? parseFloat(alert.price_at_alert);
                if (p != null && !Number.isNaN(p)) return p;
              }
              return null;
            };

            // Sum invested + current value across open positions only.
            let invested = 0;
            let currentValue = 0;
            let winners = 0;
            let priced = 0;
            for (const t of openTrades) {
              const shares = parseFloat(t.shares);
              const entryAmount = parseFloat(t.entry_amount);
              const entryPrice = parseFloat(t.entry_price);
              invested += entryAmount;
              const latest = getLatestPrice(t.ticker);
              if (latest != null) {
                currentValue += latest * shares;
                priced++;
                if (latest > entryPrice) winners++;
              } else {
                // No live price — assume break-even so the bucket math
                // stays honest (we'll show "—" for ROI in that case).
                currentValue += entryAmount;
              }
            }
            const unrealizedPnl = currentValue - invested;
            const roiPct = invested > 0 ? (unrealizedPnl / invested) * 100 : 0;

            // Annualized return for the OPEN bucket: weighted-average
            // days held across positions becomes the denominator.
            // Skip when the holding window is too short to be meaningful
            // (<7 days) so we don't show silly 4-digit % numbers.
            const totalDaysWeighted = openTrades.reduce((acc, t) => {
              const days = Math.max(1, Math.floor(
                (Date.now() - new Date(t.entry_date).getTime()) / 86400000));
              return acc + days * parseFloat(t.entry_amount);
            }, 0);
            const avgDaysHeld = invested > 0 ? totalDaysWeighted / invested : 0;
            const annualizedPct = (() => {
              if (avgDaysHeld < 7 || invested <= 0) return null;
              const r = Math.max(-0.9999, roiPct / 100);
              return (Math.pow(1 + r, 365 / avgDaysHeld) - 1) * 100;
            })();

            // Earliest entry — gives the user a "since" date so the
            // annualized number has context (e.g. "over 3 weeks").
            const earliestEntryMs = Math.min(
              ...openTrades.map((t) => new Date(t.entry_date).getTime()));
            const daysSinceEarliest = Math.max(1, Math.floor(
              (Date.now() - earliestEntryMs) / 86400000));
            const formatSpan = (d) => {
              if (d < 14) return `${d} day${d === 1 ? '' : 's'}`;
              if (d < 60) return `${Math.round(d / 7)} weeks`;
              if (d < 365) return `${Math.round(d / 30)} months`;
              const years = (d / 365).toFixed(1);
              return `${years} year${years === '1.0' ? '' : 's'}`;
            };
            const fmt$ = (v) => (v >= 0 ? '+$' : '-$') + Math.abs(v).toFixed(2);

            return (
              <div className="holdings-health">
                {/* Hero — unrealized P/L is the headline number */}
                <div className="pt-hero-card holdings-health-hero">
                  <div className="pt-hero-label">{"\u{1F4BC}"} Portfolio Health · Open Positions</div>
                  <div className={`pt-hero-value ${unrealizedPnl >= 0 ? 'pct-pos' : 'pct-neg'}`}>
                    {fmt$(unrealizedPnl)}
                    <span className="pt-hero-pct"> ({unrealizedPnl >= 0 ? '+' : ''}{roiPct.toFixed(2)}%)</span>
                  </div>
                  <div className="pt-hero-annualized">
                    {annualizedPct != null ? (
                      <span
                        className={`pt-hero-annualized-chip ${annualizedPct >= 0 ? 'pct-pos' : 'pct-neg'}`}
                        title={`Annualized = (1 + ${roiPct.toFixed(2)}%)^(365/${Math.round(avgDaysHeld)}) − 1.\nWhat this pace would compound to over a full year (CAGR). Directional only — short windows are noisy.`}
                      >
                        {"\u{1F4C8}"} Annualized: {annualizedPct >= 0 ? '+' : ''}{Math.abs(annualizedPct) >= 1000 ? annualizedPct.toFixed(0) : annualizedPct.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="pt-hero-annualized-chip pt-hero-annualized-pending" title="Need at least 7 days of holding history before an annualized rate is meaningful.">
                        {"\u{23F1}"} Too early to annualize
                      </span>
                    )}
                    <span className="pt-hero-annualized-sub">
                      over {formatSpan(daysSinceEarliest)} held
                    </span>
                  </div>
                  <div className="pt-hero-meta">
                    {openTrades.length} open position{openTrades.length === 1 ? '' : 's'}
                    {priced > 0 && (
                      <> {"·"} {winners}/{priced} in the green</>
                    )}
                  </div>
                </div>

                {/* Quick stat tiles — invested vs. now worth */}
                <div className="holdings-health-tiles">
                  <div className="holdings-health-tile">
                    <div className="holdings-health-tile-label">Cost basis</div>
                    <div className="holdings-health-tile-value">${invested.toFixed(2)}</div>
                  </div>
                  <div className="holdings-health-tile">
                    <div className="holdings-health-tile-label">Now worth</div>
                    <div className="holdings-health-tile-value">${currentValue.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* Cards grid OR Table view (2026-05-12 v3) — global view toggle
              lives in the header and persists in the `sc_view_mode` cookie.
              Table mode reuses the QuickTable component (previously hidden
              in the kebab menu). Clicking a ticker in the table switches
              back to card view and scrolls to that card. */}
          {viewMode === 'table' ? (
            <div className="dashboard-table-wrap">
              <QuickTable
                alerts={getTabData()}
                watchlist={watchlist}
                onToggleWatchlist={handleToggleWatchlist}
                onJumpToCard={(alert) => { handleSetViewMode('cards'); handleJumpToCard(alert); }}
              />
              {getTabData().length === 0 && (
                <p style={{ color: '#4a6a85', padding: '20px 0', fontSize: '0.9rem', textAlign: 'center' }}>
                  {searchQuery ? `No results for "${searchQuery}" in this tab.` : 'No picks match current filters.'}
                </p>
              )}
            </div>
          ) : (
          <div className={`cards-grid${allCompact && compactNonce > 0 ? ' grid-all-compact' : ''}`}>
            {getTabData().length > 0 ? getTabData().map((alert, idx) => {
              const card = (
                <AlertCard
                  key={alert.id || idx}
                  alert={alert}
                  index={idx}
                  sectionPrefix={activeTab}
                  watchlist={watchlist}
                  sharedPrices={prices}
                  forceCompact={allCompact}
                  forceCompactNonce={compactNonce}
                  onToggleWatchlist={handleToggleWatchlist}
                  onRate={handleRate}
                  onDismiss={handleDismiss}
                  onSaveNote={handleSaveNote}
                  userNote={userNotes[alert.ticker]}
                  openPosition={openTradeFor(alert.ticker)}
                  onOpenBuyModal={handleOpenBuyModal}
                  onOpenSellModal={handleOpenSellModal}
                  tickerMeta={tickerMetaMap[String(alert.ticker).toUpperCase()] || null}
                  onOpenAddSheet={openAddSheet}
                  serverWatchlist={serverWatchlist}
                />
              );
              // On the Portfolio tab, if the card is in the user's
              // watchlist, wrap it in SwipeToRemove so they can swipe-left
              // to reveal a red Remove button (Robinhood/Apple-Mail style).
              // Other tabs render the card untouched — swipe should only
              // mean "remove from my list" on lists the user owns.
              const tk = String(alert.ticker || '').toUpperCase();
              const isOnWatchlist = (serverWatchlist || []).some((w) => String(w.ticker || '').toUpperCase() === tk);
              if (activeTab === 'watchlist' && isOnWatchlist) {
                return (
                  <SwipeToRemove
                    key={alert.id || idx}
                    ticker={tk}
                    onRemove={async () => {
                      await fetch(`/api/watchlist?ticker=${encodeURIComponent(tk)}`, {
                        method: 'DELETE',
                        credentials: 'include',
                      });
                      refreshServerWatchlist();
                    }}
                  >
                    {card}
                  </SwipeToRemove>
                );
              }
              return card;
            }) : (
              <p style={{ color: '#4a6a85', padding: '20px 0', fontSize: '0.9rem' }}>
                {searchQuery ? `No results for "${searchQuery}" in this tab.` : 'No picks match current filters.'}
              </p>
            )}

            {/* MONITOR-MODE CARDS (Phase 8) ─────────────────────────────
                Render simpler cards for tickers in the user's server watchlist
                that AREN'T currently in today's AI feed. Lets users keep
                track of stocks the AI isn't actively flagging — the scan
                will pick them up if/when chatter emerges. Only shown in the
                My Stocks tab, and respect the same filter chip selection. */}
            {activeTab === 'watchlist' && (() => {
              const alertTickers = new Set(getTabData().map((a) => String(a.ticker).toUpperCase()));
              const upper = (t) => String(t || '').toUpperCase();
              const monitorRows = (serverWatchlist || []).filter((w) => {
                const tk = upper(w.ticker);
                if (alertTickers.has(tk)) return false; // already in main grid
                const openTrade = (paperTrades || []).find((t) => upper(t.ticker) === tk && t.status === 'open');
                const closedTrade = (paperTrades || []).find((t) => upper(t.ticker) === tk && t.status === 'closed');
                // respect the filter chip
                if (myStocksFilter === 'holding') return !!openTrade;
                if (myStocksFilter === 'sold') return !openTrade && !!closedTrade;
                if (myStocksFilter === 'watching') return !openTrade;
                return true;
              });
              if (monitorRows.length === 0) return null;
              return (
                <>
                  {monitorRows.map((w) => {
                    const tk = upper(w.ticker);
                    const openTrade = (paperTrades || []).find((t) => upper(t.ticker) === tk && t.status === 'open');
                    const price = w.current_price;
                    const pct = w.today_pct;
                    const hasPosition = !!openTrade;
                    const monitorCard = (
                      <div className="monitor-card">
                        <div className="monitor-head">
                          <div className="monitor-logo">{tk.slice(0, 2)}</div>
                          <div className="monitor-meta">
                            <div className="monitor-ticker-row">
                              <span className="monitor-ticker">{tk}</span>
                              <span className={`monitor-status ${hasPosition ? 'holding' : 'watching'}`}>
                                {hasPosition ? 'HOLDING' : 'WATCHING'}
                              </span>
                            </div>
                            <div className="monitor-company">{w.company || w.current_alert?.company || 'Stock'}</div>
                          </div>
                          <div className="monitor-price-block">
                            {price != null && <div className="monitor-price">${Number(price).toFixed(2)}</div>}
                            {pct != null && (
                              <div className={`monitor-pct ${pct >= 0 ? 'up' : 'down'}`}>
                                {pct >= 0 ? '+' : ''}{Number(pct).toFixed(2)}%
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="monitor-banner">
                          <span className="monitor-banner-icon"><Ico name="activity" size={16} /></span>
                          <span>
                            <strong>No active AI signal</strong> — we're monitoring {tk} and will flag it here if chatter emerges across our sources.
                          </span>
                        </div>

                        {hasPosition && (() => {
                          const invested = parseFloat(openTrade.entry_amount);
                          const shares = parseFloat(openTrade.shares);
                          const cur = price ?? parseFloat(openTrade.entry_price);
                          const cv = cur * shares;
                          const pnl = cv - invested;
                          const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
                          return (
                            <div className={`monitor-position ${pnl >= 0 ? 'up' : 'down'}`}>
                              <span><Ico name="briefcase" size={13} /> {shares.toFixed(2)} sh @ ${parseFloat(openTrade.entry_price).toFixed(2)} · now ${cv.toFixed(2)}</span>
                              <span className="monitor-position-pnl">
                                {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} ({pnl >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%)
                              </span>
                            </div>
                          );
                        })()}

                        <div className="monitor-actions">
                          <button
                            type="button"
                            className="monitor-btn-primary"
                            onClick={() => openAddSheet({ ticker: tk, company: w.company, alert: null })}
                          >
                            {hasPosition ? 'Manage' : 'Log a Position'}
                          </button>
                          <button
                            type="button"
                            className="monitor-btn-secondary"
                            onClick={async () => {
                              if (!confirm(`Remove ${tk} from your watchlist?`)) return;
                              await fetch(`/api/watchlist?ticker=${encodeURIComponent(tk)}`, { method: 'DELETE', credentials: 'include' });
                              refreshServerWatchlist();
                            }}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                    return (
                      <SwipeToRemove
                        key={`monitor-${tk}`}
                        ticker={tk}
                        onRemove={async () => {
                          await fetch(`/api/watchlist?ticker=${encodeURIComponent(tk)}`, {
                            method: 'DELETE',
                            credentials: 'include',
                          });
                          refreshServerWatchlist();
                        }}
                      >
                        {monitorCard}
                      </SwipeToRemove>
                    );
                  })}
                </>
              );
            })()}
          </div>
          )}
        </>
      )}

      {/* PAPER TRADE MODALS */}
      {buyModalState && (
        <BuyTradeModal
          alert={buyModalState.alert}
          currentPrice={buyModalState.currentPrice}
          onClose={() => setBuyModalState(null)}
          onConfirm={handleConfirmBuy}
        />
      )}
      {sellModalState && (
        <SellTradeModal
          trade={sellModalState.trade}
          currentPrice={sellModalState.currentPrice}
          onClose={() => setSellModalState(null)}
          onConfirm={handleConfirmSell}
        />
      )}

      {/* STOCK CARD MODAL — opened from Portfolio tab so users can pop open
          the live AI card for a position without leaving Portfolio. */}
      {cardModalTicker && (
        <StockCardModal
          ticker={cardModalTicker}
          alerts={alerts}
          prices={prices}
          watchlist={watchlist}
          userNote={userNotes[cardModalTicker]}
          openPosition={openTradeFor(cardModalTicker)}
          onClose={() => setCardModalTicker(null)}
          onToggleWatchlist={handleToggleWatchlist}
          onRate={handleRate}
          onDismiss={handleDismiss}
          onSaveNote={handleSaveNote}
          onOpenBuyModal={handleOpenBuyModal}
          onOpenSellModal={handleOpenSellModal}
          tickerMeta={tickerMetaMap[String(cardModalTicker).toUpperCase()] || null}
          onOpenAddSheet={openAddSheet}
          serverWatchlist={serverWatchlist}
        />
      )}

      {/* FULL ARCHIVE TABLE */}
      <div className="archive-section" id="archive-section">
        {showArchive && (
          <>
            <p className="section-title" style={{ marginLeft: 0 }}><Ico name="file" size={15} /> Full Archive {"\u{2014}"} All Historical Picks ({alerts.length} total) <button className="section-close-btn" onClick={() => setShowArchive(false)}><Ico name="x" size={13} /> Close</button></p>
            {alerts.some(a => a.dismissed_at) && (
              <div className="dismissed-banner">
                <Ico name="trash" size={14} /> {alerts.filter(a => a.dismissed_at).length} dismissed pick{alerts.filter(a => a.dismissed_at).length === 1 ? '' : 's'} hidden from the main views — look for the <span className="dismissed-banner-tag">DISMISSED</span> tag below and click <b><Ico name="undo" size={12} /> Bring back</b> to restore any of them.
              </div>
            )}
          </>
        )}
        {showArchive && (
          <div className="archive-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{"\u{2B50}"}</th>
                  <th>Rating</th>
                  <th>Pick Status</th>
                  <th>Date Alerted</th>
                  <th>Ticker</th>
                  <th>Company</th>
                  <th>Source</th>
                  <th>Signal Type</th>
                  <th>Price at Alert</th>
                  <th>Latest Price</th>
                  <th>% Change</th>
                  <th>AI Rec</th>
                  <th>Signal Changed</th>
                  <th>Forecast Sell</th>
                  <th>Performance</th>
                </tr>
              </thead>
              <tbody>
                {[...alerts]
                  .sort((a, b) => {
                    const order = { new: 0, active: 1, dropped: 2 };
                    const oa = order[a.status] ?? 1;
                    const ob = order[b.status] ?? 1;
                    if (oa !== ob) return oa - ob;
                    return b.alert_date.localeCompare(a.alert_date);
                  })
                  .map((alert, idx) => {
                    const latest = alert.prices[alert.prices.length - 1];
                    const pct = latest?.pct_change || 0;
                    const perfStatus = getStatus(pct);
                    const pickStatus = alert.status || 'active';
                    const pickLabel = pickStatus === 'new'
                ? <><Ico name="belldot" size={11} /> NEW</>
                : pickStatus === 'dropped'
                ? <><Ico name="trash" size={11} /> DROPPED</>
                : <><Ico name="activity" size={11} /> ACTIVE</>;
                    const isWatched = watchlist.includes(alert.ticker);
                    const srcMeta = getSourceMeta(alert.source);
                    const signalChange = alert.latest_signal_change;
                    const isDismissed = !!alert.dismissed_at;
                    return (
                      <tr key={alert.id || idx} className={`${pickStatus === 'dropped' ? 'row-dropped' : ''}${isDismissed ? ' row-dismissed' : ''}`}>
                        <td>
                          <div className="tbl-first-cell">
                            <button
                              className={`watchlist-btn-sm ${isWatched ? 'watched' : ''}`}
                              onClick={() => handleToggleWatchlist(alert.ticker)}
                            >
                              {isWatched ? '\u{2605}' : '\u{2606}'}
                            </button>
                            {isDismissed && (
                              <button
                                className="tbl-restore-btn"
                                title="Bring this pick back to the Active view"
                                onClick={() => handleUnDismiss(alert.id)}
                              >
                                ↺ Bring back
                              </button>
                            )}
                          </div>
                        </td>
                        <td>
                          <span className="tbl-rating">
                            {alert.user_rating === 'up' ? '\u{1F44D}' : alert.user_rating === 'down' ? '\u{1F44E}' : '\u{2014}'}
                          </span>
                        </td>
                        <td>
                          <span className={`pick-status-chip pick-${pickStatus}`}>{pickLabel}</span>
                          {isDismissed && <span className="pick-status-chip pick-dismissed" style={{ marginLeft: 6 }}><Ico name="trash" size={11} /> DISMISSED</span>}
                        </td>
                        <td className="tbl-alert-date">{alert.alert_date}</td>
                        <td className="tbl-ticker">{alert.ticker}</td>
                        <td style={{ color: '#a0b8d0' }}>{alert.company}</td>
                        <td><span className={`source-badge-sm ${srcMeta.cls}`}><Ico name={srcMeta.icon} /> {srcMeta.label}</span></td>
                        <td><span className="signal-chip">{alert.signal_type}</span></td>
                        <td className="tbl-alert-price">${parseFloat(alert.price_at_alert).toFixed(2)}</td>
                        <td>${latest?.price?.toFixed(2) || '\u{2014}'}</td>
                        <td className={`tbl-${perfStatus}`}>{fmtPct(pct)}</td>
                        <td><span className={`rec-chip ${recClass(alert.recommendation || 'HOLD')}`}>{recLabel(alert.recommendation || 'HOLD')}</span></td>
                        <td>
                          {signalChange ? (
                            <span className="tbl-signal-change">
                              {signalChange.old_recommendation} {"\u{2192}"} {signalChange.new_recommendation}
                              <br />
                              <span className="tbl-sc-date">
                                {new Date(signalChange.change_date || signalChange.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              </span>
                            </span>
                          ) : '\u{2014}'}
                        </td>
                        <td>
                          {alert.forecast_sell_date ? (
                            <span className="tbl-forecast">
                              {new Date(alert.forecast_sell_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </span>
                          ) : '\u{2014}'}
                        </td>
                        <td className={`tbl-${perfStatus}`}>{statusLabel(pct)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* FILTERS & SECTORS PANEL (2026-05-12 v2)
          Home for the Market Cap slider + Sector Pulse bar. Used to live
          inline below the rec-chip row; moved here to free up mobile
          real estate and avoid the laggy "expand and wait for sector
          pulse to fetch" pattern. Sector pulse data is preloaded on
          dashboard mount so this section renders instantly. */}
      <div className="archive-section" id="filters-sectors-section">
        {showFiltersPanel && (
          <>
            <p className="section-title" style={{ marginLeft: 0 }}>
              {"\u{1F39B}\u{FE0F}"} Filters &amp; Sectors
              <button className="section-close-btn" onClick={() => setShowFiltersPanel(false)}>{"\u{2715}"} Close</button>
            </p>

            <div className="filters-panel">
              {/* Market Cap */}
              <div className="filters-panel-block">
                <div className="filters-panel-block-head">
                  <span className="filters-panel-block-title">{"\u{1F3E2}"} Market Cap</span>
                  <span className="filters-panel-block-sub">Filter visible picks by company size.</span>
                </div>
                <div className="filters-panel-mcap">
                  <MarketCapSlider range={mcapRange} onChange={setMcapRange} />
                </div>
              </div>

              {/* Sector Pulse */}
              {activeTab !== 'watchlist' && (
                <div className="filters-panel-block">
                  <div className="filters-panel-block-head">
                    <span className="filters-panel-block-title">{"\u{1F4CA}"} Sector Pulse</span>
                    <span className="filters-panel-block-sub">Today&rsquo;s AI read across sectors. Tap a chip to filter the feed.</span>
                  </div>
                  <SectorPulseBar
                    enabled={!!profile}
                    selected={sectorFilter}
                    onSelect={setSectorFilter}
                    tickerMeta={tickerMetaMap}
                    preloadedSectors={preloadedSectorPulse}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* AI ENGINE SETTINGS — also hosts the Alert Recipients section
          (formerly its own "Alert List" kebab entry, merged here 2026-05-12 v3
          so admin-y configuration lives in one place). */}
      <div className="archive-section" id="ai-settings-section">
        {showAISettings && (
          <>
            <p className="section-title" style={{ marginLeft: 0 }}>{"\u{2699}\u{FE0F}"} AI Engine Settings <button className="section-close-btn" onClick={() => setShowAISettings(false)}>{"\u{2715}"} Close</button></p>
            <AISettingsPanel settings={aiSettings} onSave={handleSaveAISetting} />

            {/* Alert Recipients — moved out of the kebab menu and into
                the Settings panel on 2026-05-12. Same component, same data,
                just a cleaner home that matches how Robinhood / Public.com
                bury notification-list management inside Settings. */}
            <div className="ai-settings-subsection">
              <div className="ai-settings-subsection-head">
                <h3 className="ai-settings-subsection-title">{"\u{1F4E7}"} Alert Recipients</h3>
                <p className="ai-settings-subsection-sub">
                  When a stock changes from BUY to SELL (or vice versa),
                  everyone on this list gets notified by email.
                </p>
              </div>
              <DistributionListManager />
            </div>
          </>
        )}
      </div>

      <footer>
        {"\u{26A1}"} Auto-updated daily at 9am &nbsp;|&nbsp; Powered by <span>Stock Chatter</span> &nbsp;|&nbsp; Sources: <span>SEC 8-K {"\u{B7}"} Insider Buys {"\u{B7}"} FDA Catalysts {"\u{B7}"} Yahoo Pre-Market {"\u{B7}"} ApeWisdom {"\u{B7}"} r/biotechplays {"\u{B7}"} r/Shortsqueeze {"\u{B7}"} r/Vitards {"\u{B7}"} NASDAQ Halts {"\u{B7}"} WSB {"\u{B7}"} Yahoo Trending {"\u{B7}"} Polymarket {"\u{B7}"} Kalshi {"\u{B7}"} Stooq</span>
        <div className="disclaimer">{"\u{26A0}"}{"\u{FE0F}"} AI recommendations are based on momentum, timing &amp; price action analysis. This is NOT financial advice. Always do your own research before investing.</div>
        <div className="dashboard-legal-links">
          <a href="/privacy">Privacy Policy</a>
          <span aria-hidden="true"> &middot; </span>
          <a href="/terms">Terms of Service</a>
          <span aria-hidden="true"> &middot; </span>
          <a href="mailto:hello@getfamilyfinance.com">Contact</a>
        </div>
      </footer>

      {/* ─── MOBILE BOTTOM NAV BAR ───
          Fixed thumb-reachable nav for phones. Hidden on desktop via CSS.
          Mirrors the most commonly used tabs so users don't have to scroll back up.
          Order matches the top tab row (New → Chatter → Active → Portfolio).
          Leaderboard moved out of the bottom nav 2026-05-13 — it's a "check
          weekly" view, whereas Chatter is daily; Leaderboard stays accessible
          via the top tab row + the ⋯ kebab menu. */}
      <nav className="mobile-bottom-nav mobile-bottom-nav-5" aria-label="Primary">
        <button
          className={`mb-nav-btn${activeTab === 'new' ? ' active' : ''}`}
          onClick={() => { setActiveTab('new'); setRecFilter('ALL'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          aria-label="New picks"
        >
          <span className="mb-nav-icon"><Ico name="belldot" size={22} strokeWidth={1.75} /></span>
          <span className="mb-nav-label">New</span>
          {newPicks.length > 0 && <span className="mb-nav-badge">{newPicks.length}</span>}
        </button>
        <button
          className={`mb-nav-btn${activeTab === 'chatter' ? ' active' : ''}`}
          onClick={() => { setActiveTab('chatter'); setRecFilter('ALL'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          aria-label="Chatter"
        >
          <span className="mb-nav-icon"><Ico name="chat" size={22} strokeWidth={1.75} /></span>
          <span className="mb-nav-label">Chatter</span>
          {chatterPicks.length > 0 && <span className="mb-nav-badge">{chatterPicks.length}</span>}
        </button>
        <button
          className={`mb-nav-btn${activeTab === 'active' ? ' active' : ''}`}
          onClick={() => { setActiveTab('active'); setRecFilter('ALL'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          aria-label="Active picks"
        >
          <span className="mb-nav-icon"><Ico name="flame" size={22} strokeWidth={1.75} /></span>
          <span className="mb-nav-label">Active</span>
        </button>
        {/* Riding tab (2026-05-14) — winners past target with signals still
            firing. Trending-up icon. Only renders a badge when there's a
            riding pick; otherwise the slot stays quiet so the nav doesn't
            shout "5 things to look at" by default. */}
        <button
          className={`mb-nav-btn${activeTab === 'riding' ? ' active' : ''}`}
          onClick={() => { setActiveTab('riding'); setRecFilter('ALL'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          aria-label="Riding"
        >
          <span className="mb-nav-icon"><Ico name="trend" size={22} strokeWidth={1.75} /></span>
          <span className="mb-nav-label">Riding</span>
          {ridingPicks.length > 0 && <span className="mb-nav-badge">{ridingPicks.length}</span>}
        </button>
        <button
          className={`mb-nav-btn${activeTab === 'watchlist' ? ' active' : ''}`}
          onClick={() => { setActiveTab('watchlist'); setMyStocksFilter('watching'); setRecFilter('ALL'); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
          aria-label="Portfolio"
        >
          <span className="mb-nav-icon"><Ico name="briefcase" size={22} strokeWidth={1.75} /></span>
          <span className="mb-nav-label">Portfolio</span>
          {watchlistPicks.length > 0 && <span className="mb-nav-badge">{watchlistPicks.length}</span>}
        </button>
      </nav>

      {/* ─── ADD STOCK FAB removed 2026-05-12 ───
          The hero search bar at the top of the dashboard is now the
          single, primary way to add a stock — it filters existing
          watchlist + AI feed and offers "Track {ticker}" for unknown
          tickers. Killing the duplicate + button cleans up the bottom
          nav and matches Robinhood/Public/Webull conventions. */}

      {/* ─── ADD STOCK SHEET ───
          Single bottom-sheet that handles: searching for a stock, adding to
          watchlist, and logging a paper position. Pre-fills with AI data
          when opened from a card's "+ Track" button. */}
      <AddStockSheet
        isOpen={sheetOpen}
        onClose={closeAddSheet}
        prefillTicker={sheetPrefill?.ticker || null}
        prefillCompany={sheetPrefill?.company || null}
        prefillAlert={sheetPrefill?.alert || null}
        watchlist={serverWatchlist}
        activeAlerts={alerts}
        onAdded={() => { refreshServerWatchlist(); }}
        onPositionLogged={() => {
          refreshServerWatchlist();
          // Refresh paper trades too so the new position shows up
          fetch('/api/paper-trades', { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d?.trades) setPaperTrades(d.trades); })
            .catch(() => {});
        }}
      />
    </StockMetaProvider>
  );
}
