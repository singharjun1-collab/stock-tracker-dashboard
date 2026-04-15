'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
            <div className="tt-row"><span>Velocity score (25%)</span><span>{subScores.velocity}/100</span></div>
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
function AlertCard({ alert, index, sectionPrefix, watchlist, onToggleWatchlist, onRate }) {
  const latest = alert.prices[alert.prices.length - 1];
  const pct = latest?.pct_change || 0;
  const perfStatus = getStatus(pct);
  const isNew = alert.status === 'new';
  const isDropped = alert.status === 'dropped';
  const isWatched = watchlist.includes(alert.ticker);
  const sourceMeta = getSourceMeta(alert.source);

  const alertDateObj = new Date(alert.alert_date + 'T00:00:00');
  const alertDateFormatted = alertDateObj.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });

  // Forecast sell date
  const forecastDate = alert.forecast_sell_date
    ? new Date(alert.forecast_sell_date + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric'
      })
    : null;

  // Days until forecast
  const daysUntilForecast = alert.forecast_sell_date
    ? Math.ceil((new Date(alert.forecast_sell_date) - new Date()) / (1000 * 60 * 60 * 24))
    : null;

  return (
    <div className={`card ${perfStatus}${isNew ? ' card-new' : ''}${isDropped ? ' card-dropped' : ''}${isWatched ? ' card-watched' : ''}`}>
      <div className="card-top">
        <div>
          <div className="ticker">
            {alert.ticker}
            {isNew && <span className="new-badge">{"\u{1F195}"} NEW</span>}
            {isDropped && <span className="dropped-badge">{"\u{1F4E6}"} DROPPED</span>}
          </div>
          <div className="company">{alert.company}</div>
        </div>
        <div className="card-top-right">
          <RatingButtons alertId={alert.id} currentRating={alert.user_rating} onRate={onRate} />
          <button
            className={`watchlist-btn ${isWatched ? 'watched' : ''}`}
            onClick={() => onToggleWatchlist(alert.ticker)}
            title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            {isWatched ? '\u{2605}' : '\u{2606}'}
          </button>
          <span className={`status-badge badge-${perfStatus}`}>{statusLabel(pct)}</span>
        </div>
      </div>

      {/* SOURCE BADGE + MARKET CAP */}
      <div className="card-source-row">
        <span className={`source-badge-sm ${sourceMeta.cls}`}>{sourceMeta.emoji} {sourceMeta.label}</span>
        {alert.market_cap != null && (
          <span className={`mcap-card-badge ${alert.market_cap >= 200 ? 'mcap-mega' : alert.market_cap >= 10 ? 'mcap-large' : alert.market_cap >= 2 ? 'mcap-mid' : 'mcap-small'}`}>
            {"\u{1F3E2}"} {alert.market_cap >= 1000 ? '$' + (alert.market_cap / 1000).toFixed(1) + 'T' : '$' + alert.market_cap.toFixed(1) + 'B'} {alert.market_cap >= 200 ? 'Mega' : alert.market_cap >= 10 ? 'Large' : alert.market_cap >= 2 ? 'Mid' : 'Small'} Cap
          </span>
        )}
        {alert.market_cap == null && (
          <span className="mcap-card-badge mcap-unknown">{"\u{1F3E2}"} Market Cap N/A</span>
        )}
      </div>

      {/* SIGNAL STRENGTH */}
      <div className="card-source-row" style={{ marginTop: '4px' }}>
        <SignalBars
          score={alert.signal_strength}
          subScores={alert.signal_sub_scores}
          sourceCount={alert.signal_source_count}
          mentionCount={alert.signal_mention_count}
        />
      </div>

      {/* ALERT DATE & PRICE BANNER */}
      <div className="alert-date-banner">
        <div className="alert-date-item">
          <span className="alert-date-label">{"\u{1F4C5}"} ALERTED</span>
          <span className="alert-date-value">{alertDateFormatted}</span>
        </div>
        <div className="alert-date-item">
          <span className="alert-date-label">{"\u{1F4B5}"} PRICE AT ALERT</span>
          <span className="alert-date-value alert-price-highlight">${parseFloat(alert.price_at_alert).toFixed(2)}</span>
        </div>
      </div>

      {/* FORECAST SELL DATE */}
      {forecastDate && (
        <div className={`forecast-banner ${daysUntilForecast <= 3 ? 'forecast-soon' : daysUntilForecast <= 0 ? 'forecast-passed' : ''}`}>
          <span className="forecast-label">{"\u{1F3AF}"} FORECAST SELL</span>
          <span className="forecast-value">{forecastDate}</span>
          {daysUntilForecast > 0 && <span className="forecast-days">{daysUntilForecast}d away</span>}
          {daysUntilForecast <= 0 && <span className="forecast-days forecast-overdue">Overdue</span>}
        </div>
      )}

      <div className="price-row">
        <span className="price-alert">${parseFloat(alert.price_at_alert).toFixed(2)}</span>
        <span className="arrow">{"\u{2192}"}</span>
        <span className="price-current">${latest?.price?.toFixed(2) || '\u{2014}'}</span>
        <span className={`pct-change ${pctClass(pct)}`}>{fmtPct(pct)}</span>
      </div>

      <div className="meta-row">
        <span className="meta-tag">{alert.signal_type}</span>
      </div>

      <SparklineChart prices={alert.prices} canvasId={`${sectionPrefix}-spark-${index}`} />
      <HistoricChart ticker={alert.ticker} canvasId={`${sectionPrefix}-hist-${index}`} />

      {alert.recommendation && (
        <div className={`rec-bar ${recClass(alert.recommendation)}`}>
          <span className="rec-label">{recLabel(alert.recommendation)}</span>
          <span className="rec-reason">{alert.recommendation_reason || ''}</span>
        </div>
      )}

      <AnalystBadge ticker={alert.ticker} />

      <div className="alert-reason">{alert.alert_reason}</div>

      {/* SIGNAL CHANGE INFO */}
      {alert.latest_signal_change && (
        <div className="signal-change-info">
          <span className="sc-label">{"\u{1F4E2}"} Signal Changed:</span>
          <span className={`rec-chip ${recClass(alert.latest_signal_change.old_recommendation)}`}>
            {alert.latest_signal_change.old_recommendation}
          </span>
          <span className="sc-arrow">{"\u{2192}"}</span>
          <span className={`rec-chip ${recClass(alert.latest_signal_change.new_recommendation)}`}>
            {alert.latest_signal_change.new_recommendation}
          </span>
          <span className="sc-date">
            {new Date(alert.latest_signal_change.change_date || alert.latest_signal_change.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </span>
        </div>
      )}

      <ProfitLossCalc priceAtAlert={alert.price_at_alert} latestPrice={latest?.price} />
      <RedditLinks ticker={alert.ticker} />

      <div className="research-row">
        <a href={`https://finance.yahoo.com/quote/${alert.ticker}`} target="_blank" rel="noopener noreferrer" className="research-link">
          Yahoo Finance {"\u{2192}"}
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
                <td>Distinct platforms mentioning the ticker (Reddit, WSB, StockTwits, Yahoo, Polymarket, analyst reports)</td>
              </tr>
              <tr>
                <td>Mention volume</td>
                <td>{Math.round(SIGNAL_WEIGHTS.mention_count * 100)}%</td>
                <td>Total alerts + signal-change events for this ticker across the scan window</td>
              </tr>
              <tr>
                <td>Velocity</td>
                <td>{Math.round(SIGNAL_WEIGHTS.velocity * 100)}%</td>
                <td>How fast the move is accelerating &mdash; latest day&apos;s % change vs. prior days&apos; average</td>
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
export default function Dashboard() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [activeTab, setActiveTab] = useState('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [mcapRange, setMcapRange] = useState([0, 5000]);
  const [showArchive, setShowArchive] = useState(false);
  const [showDistList, setShowDistList] = useState(false);
  const [showAISettings, setShowAISettings] = useState(false);
  const [aiSettings, setAISettings] = useState({});
  const [watchlist, setWatchlistState] = useState([]);
  const router = useRouter();

  useEffect(() => {
    setWatchlistState(getWatchlist());
    setMcapRange(getMarketCapFilter());

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

    // Fetch AI settings
    fetch('/api/settings')
      .then(res => res.ok ? res.json() : null)
      .then(data => { if (data?.settings) setAISettings(data.settings); })
      .catch(() => {});
  }, [router]);

  const handleToggleWatchlist = useCallback((ticker) => {
    const newList = toggleWatchlist(ticker);
    setWatchlistState([...newList]);
  }, []);

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

    // Market cap filter
    if (mcapRange[0] > 0 || mcapRange[1] < 5000) {
      filtered = filtered.filter(a => {
        if (a.market_cap === null || a.market_cap === undefined) return true; // Show stocks without market cap data
        return a.market_cap >= mcapRange[0] && a.market_cap <= mcapRange[1];
      });
    }

    return filtered;
  }, [filter, searchQuery, mcapRange]);

  const newPicks = useMemo(() => sortByPerf(alerts.filter(a => a.status === 'new')), [alerts]);
  const activePicks = useMemo(() => sortByPerf(alerts.filter(a => a.status === 'active')), [alerts]);
  const droppedPicks = useMemo(() => sortByPerf(alerts.filter(a => a.status === 'dropped')), [alerts]);
  const watchlistPicks = useMemo(() => sortByPerf(alerts.filter(a => watchlist.includes(a.ticker))), [alerts, watchlist]);

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
    { id: 'analytics', label: '\u{1F4CA} Analytics', count: null },
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
        <h1>{"\u{1F4C8}"} Social Stock <span>Intelligence Monitor</span></h1>
        <div className="subtitle">Last updated: {dateStr} {"\u{B7}"} Auto-scan complete</div>
      </header>

      {/* STATS BAR */}
      <div className="stats-bar">
        <div className="stat-card">
          <div className="stat-value">{totalCurrent}</div>
          <div className="stat-label">Current Picks</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#00e5ff' }}>{newPicks.length}</div>
          <div className="stat-label">{"\u{1F195}"} New Today</div>
        </div>
        <div className="stat-card stat-buy-glow">
          <div className="stat-value" style={{ color: '#22c55e' }}>{buys}</div>
          <div className="stat-label">{"\u{1F7E2}"} AI Says BUY</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#ef4444' }}>{sells}</div>
          <div className="stat-label">{"\u{1F534}"} AI Says SELL</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: avgPct >= 0 ? '#22c55e' : '#ef4444' }}>
            {fmtPct(avgPct)}
          </div>
          <div className="stat-label">Avg Return</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#fbbf24' }}>{watchlist.length}</div>
          <div className="stat-label">{"\u{2B50}"} Watchlist</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#7a9bc0' }}>{droppedPicks.length}</div>
          <div className="stat-label">{"\u{1F4E6}"} Dropped</div>
        </div>
      </div>

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
      <div className="tabs-container">
        <div className="tabs-row">
          {tabs.map(tab => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? 'active' : ''} ${tab.id === 'new' && newPicks.length > 0 ? 'tab-glow' : ''}`}
              onClick={() => setActiveTab(tab.id)}
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

      {/* TAB CONTENT */}
      {activeTab === 'analytics' ? (
        <AnalyticsTab alerts={alerts} />
      ) : (
        <>
          {/* Tab description */}
          <p className="section-hint" style={{ marginLeft: '40px', marginTop: '8px' }}>
            {activeTab === 'new' && 'Fresh signals detected today. Worth investigating before they move.'}
            {activeTab === 'active' && 'Current picks being tracked. Sorted by performance.'}
            {activeTab === 'dropped' && 'Previously tracked stocks where the signal has faded.'}
            {activeTab === 'watchlist' && 'Stocks you\'re personally tracking. Click the star on any card to add/remove.'}
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
              />
            )) : (
              <p style={{ color: '#4a6a85', padding: '20px 0', fontSize: '0.9rem' }}>
                {searchQuery ? `No results for "${searchQuery}" in this tab.` : 'No picks match current filters.'}
              </p>
            )}
          </div>
        </>
      )}

      {/* FULL ARCHIVE TABLE */}
      <div className="archive-section">
        <p className="section-title" style={{ marginLeft: 0 }}>{"\u{1F4C5}"} Full Archive {"\u{2014}"} All Historical Picks</p>
        <button className="archive-toggle-btn" onClick={() => setShowArchive(!showArchive)}>
          {"\u{1F4C2}"} {showArchive ? 'Hide' : 'Show'} Archive ({alerts.length} total)
        </button>
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
      <div className="archive-section">
        <button className="archive-toggle-btn ai-settings-toggle" onClick={() => setShowAISettings(!showAISettings)}>
          {"\u{2699}\u{FE0F}"} {showAISettings ? 'Hide' : 'Manage'} AI Engine Settings
        </button>
        {showAISettings && <AISettingsPanel settings={aiSettings} onSave={handleSaveAISetting} />}
      </div>

      {/* DISTRIBUTION LIST */}
      <div className="archive-section">
        <button className="archive-toggle-btn" onClick={() => setShowDistList(!showDistList)}>
          {"\u{1F4E7}"} {showDistList ? 'Hide' : 'Manage'} Signal Change Alert List
        </button>
        {showDistList && <DistributionListManager />}
      </div>

      <footer>
        {"\u{26A1}"} Auto-updated daily at 9am &nbsp;|&nbsp; Powered by <span>Social Stock Intelligence Monitor</span> &nbsp;|&nbsp; Sources: <span>WSB {"\u{B7}"} Reddit {"\u{B7}"} Polymarket {"\u{B7}"} Yahoo Finance {"\u{B7}"} Google Finance {"\u{B7}"} StockTwits</span>
        <div className="disclaimer">{"\u{26A0}"}{"\u{FE0F}"} AI recommendations are based on momentum, timing &amp; price action analysis. This is NOT financial advice. Always do your own research before investing.</div>
      </footer>
    </>
  );
}
