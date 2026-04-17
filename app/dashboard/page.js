'use client';
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import '../globals.css';
import { SIGNAL_WEIGHTS, SIGNAL_BUCKETS, bucketFor } from '../lib/signalStrength';

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
function recLabel(rec) {
  if (rec === 'BUY') return '\u{1F7E2} BUY';
  if (rec === 'SELL') return '\u{1F534} SELL';
  return '\u{1F7E1} HOLD';
}
function recClass(rec) {
  if (rec === 'BUY') return 'rec-buy';
  if (rec === 'SELL') return 'rec-sell';
  return 'rec-hold';
}

// ── Source helpers ──
const SOURCE_META = {
  wsb: { label: 'WallStreetBets', emoji: '\u{1F7E0}', cls: 'src-wsb' },
  reddit: { label: 'Reddit', emoji: '\u{1F534}', cls: 'src-reddit' },
  polymarket: { label: 'Polymarket', emoji: '\u{1F535}', cls: 'src-poly' },
  kalshi: { label: 'Kalshi', emoji: '\u{1F537}', cls: 'src-kalshi' },
  yahoo: { label: 'Yahoo Finance', emoji: '\u{1F7E3}', cls: 'src-yahoo' },
  google: { label: 'Google Finance', emoji: '\u{1F7E2}', cls: 'src-google' },
  stocktwits: { label: 'StockTwits', emoji: '\u{1F534}', cls: 'src-st' },
  unknown: { label: 'Unknown', emoji: '\u{26AA}', cls: 'src-unknown' },
};
function getSourceMeta(source) {
  if (!source) return SOURCE_META.unknown;
  const key = source.toLowerCase().replace(/\s+/g, '');
  if (key.includes('wsb') || key.includes('wallstreetbets')) return SOURCE_META.wsb;
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
function AnalystBadge({ ticker }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/analyst?ticker=${encodeURIComponent(ticker)}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

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
function EarningsDate({ ticker }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/earnings?ticker=${encodeURIComponent(ticker)}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(d => { if (!cancelled) { setData(d); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [ticker]);

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
function HistoricChart({ ticker, canvasId }) {
  const canvasRef = useRef(null);
  const [histData, setHistData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/history?ticker=${encodeURIComponent(ticker)}`)
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => { if (!cancelled) { setHistData(data); setLoading(false); } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [ticker]);

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
  return (
    <div className="rating-buttons">
      <button
        className={`rating-btn rating-up ${currentRating === 'up' ? 'active' : ''}`}
        onClick={() => onRate(alertId, currentRating === 'up' ? null : 'up')}
        title="Good pick"
      >
        {"\u{1F44D}"}
      </button>
      <button
        className={`rating-btn rating-down ${currentRating === 'down' ? 'active' : ''}`}
        onClick={() => onRate(alertId, currentRating === 'down' ? null : 'down')}
        title="Bad pick"
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
function AlertCard({
  alert, index, sectionPrefix, watchlist,
  onToggleWatchlist, onRate, onDismiss, onSaveNote,
  userNote, openPosition, onOpenBuyModal, onOpenSellModal
}) {
  const [compact, setCompact] = useState(false);
  const [noteEditing, setNoteEditing] = useState(false);
  const [noteDraft, setNoteDraft] = useState(userNote || '');

  useEffect(() => { setNoteDraft(userNote || ''); }, [userNote]);

  const latest = alert.prices[alert.prices.length - 1];
  const pct = latest?.pct_change || 0;
  const isNew = alert.status === 'new';
  const isDropped = alert.status === 'dropped';
  const isWatched = watchlist.includes(alert.ticker);
  const sourceMeta = getSourceMeta(alert.source);
  const rec = (alert.recommendation || 'HOLD').toUpperCase();

  // Status dot — win/neutral/loss based on since-alert %
  const dotClass = pct >= 5 ? 'win' : pct <= -5 ? 'loss' : 'neutral';

  // Rec chip variant + hero tone
  const recVariant = ['BUY', 'HOLD', 'SELL', 'TRIM', 'EXIT'].includes(rec)
    ? rec.toLowerCase() : 'hold';
  const heroTone = rec === 'SELL' ? 'loss'
    : (rec === 'TRIM' || rec === 'EXIT') ? 'neutral' : '';

  // Days since alert
  const alertDateObj = new Date(alert.alert_date + 'T00:00:00');
  const daysSinceAlert = Math.floor((Date.now() - alertDateObj.getTime()) / 86400000);
  const daysLabel = daysSinceAlert <= 0 ? 'today'
    : daysSinceAlert === 1 ? '1 day ago' : `${daysSinceAlert} days ago`;

  // ET time + market-hours indicator
  const etNow = new Date();
  const etParts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', weekday: 'short', hour12: true
  }).formatToParts(etNow);
  const etTime = etParts.filter(p => ['hour','minute','literal','dayPeriod'].includes(p.type))
    .map(p => p.value).join('');
  const etHour = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour: 'numeric', hour12: false
  }).format(etNow), 10);
  const etMin = parseInt(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', minute: 'numeric'
  }).format(etNow), 10);
  const etDay = etParts.find(p => p.type === 'weekday')?.value;
  const isWeekday = !['Sat', 'Sun'].includes(etDay);
  const afterOpen = etHour > 9 || (etHour === 9 && etMin >= 30);
  const marketOpen = isWeekday && afterOpen && etHour < 16;

  // 52-week position (0–100)
  const price = latest?.price;
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
    : rec === 'TRIM' || rec === 'EXIT' ? 'warn' : '';

  const handleDismiss = () => {
    if (!onDismiss) return;
    if (typeof window !== 'undefined' && window.confirm(`Dismiss ${alert.ticker}? It'll move to the archive.`)) {
      onDismiss(alert.id);
    }
  };
  const handleSaveNote = async () => {
    if (onSaveNote) await onSaveNote(alert.ticker, noteDraft);
    setNoteEditing(false);
  };
  const cancelNote = () => { setNoteDraft(userNote || ''); setNoteEditing(false); };

  const recDisplay = rec === 'EXIT' ? '\u{1F3C1} EXIT' : rec;

  return (
    <div
      id={`card-${alert.ticker}`}
      className={`ac ac-${recVariant}${compact ? ' ac-compact' : ''}${isNew ? ' ac-new' : ''}${isDropped ? ' ac-dropped' : ''}${isWatched ? ' ac-watched' : ''}`}
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
                <span className={`ac-live-pct ${pct >= 0 ? 'pos' : 'neg'}`}>
                  {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
                </span>
              </>
            )}
            {isNew && <span className="ac-new-pill">NEW</span>}
            {isDropped && <span className="ac-dropped-pill">DROPPED</span>}
          </div>
          <div className="ac-company-row">
            <span className="ac-company">{alert.company}</span>
            <span className="ac-dot-sep">·</span>
            <span className={`ac-mkt-dot ${marketOpen ? '' : 'closed'}`} title={marketOpen ? 'Market open' : 'Market closed'}></span>
            <span className="ac-et-time">{etTime} ET{marketOpen ? '' : ' · closed'}</span>
          </div>
        </div>
        <div className="ac-right">
          <div className="ac-right-top">
            <SignalBars
              score={alert.signal_strength}
              subScores={alert.signal_sub_scores}
              sourceCount={alert.signal_source_count}
              mentionCount={alert.signal_mention_count}
            />
            <button className="ac-dismiss" title="Dismiss / archive" onClick={handleDismiss} aria-label="Dismiss">×</button>
          </div>
          <div className="ac-actions">
            <RatingButtons alertId={alert.id} currentRating={alert.user_rating} onRate={onRate} />
            <button
              className={`ac-watch-btn ${isWatched ? 'watched' : ''}`}
              onClick={() => onToggleWatchlist(alert.ticker)}
              title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              {isWatched ? '\u{2605}' : '\u{2606}'}
            </button>
          </div>
        </div>
      </div>

      {/* HERO — AI recommendation + since-alert */}
      <div className={`ac-hero ac-hero-${heroTone || recVariant}`}>
        <span className={`ac-rec-chip ac-rec-${recVariant}`}>{recDisplay}</span>
        <span className={`ac-since ${pct >= 0 ? 'pos' : 'neg'}`}>
          {pct >= 0 ? '+' : ''}{pct.toFixed(1)}%
        </span>
        <span className="ac-since-lbl">since alert<br/>{daysLabel}</span>
      </div>

      {/* BADGES — source, market cap, volume spike */}
      <div className="ac-badges">
        <span className={`ac-b ac-b-source ${sourceMeta.cls}${wsbArrow}`}>
          {sourceMeta.emoji} {sourceMeta.label}
        </span>
        {mcLabel && <span className="ac-b ac-b-mcap">🏢 {mcLabel}</span>}
        {volSpike && (
          <span className="ac-b ac-b-vol">
            🔥 {parseFloat(alert.volume_ratio).toFixed(1)}× vol
          </span>
        )}
      </div>

      {/* TRADE PLAN — entry / take profit / stop loss */}
      {hasPlan && (
        <div className="ac-plan">
          {alert.entry_low != null && (
            <div className="ac-plan-item ac-plan-entry">
              <span className="ac-plan-lbl">Entry</span>
              <span className="ac-plan-val">
                ${parseFloat(alert.entry_low).toFixed(2)}–${parseFloat(alert.entry_high || alert.entry_low).toFixed(2)}
              </span>
            </div>
          )}
          {alert.target_low != null && (
            <div className={`ac-plan-item ac-plan-target${targetHit ? ' hit' : ''}`}>
              <span className="ac-plan-lbl">🎯 {targetHit ? 'Target hit ✓' : 'Take profit'}</span>
              <span className="ac-plan-val">
                ${parseFloat(alert.target_low).toFixed(2)}–${parseFloat(alert.target_high || alert.target_low).toFixed(2)}
              </span>
            </div>
          )}
          {alert.stop_loss != null && (
            <div className={`ac-plan-item ac-plan-stop${stopHit ? ' hit' : ''}`}>
              <span className="ac-plan-lbl">{stopHit ? 'Stop hit ✓' : 'Stop loss'}</span>
              <span className="ac-plan-val">${parseFloat(alert.stop_loss).toFixed(2)}</span>
            </div>
          )}
        </div>
      )}

      {/* AI READ — one-line call-explanation from the daily job */}
      {(alert.ai_read || alert.recommendation_reason) && (
        <div className={`ac-ai-read ${aiReadTone}`}>
          <span className="ac-ai-icon">🧠</span>
          <span><b>AI read:</b> {alert.ai_read || alert.recommendation_reason}</span>
        </div>
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

      {/* SIGNAL CHANGE */}
      {alert.latest_signal_change && (
        <div className="ac-sig-change">
          <span>📢 Signal changed:</span>
          <span className={`ac-mini-chip ${recClass(alert.latest_signal_change.old_recommendation)}`}>
            {alert.latest_signal_change.old_recommendation}
          </span>
          →
          <span className={`ac-mini-chip ${recClass(alert.latest_signal_change.new_recommendation)}`}>
            {alert.latest_signal_change.new_recommendation}
          </span>
          <span className="ac-sig-date">
            {new Date(alert.latest_signal_change.change_date || alert.latest_signal_change.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      )}

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
                    <span className="pth-label">💼 PAPER POSITION</span>
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
                  💰 Paper Sell
                </button>
              </>
            );
          })() : (
            <button
              className="paper-trade-btn paper-trade-buy"
              onClick={() => onOpenBuyModal(alert, price ?? parseFloat(alert.price_at_alert))}
            >
              📈 Paper Buy
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
        if (res.status === 401) { router.replace('/'); return null; }
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
      if (res.status === 401) { router.replace('/'); return; }
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
      if (res.status === 401) { router.replace('/'); return; }
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
                <td>Distinct platforms mentioning the ticker (Reddit, WSB, StockTwits, Yahoo, Polymarket, Kalshi, analyst reports)</td>
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

// ── Analytics Tab Component ──
function AnalyticsTab({ alerts }) {
  // Source performance analysis
  const sourceStats = useMemo(() => {
    const stats = {};
    alerts.forEach(a => {
      const src = getSourceMeta(a.source);
      const key = src.label;
      if (!stats[key]) stats[key] = { total: 0, wins: 0, losses: 0, neutral: 0, avgPct: 0, totalPct: 0, thumbsUp: 0, thumbsDown: 0, emoji: src.emoji, cls: src.cls };
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

  // Rating summary
  const ratingStats = useMemo(() => {
    const rated = alerts.filter(a => a.user_rating);
    return {
      total: rated.length,
      thumbsUp: rated.filter(a => a.user_rating === 'up').length,
      thumbsDown: rated.filter(a => a.user_rating === 'down').length,
      unrated: alerts.length - rated.length,
    };
  }, [alerts]);

  // Best and worst performing sources
  const sortedSources = Object.entries(sourceStats).sort((a, b) => b[1].winRate - a[1].winRate);

  return (
    <div className="analytics-content">
      {/* Source Performance */}
      <div className="analytics-section">
        <h3 className="analytics-heading">{"\u{1F4E1}"} Source Performance</h3>
        <p className="analytics-subtitle">Which signal sources are giving the best picks</p>
        <div className="source-stats-grid">
          {sortedSources.map(([name, stats]) => (
            <div key={name} className="source-stat-card">
              <div className="source-stat-header">
                <span className={`source-badge-sm ${stats.cls}`}>{stats.emoji} {name}</span>
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

      {/* Your Ratings Summary */}
      <div className="analytics-section">
        <h3 className="analytics-heading">{"\u{2B50}"} Your Ratings Summary</h3>
        <p className="analytics-subtitle">Track your assessment of pick quality for fine-tuning</p>
        <div className="ratings-summary-grid">
          <div className="rating-summary-card">
            <div className="rating-summary-value">{ratingStats.thumbsUp}</div>
            <div className="rating-summary-label">{"\u{1F44D}"} Good Picks</div>
          </div>
          <div className="rating-summary-card">
            <div className="rating-summary-value">{ratingStats.thumbsDown}</div>
            <div className="rating-summary-label">{"\u{1F44E}"} Bad Picks</div>
          </div>
          <div className="rating-summary-card">
            <div className="rating-summary-value">{ratingStats.unrated}</div>
            <div className="rating-summary-label">{"\u{23F3}"} Unrated</div>
          </div>
          <div className="rating-summary-card">
            <div className="rating-summary-value">
              {ratingStats.total > 0 ? ((ratingStats.thumbsUp / ratingStats.total) * 100).toFixed(0) + '%' : '\u{2014}'}
            </div>
            <div className="rating-summary-label">{"\u{2705}"} Approval Rate</div>
          </div>
        </div>

        {/* Rated picks list */}
        <div className="rated-picks-list">
          <h4 className="rated-picks-title">Recently Rated Picks</h4>
          {alerts.filter(a => a.user_rating).length === 0 ? (
            <p className="no-ratings-msg">No picks rated yet. Use {"\u{1F44D}"}{"\u{1F44E}"} on any stock card to rate picks.</p>
          ) : (
            <div className="rated-picks-scroll">
              {alerts.filter(a => a.user_rating).map(a => {
                const latest = a.prices[a.prices.length - 1];
                const pct = latest?.pct_change || 0;
                return (
                  <div key={a.id} className="rated-pick-row">
                    <span className="rated-pick-ticker">{a.ticker}</span>
                    <span className="rated-pick-company">{a.company}</span>
                    <span className={`rated-pick-pct ${pctClass(pct)}`}>{fmtPct(pct)}</span>
                    <span className="rated-pick-rating">{a.user_rating === 'up' ? '\u{1F44D}' : '\u{1F44E}'}</span>
                    <span className={`source-badge-sm ${getSourceMeta(a.source).cls}`}>{getSourceMeta(a.source).emoji} {getSourceMeta(a.source).label}</span>
                  </div>
                );
              })}
            </div>
          )}
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
function TradeDetailDrawer({ trade, onUpdateReview }) {
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
function PortfolioTab({ trades, alerts, prices, pricesAsOf, pricesRefreshing, onRefreshPrices, onSell, onDelete, onBuyFromWatchlist, onUpdateReview }) {
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

  const openTrades = trades.filter(t => t.status === 'open');
  const closedTrades = trades.filter(t => t.status === 'closed');

  // Summary: realized + unrealized
  const realizedPnl = closedTrades.reduce((sum, t) =>
    sum + (parseFloat(t.exit_amount) - parseFloat(t.entry_amount)), 0);
  const unrealizedPnl = openTrades.reduce((sum, t) => {
    const latest = getLatest(t.ticker);
    if (latest == null) return sum;
    return sum + (latest * parseFloat(t.shares) - parseFloat(t.entry_amount));
  }, 0);
  const totalInvested = trades.reduce((s, t) => s + parseFloat(t.entry_amount), 0);
  const currentOpenValue = openTrades.reduce((s, t) => {
    const latest = getLatest(t.ticker);
    return s + (latest != null ? latest * parseFloat(t.shares) : parseFloat(t.entry_amount));
  }, 0);
  const totalPnl = realizedPnl + unrealizedPnl;
  const totalPnlPct = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

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
            color: '#7a9bc0',
          }}
        >
          <span title={pricesFreshestAt || ''}>
            Prices updated {fmtAgo(pricesFreshestAt)}
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

      {/* Summary */}
      <div className="pt-summary-grid">
        <div className="pt-stat">
          <div className="pt-stat-label">Total Invested</div>
          <div className="pt-stat-value">${totalInvested.toFixed(2)}</div>
        </div>
        <div className="pt-stat">
          <div className="pt-stat-label">Current Value (Open)</div>
          <div className="pt-stat-value">${currentOpenValue.toFixed(2)}</div>
        </div>
        <div className="pt-stat">
          <div className="pt-stat-label">Realized P/L</div>
          <div className={`pt-stat-value ${realizedPnl >= 0 ? 'pct-pos' : 'pct-neg'}`}>{fmt$(realizedPnl)}</div>
        </div>
        <div className="pt-stat">
          <div className="pt-stat-label">Unrealized P/L</div>
          <div className={`pt-stat-value ${unrealizedPnl >= 0 ? 'pct-pos' : 'pct-neg'}`}>{fmt$(unrealizedPnl)}</div>
        </div>
        <div className="pt-stat pt-stat-hero">
          <div className="pt-stat-label">Total P/L</div>
          <div className={`pt-stat-value pt-stat-hero-value ${totalPnl >= 0 ? 'pct-pos' : 'pct-neg'}`}>
            {fmt$(totalPnl)} <span className="pt-stat-pct">({totalPnl >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%)</span>
          </div>
        </div>
        <div className="pt-stat">
          <div className="pt-stat-label">Win Rate {"("}{closedTrades.length} closed{")"}</div>
          <div className="pt-stat-value">{closedTrades.length > 0 ? winRate.toFixed(0) + '%' : '\u{2014}'}</div>
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
                  <th>AI Rec @ Entry</th>
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
                  const rec = t.ai_recommendation_at_entry || 'HOLD';
                  const isOpen = expandedId === t.id;
                  const hasNote = !!(t.notes && t.notes.trim());
                  return (
                    <React.Fragment key={t.id}>
                      <tr className={`pt-row ${isOpen ? 'pt-row-expanded' : ''}`}>
                        <td className="pt-table-ticker">
                          <button
                            type="button"
                            className="pt-expand-btn"
                            onClick={() => toggleExpand(t.id)}
                            aria-expanded={isOpen}
                            title={hasNote ? t.notes : 'View details'}
                          >
                            <span className={`pt-chevron ${isOpen ? 'open' : ''}`}>{"\u25B8"}</span>
                            {t.ticker}
                            {hasNote && <span className="pt-note-dot" title="Has notes">{"\u{1F4DD}"}</span>}
                          </button>
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
                        <td><span className={`rec-chip ${recClass(rec)}`}>{recLabel(rec)}</span></td>
                        <td>
                          <button className="pt-sell-btn" onClick={() => onSell(t, latest != null ? latest : parseFloat(t.entry_price))}>
                            {"\u{1F4B0}"} Sell
                          </button>
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="pt-drawer-row">
                          <td colSpan={11}>
                            <TradeDetailDrawer trade={t} onUpdateReview={onUpdateReview} />
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
                          <button
                            type="button"
                            className="pt-expand-btn"
                            onClick={() => toggleExpand(t.id)}
                            aria-expanded={isOpen}
                            title={hasNote ? t.notes : 'View details'}
                          >
                            <span className={`pt-chevron ${isOpen ? 'open' : ''}`}>{"\u25B8"}</span>
                            {t.ticker}
                            {hasNote && <span className="pt-note-dot">{"\u{1F4DD}"}</span>}
                            {t.ai_review_verdict && <span className={`pt-verdict-dot pt-verdict-${t.ai_review_verdict}`} title={`Reviewed: ${t.ai_review_verdict}`}>{verdictEmoji(t.ai_review_verdict)}</span>}
                          </button>
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
                            <TradeDetailDrawer trade={t} onUpdateReview={onUpdateReview} />
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
              <p className="quicktable-hint">Click any column header to sort. Click a ticker or company name to jump to its card.</p>
            )}
          </div>
        </div>
        {!collapsed && (
          <div className="quicktable-controls">
            <div className="quicktable-search">
              <span className="qt-search-icon">{"\u{1F50D}"}</span>
              <input
                type="text"
                placeholder="Filter ticker, company, signal..."
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
              const pickLabel = pickStatus === 'new' ? '\u{1F195} NEW' : pickStatus === 'dropped' ? '\u{1F4E6} DROPPED' : '\u{1F7E2} ACTIVE';
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
                source: <td key="source"><span className={`source-badge-sm ${srcMeta.cls}`}>{srcMeta.emoji} {srcMeta.label}</span></td>,
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

  const renderRow = (u) => (
    <tr key={u.id}>
      <td>
        <div className="admin-user-cell">
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
      <td>
        <span className={`admin-status admin-status-${u.status}`}>{u.status}</span>
      </td>
      <td>{new Date(u.created_at).toLocaleDateString()}</td>
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

  return (
    <div className="admin-users-tab">
      <p className="section-hint" style={{ marginLeft: 0, marginTop: 0 }}>
        Approve new signups, disable access, or promote others to admin. You are the initial admin.
      </p>

      {pending.length > 0 && (
        <>
          <h3 className="admin-section-title">{"\u{23F3}"} Pending approval ({pending.length})</h3>
          <div className="pt-table-wrap"><table className="pt-table admin-table">
            <thead><tr><th>User</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
            <tbody>{pending.map(renderRow)}</tbody>
          </table></div>
        </>
      )}

      <h3 className="admin-section-title">{"\u{2705}"} Approved ({approved.length})</h3>
      <div className="pt-table-wrap"><table className="pt-table admin-table">
        <thead><tr><th>User</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody>{approved.map(renderRow)}</tbody>
      </table></div>

      {disabled.length > 0 && (
        <>
          <h3 className="admin-section-title">{"\u{1F6AB}"} Disabled ({disabled.length})</h3>
          <div className="pt-table-wrap"><table className="pt-table admin-table">
            <thead><tr><th>User</th><th>Status</th><th>Joined</th><th>Actions</th></tr></thead>
            <tbody>{disabled.map(renderRow)}</tbody>
          </table></div>
        </>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [recFilter, setRecFilter] = useState('ALL');   // 'ALL' | 'BUY' | 'SELL'
  const [activeTab, setActiveTab] = useState('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [mcapRange, setMcapRange] = useState([0, 5000]);
  const [showArchive, setShowArchive] = useState(false);
  const [showDistList, setShowDistList] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [aiSettings, setAISettings] = useState({});
  const [watchlist, setWatchlistState] = useState([]);
  const [paperTrades, setPaperTrades] = useState([]);
  // Live ticker -> { price, price_date, updated_at } map. Single source of
  // truth for Portfolio + Leaderboard P/L so staleness in one user's
  // alerts[] can't skew everyone else's view. Refreshed on a 2-min timer
  // plus on tab focus, plus on the manual "Refresh prices" button.
  const [prices, setPrices] = useState({});
  const [pricesAsOf, setPricesAsOf] = useState(null);
  const [pricesRefreshing, setPricesRefreshing] = useState(false);
  const [buyModalState, setBuyModalState] = useState(null);   // { alert, currentPrice }
  const [sellModalState, setSellModalState] = useState(null); // { trade, currentPrice }
  const [profile, setProfile] = useState(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState('');
  // Per-user ticker notes, keyed by ticker symbol. Loaded alongside alerts.
  const [userNotes, setUserNotes] = useState({});
  const router = useRouter();

  useEffect(() => {
    setWatchlistState(getWatchlist());
    setMcapRange(getMarketCapFilter());

    // Load the logged-in user's profile (Google-auth). If none, send to /
    fetch('/api/profile')
      .then(res => {
        if (res.status === 401) { router.replace('/'); return null; }
        return res.json();
      })
      .then(data => {
        if (data?.profile) {
          if (data.profile.status !== 'approved') { router.replace('/pending'); return; }
          setProfile(data.profile);
        }
      })
      .catch(() => {});

    fetch('/api/alerts')
      .then(res => {
        if (res.status === 401) { router.replace('/'); return null; }
        return res.json();
      })
      .then(data => {
        if (data?.alerts) setAlerts(data.alerts);
        setLoading(false);
      })
      .catch(() => router.replace('/'));

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
  }, [router]);

  // ── Live price refresh ─────────────────────────────────────────────
  // Fetches the shared current_prices map from /api/prices. Called on
  // mount, every 2 minutes while the tab is visible, whenever the user
  // switches back to the tab, and on-demand via the Refresh button.
  const refreshPrices = useCallback(async () => {
    try {
      setPricesRefreshing(true);
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

  const handleToggleWatchlist = useCallback((ticker) => {
    const newList = toggleWatchlist(ticker);
    setWatchlistState([...newList]);
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      const { createSupabaseBrowserClient } = await import('../lib/supabase/browser');
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.signOut();
      // Also clear the legacy cookie
      document.cookie = 'stock_auth=; Path=/; Max-Age=0; SameSite=Lax';
      router.replace('/');
    } catch {
      router.replace('/');
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
    // Optimistic update
    setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, user_rating: rating } : a));

    try {
      if (rating === null) {
        await fetch(`/api/ratings?alert_id=${alertId}`, { method: 'DELETE' });
      } else {
        await fetch('/api/ratings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ alert_id: alertId, rating }),
        });
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
    const tab = alert.status === 'dropped' ? 'dropped'
      : alert.status === 'new' ? 'new' : 'active';
    setActiveTab(tab);
    setSearchQuery('');
    setFilter('ALL');
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

  // Apply all filters: search + signal type + market cap
  const applyAllFilters = useCallback((list) => {
    let filtered = list;

    // Signal type filter
    if (filter !== 'ALL') filtered = filtered.filter(a => a.signal_type === filter);

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(a =>
        a.ticker.toLowerCase().includes(q) ||
        a.company.toLowerCase().includes(q)
      );
    }

    // Recommendation filter (BUY / SELL)
    if (recFilter !== 'ALL') filtered = filtered.filter(a => a.recommendation === recFilter);

    // Market cap filter
    if (mcapRange[0] > 0 || mcapRange[1] < 5000) {
      filtered = filtered.filter(a => {
        if (a.market_cap === null || a.market_cap === undefined) return true; // Show stocks without market cap data
        return a.market_cap >= mcapRange[0] && a.market_cap <= mcapRange[1];
      });
    }

    return filtered;
  }, [filter, recFilter, searchQuery, mcapRange]);

  // Dismissed rows drop out of the normal tabs (they reappear in the Archive section).
  const notDismissed = (a) => !a.dismissed_at;
  const newPicks = useMemo(() => sortByPerf(alerts.filter(a => a.status === 'new' && notDismissed(a))), [alerts]);
  const activePicks = useMemo(() => sortByPerf(alerts.filter(a => a.status === 'active' && notDismissed(a))), [alerts]);
  const droppedPicks = useMemo(() => sortByPerf(alerts.filter(a => a.status === 'dropped' && notDismissed(a))), [alerts]);
  const watchlistPicks = useMemo(() => sortByPerf(alerts.filter(a => watchlist.includes(a.ticker) && notDismissed(a))), [alerts, watchlist]);

  const filteredNew = useMemo(() => applyAllFilters(newPicks), [newPicks, applyAllFilters]);
  const filteredActive = useMemo(() => applyAllFilters(activePicks), [activePicks, applyAllFilters]);
  const filteredDropped = useMemo(() => applyAllFilters(droppedPicks), [droppedPicks, applyAllFilters]);
  const filteredWatchlist = useMemo(() => applyAllFilters(watchlistPicks), [watchlistPicks, applyAllFilters]);

  const signalTypes = useMemo(() => ['ALL', ...new Set(alerts.map(a => a.signal_type))], [alerts]);

  const currentPicks = [...newPicks, ...activePicks];
  const totalCurrent = currentPicks.length;
  const buys = currentPicks.filter(a => a.recommendation === 'BUY').length;
  const sells = currentPicks.filter(a => a.recommendation === 'SELL').length;
  const avgPct = currentPicks.length > 0
    ? (currentPicks.reduce((sum, a) => sum + getLatestPct(a), 0) / currentPicks.length) : 0;

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  // Tab definitions
  const tabs = [
    { id: 'new', label: '\u{1F195} New', count: newPicks.length },
    { id: 'active', label: '\u{1F525} Active', count: activePicks.length },
    { id: 'dropped', label: '\u{1F4E6} Dropped', count: droppedPicks.length },
    { id: 'watchlist', label: '\u{2B50} Watchlist', count: watchlistPicks.length },
    { id: 'portfolio', label: '\u{1F4BC} Portfolio', count: paperTrades.filter(t => t.status === 'open').length || null },
    { id: 'leaderboard', label: '\u{1F3C6} Leaderboard', count: null },
    { id: 'analytics', label: '\u{1F4CA} Analytics', count: null },
    ...(profile?.is_admin ? [{ id: 'users', label: '\u{1F464} Users', count: null }] : []),
  ];

  // Current tab data
  const getTabData = () => {
    switch (activeTab) {
      case 'new': return filteredNew;
      case 'active': return filteredActive;
      case 'dropped': return filteredDropped;
      case 'watchlist': return filteredWatchlist;
      default: return filteredActive;
    }
  };

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p style={{ color: '#7a9bc0' }}>Loading stock intelligence...</p>
      </div>
    );
  }

  return (
    <>
      <header className="header">
        <div className="header-main">
          <h1>{"\u{1F4C8}"} Social Stock <span>Intelligence Monitor</span></h1>
          <div className="subtitle">Last updated: {dateStr} {"\u{B7}"} Auto-scan complete</div>
        </div>
        <div className="header-tools">
          <button
            className={`header-tool-btn ${showArchive ? 'active' : ''}`}
            onClick={() => {
              const next = !showArchive;
              setShowArchive(next);
              if (next) setTimeout(() => document.getElementById('archive-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
            }}
            title="Show full archive of all historical picks"
          >
            {"\u{1F4C2}"} <span className="header-tool-label">Archive</span>
            <span className="header-tool-badge">{alerts.length}</span>
          </button>
          <button
            className={`header-tool-btn ${showAISettings ? 'active' : ''}`}
            onClick={() => {
              const next = !showAISettings;
              setShowAISettings(next);
              if (next) setTimeout(() => document.getElementById('ai-settings-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
            }}
            title="Manage AI engine settings"
          >
            {"\u{2699}\u{FE0F}"} <span className="header-tool-label">AI Settings</span>
          </button>
          <button
            className={`header-tool-btn ${showDistList ? 'active' : ''}`}
            onClick={() => {
              const next = !showDistList;
              setShowDistList(next);
              if (next) setTimeout(() => document.getElementById('dist-list-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
            }}
            title="Manage signal change email alerts"
          >
            {"\u{1F4E7}"} <span className="header-tool-label">Alert List</span>
          </button>

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
                  <button className="profile-menu-signout" onClick={handleSignOut}>Sign out</button>
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      {/* QUICK SCAN TABLE (sortable, top-of-dashboard at-a-glance view) */}
      <QuickTable
        alerts={alerts}
        watchlist={watchlist}
        onToggleWatchlist={handleToggleWatchlist}
        onJumpToCard={handleJumpToCard}
      />

      {/* STATS BAR */}
      <div className="stats-bar">
        <div className={`stat-card stat-card-click${activeTab === 'active' && recFilter === 'ALL' ? ' stat-card-active' : ''}`}
          onClick={() => { setActiveTab('active'); setRecFilter('ALL'); document.getElementById('tabs-anchor')?.scrollIntoView({ behavior: 'smooth' }); }}>
          <div className="stat-value">{totalCurrent}</div>
          <div className="stat-label">Current Picks</div>
        </div>
        <div className={`stat-card stat-card-click${activeTab === 'new' ? ' stat-card-active' : ''}`}
          onClick={() => { setActiveTab('new'); setRecFilter('ALL'); document.getElementById('tabs-anchor')?.scrollIntoView({ behavior: 'smooth' }); }}>
          <div className="stat-value" style={{ color: '#00e5ff' }}>{newPicks.length}</div>
          <div className="stat-label">{"\u{1F195}"} New Today</div>
        </div>
        <div className={`stat-card stat-buy-glow stat-card-click${recFilter === 'BUY' ? ' stat-card-active' : ''}`}
          onClick={() => { setActiveTab('active'); setRecFilter('BUY'); document.getElementById('tabs-anchor')?.scrollIntoView({ behavior: 'smooth' }); }}>
          <div className="stat-value" style={{ color: '#22c55e' }}>{buys}</div>
          <div className="stat-label">{"\u{1F7E2}"} AI Says BUY</div>
        </div>
        <div className={`stat-card stat-card-click${recFilter === 'SELL' ? ' stat-card-active' : ''}`}
          onClick={() => { setActiveTab('active'); setRecFilter('SELL'); document.getElementById('tabs-anchor')?.scrollIntoView({ behavior: 'smooth' }); }}>
          <div className="stat-value" style={{ color: '#ef4444' }}>{sells}</div>
          <div className="stat-label">{"\u{1F534}"} AI Says SELL</div>
        </div>
        <div className={`stat-card stat-card-click${activeTab === 'analytics' ? ' stat-card-active' : ''}`}
          onClick={() => { setActiveTab('analytics'); setRecFilter('ALL'); document.getElementById('tabs-anchor')?.scrollIntoView({ behavior: 'smooth' }); }}>
          <div className="stat-value" style={{ color: avgPct >= 0 ? '#22c55e' : '#ef4444' }}>
            {fmtPct(avgPct)}
          </div>
          <div className="stat-label">Avg Return</div>
        </div>
        <div className={`stat-card stat-card-click${activeTab === 'watchlist' ? ' stat-card-active' : ''}`}
          onClick={() => { setActiveTab('watchlist'); setRecFilter('ALL'); document.getElementById('tabs-anchor')?.scrollIntoView({ behavior: 'smooth' }); }}>
          <div className="stat-value" style={{ color: '#fbbf24' }}>{watchlist.length}</div>
          <div className="stat-label">{"\u{2B50}"} Watchlist</div>
        </div>
        <div className={`stat-card stat-card-click${activeTab === 'dropped' ? ' stat-card-active' : ''}`}
          onClick={() => { setActiveTab('dropped'); setRecFilter('ALL'); document.getElementById('tabs-anchor')?.scrollIntoView({ behavior: 'smooth' }); }}>
          <div className="stat-value" style={{ color: '#7a9bc0' }}>{droppedPicks.length}</div>
          <div className="stat-label">{"\u{1F4E6}"} Dropped</div>
        </div>
      </div>
      {recFilter !== 'ALL' && (
        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
          <button className="rec-filter-chip" onClick={() => setRecFilter('ALL')}>
            Showing {recFilter} only &times;
          </button>
        </div>
      )}

      {/* TOP GAINERS / BIGGEST LOSERS */}
      {(() => {
        const sorted = currentPicks
          .map(a => ({ ticker: a.ticker, company: a.company, pct: getLatestPct(a) }))
          .sort((a, b) => b.pct - a.pct);
        const topGainers = sorted.slice(0, 5);
        const topLosers = [...sorted].sort((a, b) => a.pct - b.pct).slice(0, 5);
        return (
          <div className="movers-row">
            <div className="movers-card">
              <h3 className="movers-heading movers-gainers-heading">{"\u{1F4C8}"} Top Gainers</h3>
              <div className="movers-list">
                {topGainers.map((s, i) => (
                  <div key={s.ticker} className="movers-item">
                    <span className="movers-rank">{i + 1}</span>
                    <span className="movers-ticker">{s.ticker}</span>
                    <span className="movers-pct pct-pos">{fmtPct(s.pct)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="movers-card">
              <h3 className="movers-heading movers-losers-heading">{"\u{1F4C9}"} Biggest Losers</h3>
              <div className="movers-list">
                {topLosers.map((s, i) => (
                  <div key={s.ticker} className="movers-item">
                    <span className="movers-rank">{i + 1}</span>
                    <span className="movers-ticker">{s.ticker}</span>
                    <span className="movers-pct pct-neg">{fmtPct(s.pct)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* SEARCH BAR */}
      <div className="search-bar-container">
        <div className="search-bar">
          <span className="search-icon">{"\u{1F50D}"}</span>
          <input
            type="text"
            className="search-input"
            placeholder="Search by ticker or company name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="search-clear" onClick={() => setSearchQuery('')}>{"\u{2715}"}</button>
          )}
        </div>
        <MarketCapSlider range={mcapRange} onChange={setMcapRange} />
      </div>

      {/* TABS */}
      <div id="tabs-anchor" />
      <div className="tabs-container">
        <div className="tabs-row">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''} ${tab.id === 'new' && newPicks.length > 0 ? 'tab-glow' : ''}`}
              onClick={() => { setActiveTab(tab.id); setRecFilter('ALL'); }}
            >
              {tab.label}
              {tab.count !== null && <span className="tab-count">{tab.count}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* FILTER BAR (signal type) - shown on all tabs except analytics */}
      {activeTab !== 'analytics' && (
        <div className="filter-bar">
          {signalTypes.map(type => (
            <button
              key={type}
              className={`filter-btn ${filter === type ? 'active' : ''}`}
              onClick={() => setFilter(type)}
            >
              {type}
            </button>
          ))}
        </div>
      )}

      {/* ACTIVE AI FILTER BANNER - shows when a non-default AI filter is applied */}
      <ActiveAIFilterBanner
        settings={aiSettings}
        onClear={handleSaveAISetting}
        onOpenSettings={() => setShowAISettings(true)}
      />

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
          onRefreshPrices={() => { refreshPrices(); refreshPaperTrades(); }}
          onSell={handleOpenSellModal}
          onDelete={handleDeleteTrade}
          onUpdateReview={handleUpdateReview}
        />
      ) : activeTab === 'leaderboard' ? (
        <LeaderboardTab alerts={alerts} prices={prices} currentUserId={profile?.id} />
      ) : activeTab === 'users' && profile?.is_admin ? (
        <UsersAdminTab currentUserId={profile.id} />
      ) : (
        <>
          {/* Tab description */}
          <p className="section-hint" style={{ marginLeft: '40px', marginTop: '8px' }}>
            {activeTab === 'new' && 'Fresh signals detected today. Worth investigating before they move.'}
            {activeTab === 'active' && 'Current picks being tracked. Sorted by performance.'}
            {activeTab === 'dropped' && 'Previously tracked stocks where the signal has faded.'}
            {activeTab === 'watchlist' && 'Stocks you\'re personally tracking. Click the star on any card to add/remove. Use Paper Buy to simulate trades.'}
          </p>

          {/* Cards grid */}
          <div className="cards-grid">
            {getTabData().length > 0 ? getTabData().map((alert, idx) => (
              <AlertCard
                key={alert.id || idx}
                alert={alert}
                index={idx}
                sectionPrefix={activeTab}
                watchlist={watchlist}
                onToggleWatchlist={handleToggleWatchlist}
                onRate={handleRate}
                onDismiss={handleDismiss}
                onSaveNote={handleSaveNote}
                userNote={userNotes[alert.ticker]}
                openPosition={openTradeFor(alert.ticker)}
                onOpenBuyModal={handleOpenBuyModal}
                onOpenSellModal={handleOpenSellModal}
              />
            )) : (
              <p style={{ color: '#4a6a85', padding: '20px 0', fontSize: '0.9rem' }}>
                {searchQuery ? `No results for "${searchQuery}" in this tab.` : 'No picks match current filters.'}
              </p>
            )}
          </div>
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

      {/* FULL ARCHIVE TABLE */}
      <div className="archive-section" id="archive-section">
        {showArchive && (
          <p className="section-title" style={{ marginLeft: 0 }}>{"\u{1F4C5}"} Full Archive {"\u{2014}"} All Historical Picks ({alerts.length} total) <button className="section-close-btn" onClick={() => setShowArchive(false)}>{"\u{2715}"} Close</button></p>
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
                    const pickLabel = pickStatus === 'new' ? '\u{1F195} NEW' : pickStatus === 'dropped' ? '\u{1F4E6} DROPPED' : '\u{1F7E2} ACTIVE';
                    const isWatched = watchlist.includes(alert.ticker);
                    const srcMeta = getSourceMeta(alert.source);
                    const signalChange = alert.latest_signal_change;
                    return (
                      <tr key={alert.id || idx} className={pickStatus === 'dropped' ? 'row-dropped' : ''}>
                        <td>
                          <button
                            className={`watchlist-btn-sm ${isWatched ? 'watched' : ''}`}
                            onClick={() => handleToggleWatchlist(alert.ticker)}
                          >
                            {isWatched ? '\u{2605}' : '\u{2606}'}
                          </button>
                        </td>
                        <td>
                          <span className="tbl-rating">
                            {alert.user_rating === 'up' ? '\u{1F44D}' : alert.user_rating === 'down' ? '\u{1F44E}' : '\u{2014}'}
                          </span>
                        </td>
                        <td><span className={`pick-status-chip pick-${pickStatus}`}>{pickLabel}</span></td>
                        <td className="tbl-alert-date">{alert.alert_date}</td>
                        <td className="tbl-ticker">{alert.ticker}</td>
                        <td style={{ color: '#a0b8d0' }}>{alert.company}</td>
                        <td><span className={`source-badge-sm ${srcMeta.cls}`}>{srcMeta.emoji} {srcMeta.label}</span></td>
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

      {/* AI ENGINE SETTINGS */}
      <div className="archive-section" id="ai-settings-section">
        {showAISettings && (
          <>
            <p className="section-title" style={{ marginLeft: 0 }}>{"\u{2699}\u{FE0F}"} AI Engine Settings <button className="section-close-btn" onClick={() => setShowAISettings(false)}>{"\u{2715}"} Close</button></p>
            <AISettingsPanel settings={aiSettings} onSave={handleSaveAISetting} />
          </>
        )}
      </div>

      {/* DISTRIBUTION LIST */}
      <div className="archive-section" id="dist-list-section">
        {showDistList && (
          <>
            <p className="section-title" style={{ marginLeft: 0 }}>{"\u{1F4E7}"} Signal Change Alert List <button className="section-close-btn" onClick={() => setShowDistList(false)}>{"\u{2715}"} Close</button></p>
            <DistributionListManager />
          </>
        )}
      </div>

      <footer>
        {"\u{26A1}"} Auto-updated daily at 9am &nbsp;|&nbsp; Powered by <span>Social Stock Intelligence Monitor</span> &nbsp;|&nbsp; Sources: <span>WSB {"\u{B7}"} Reddit {"\u{B7}"} Polymarket {"\u{B7}"} Kalshi {"\u{B7}"} Yahoo Finance {"\u{B7}"} Google Finance {"\u{B7}"} StockTwits</span>
        <div className="disclaimer">{"\u{26A0}"}{"\u{FE0F}"} AI recommendations are based on momentum, timing &amp; price action analysis. This is NOT financial advice. Always do your own research before investing.</div>
      </footer>
    </>
  );
}
