'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import '../globals.css';

// ── Helpers ──
function getStatus(pct) {
  if (pct > 10) return 'win';
  if (pct < -10) return 'loss';
  return 'neutral';
}
function statusLabel(pct) {
  const s = getStatus(pct);
  if (s === 'win') return '✅ WIN';
  if (s === 'loss') return '❌ LOSS';
  return '⚠️ NEUTRAL';
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
  if (rec === 'BUY') return '🟢 BUY';
  if (rec === 'SELL') return '🔴 SELL';
  return '🟡 HOLD';
}
function recClass(rec) {
  if (rec === 'BUY') return 'rec-buy';
  if (rec === 'SELL') return 'rec-sell';
  return 'rec-hold';
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
        <span className="analyst-icon">📊</span>
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
            <span className="analyst-range"> (${data.targetLowPrice.toFixed(2)} – ${data.targetHighPrice.toFixed(2)})</span>
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
        {showCalc ? '▾' : '▸'} 💰 What-If Calculator
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
        {showLinks ? '▾' : '▸'} 🔗 Reddit Discussions
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
        <div className="historic-label">📊 3-Month History</div>
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
        <span className="historic-label">📊 3-Month History</span>
        <span className="historic-change" style={{ color: changeColor }}>
          {changeSign}{histData.change3mo?.toFixed(1)}%
        </span>
      </div>
      <div className="historic-prices-range">
        <span>${histData.startPrice?.toFixed(2)}</span>
        <span className="historic-arrow">→</span>
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

// ── Alert Card (updated with all new features) ──
function AlertCard({ alert, index, sectionPrefix, watchlist, onToggleWatchlist }) {
  const latest = alert.prices[alert.prices.length - 1];
  const pct = latest?.pct_change || 0;
  const perfStatus = getStatus(pct);
  const isNew = alert.status === 'new';
  const isDropped = alert.status === 'dropped';
  const isWatched = watchlist.includes(alert.ticker);

  // Format the alert date nicely
  const alertDateObj = new Date(alert.alert_date + 'T00:00:00');
  const alertDateFormatted = alertDateObj.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });

  return (
    <div className={`card ${perfStatus}${isNew ? ' card-new' : ''}${isDropped ? ' card-dropped' : ''}${isWatched ? ' card-watched' : ''}`}>
      <div className="card-top">
        <div>
          <div className="ticker">
            {alert.ticker}
            {isNew && <span className="new-badge">🆕 NEW</span>}
            {isDropped && <span className="dropped-badge">📦 DROPPED</span>}
          </div>
          <div className="company">{alert.company}</div>
        </div>
        <div className="card-top-right">
          <button
            className={`watchlist-btn ${isWatched ? 'watched' : ''}`}
            onClick={() => onToggleWatchlist(alert.ticker)}
            title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            {isWatched ? '★' : '☆'}
          </button>
          <span className={`status-badge badge-${perfStatus}`}>{statusLabel(pct)}</span>
        </div>
      </div>

      {/* ═══ PROMINENT ALERT DATE & PRICE ═══ */}
      <div className="alert-date-banner">
        <div className="alert-date-item">
          <span className="alert-date-label">📅 ALERTED</span>
          <span className="alert-date-value">{alertDateFormatted}</span>
        </div>
        <div className="alert-date-item">
          <span className="alert-date-label">💵 PRICE AT ALERT</span>
          <span className="alert-date-value alert-price-highlight">${parseFloat(alert.price_at_alert).toFixed(2)}</span>
        </div>
      </div>

      <div className="price-row">
        <span className="price-alert">${parseFloat(alert.price_at_alert).toFixed(2)}</span>
        <span className="arrow">→</span>
        <span className="price-current">${latest?.price?.toFixed(2) || '—'}</span>
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

      {/* ═══ ANALYST CONSENSUS ═══ */}
      <AnalystBadge ticker={alert.ticker} />

      <div className="alert-reason">{alert.alert_reason}</div>

      {/* ═══ PROFIT/LOSS CALCULATOR ═══ */}
      <ProfitLossCalc priceAtAlert={alert.price_at_alert} latestPrice={latest?.price} />

      {/* ═══ REDDIT DISCUSSIONS ═══ */}
      <RedditLinks ticker={alert.ticker} />

      {/* ═══ RESEARCH LINK ═══ */}
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

  useEffect(() => {
    fetch('/api/distribution-list')
      .then(res => res.json())
      .then(data => { setMembers(data.members || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const addMember = async () => {
    if (!newEmail) return;
    setMessage('');
    try {
      const res = await fetch('/api/distribution-list', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail, name: newName }),
      });
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
      await fetch(`/api/distribution-list?id=${id}`, { method: 'DELETE' });
      setMembers(members.filter(m => m.id !== id));
    } catch { /* silently fail */ }
  };

  return (
    <div className="dist-list-section">
      <p className="section-title">📧 Signal Change Alert List</p>
      <p className="section-hint" style={{ marginLeft: 0 }}>When a stock changes from BUY to SELL (or vice versa), everyone on this list gets notified.</p>

      <div className="dist-list-form">
        <input
          type="email"
          placeholder="Email address"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          className="dist-input"
        />
        <input
          type="text"
          placeholder="Name (optional)"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="dist-input dist-input-name"
        />
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
              <button onClick={() => removeMember(m.id)} className="dist-remove-btn">✕</button>
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

// ══════════════════════════════════════
// ═══ MAIN DASHBOARD ═══
// ══════════════════════════════════════
export default function Dashboard() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [showArchive, setShowArchive] = useState(false);
  const [showDropped, setShowDropped] = useState(false);
  const [showWatchlistOnly, setShowWatchlistOnly] = useState(false);
  const [showDistList, setShowDistList] = useState(false);
  const [watchlist, setWatchlistState] = useState([]);
  const router = useRouter();

  useEffect(() => {
    // Load watchlist from cookies
    setWatchlistState(getWatchlist());

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
  }, [router]);

  const handleToggleWatchlist = useCallback((ticker) => {
    const newList = toggleWatchlist(ticker);
    setWatchlistState([...newList]);
  }, []);

  const getLatestPct = useCallback((alert) => {
    const latest = alert.prices[alert.prices.length - 1];
    return latest?.pct_change || 0;
  }, []);

  const sortByPerf = (list) => [...list].sort((a, b) => {
    const pa = getLatestPct(a);
    const pb = getLatestPct(b);
    const sa = getStatus(pa) === 'win' ? 0 : getStatus(pa) === 'neutral' ? 1 : 2;
    const sb = getStatus(pb) === 'win' ? 0 : getStatus(pb) === 'neutral' ? 1 : 2;
    if (sa !== sb) return sa - sb;
    return pb - pa;
  });

  const newPicks = sortByPerf(alerts.filter(a => a.status === 'new'));
  const activePicks = sortByPerf(alerts.filter(a => a.status === 'active'));
  const droppedPicks = sortByPerf(alerts.filter(a => a.status === 'dropped'));

  const applyFilter = (list) => {
    let filtered = filter === 'ALL' ? list : list.filter(a => a.signal_type === filter);
    if (showWatchlistOnly) filtered = filtered.filter(a => watchlist.includes(a.ticker));
    return filtered;
  };

  const filteredNew = applyFilter(newPicks);
  const filteredActive = applyFilter(activePicks);
  const filteredDropped = applyFilter(droppedPicks);

  // Watchlist picks from all sections
  const watchlistPicks = sortByPerf(alerts.filter(a => watchlist.includes(a.ticker)));

  const signalTypes = ['ALL', ...new Set(alerts.map(a => a.signal_type))];

  const currentPicks = [...newPicks, ...activePicks];
  const totalCurrent = currentPicks.length;
  const buys = currentPicks.filter(a => a.recommendation === 'BUY').length;
  const sells = currentPicks.filter(a => a.recommendation === 'SELL').length;
  const wins = currentPicks.filter(a => getStatus(getLatestPct(a)) === 'win').length;
  const avgPct = currentPicks.length > 0
    ? (currentPicks.reduce((sum, a) => sum + getLatestPct(a), 0) / currentPicks.length) : 0;

  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

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
        <h1>📈 Social Stock <span>Intelligence Monitor</span></h1>
        <div className="subtitle">Last updated: {dateStr} · Auto-scan complete</div>
      </header>

      {/* STATS BAR */}
      <div className="stats-bar">
        <div className="stat-card">
          <div className="stat-value">{totalCurrent}</div>
          <div className="stat-label">Current Picks</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#00e5ff' }}>{newPicks.length}</div>
          <div className="stat-label">🆕 New Today</div>
        </div>
        <div className="stat-card stat-buy-glow">
          <div className="stat-value" style={{ color: '#22c55e' }}>{buys}</div>
          <div className="stat-label">🟢 AI Says BUY</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#ef4444' }}>{sells}</div>
          <div className="stat-label">🔴 AI Says SELL</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: avgPct >= 0 ? '#22c55e' : '#ef4444' }}>
            {fmtPct(avgPct)}
          </div>
          <div className="stat-label">Avg Return</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#fbbf24' }}>{watchlist.length}</div>
          <div className="stat-label">⭐ Watchlist</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#7a9bc0' }}>{droppedPicks.length}</div>
          <div className="stat-label">📦 Dropped</div>
        </div>
      </div>

      {/* SOURCES */}
      <p className="section-title">📡 Signal Sources</p>
      <div className="sources-row">
        <span className="source-badge src-wsb">🟠 WallStreetBets</span>
        <span className="source-badge src-reddit">🔴 Reddit (r/stocks, r/investing, r/options, r/StockMarket)</span>
        <span className="source-badge src-poly">🔵 Polymarket</span>
        <span className="source-badge src-yahoo">🟣 Yahoo Finance</span>
        <span className="source-badge src-google">🟢 Google Finance</span>
        <span className="source-badge src-st">🔴 StockTwits</span>
      </div>

      {/* FILTER BAR */}
      <div className="filter-bar" style={{ marginTop: 24 }}>
        {signalTypes.map(type => (
          <button
            key={type}
            className={`filter-btn ${filter === type ? 'active' : ''}`}
            onClick={() => setFilter(type)}
          >
            {type}
          </button>
        ))}
        <button
          className={`filter-btn watchlist-filter ${showWatchlistOnly ? 'active' : ''}`}
          onClick={() => setShowWatchlistOnly(!showWatchlistOnly)}
        >
          ⭐ Watchlist Only
        </button>
      </div>

      {/* ═══ WATCHLIST SECTION ═══ */}
      {watchlistPicks.length > 0 && !showWatchlistOnly && (
        <>
          <p className="section-title section-watchlist">⭐ Your Watchlist</p>
          <p className="section-hint">Stocks you&apos;re personally tracking. Click the star on any card to add/remove.</p>
          <div className="cards-grid">
            {watchlistPicks.map((alert, idx) => (
              <AlertCard key={alert.id || idx} alert={alert} index={idx} sectionPrefix="watch" watchlist={watchlist} onToggleWatchlist={handleToggleWatchlist} />
            ))}
          </div>
        </>
      )}

      {/* ═══ NEW PICKS SECTION ═══ */}
      {filteredNew.length > 0 && (
        <>
          <p className="section-title section-new">🆕 New Picks Today — Fresh Signals</p>
          <p className="section-hint">These stocks just appeared on the radar today. Worth investigating before they move.</p>
          <div className="cards-grid">
            {filteredNew.map((alert, idx) => (
              <AlertCard key={alert.id || idx} alert={alert} index={idx} sectionPrefix="new" watchlist={watchlist} onToggleWatchlist={handleToggleWatchlist} />
            ))}
          </div>
        </>
      )}

      {/* ═══ ACTIVE PICKS SECTION ═══ */}
      <p className="section-title">🔥 Active Picks — Performance Scoreboard</p>
      <p className="section-hint">These are your current picks still being tracked. The ones to watch and consider investing in.</p>
      <div className="cards-grid">
        {filteredActive.length > 0 ? filteredActive.map((alert, idx) => (
          <AlertCard key={alert.id || idx} alert={alert} index={idx} sectionPrefix="active" watchlist={watchlist} onToggleWatchlist={handleToggleWatchlist} />
        )) : (
          <p style={{ color: '#4a6a85', padding: '20px 0', fontSize: '0.9rem' }}>No active picks match this filter.</p>
        )}
      </div>

      {/* ═══ DROPPED PICKS SECTION ═══ */}
      {droppedPicks.length > 0 && (
        <div className="dropped-section">
          <p className="section-title section-dropped" style={{ marginLeft: 0 }}>📦 Dropped Picks — No Longer Recommended</p>
          <p className="section-hint" style={{ marginLeft: 0 }}>These stocks were previously tracked but the signal has faded.</p>
          <button className="archive-toggle-btn" onClick={() => setShowDropped(!showDropped)}>
            📦 {showDropped ? 'Hide' : 'Show'} Dropped Picks ({droppedPicks.length})
          </button>
          {showDropped && (
            <div className="cards-grid" style={{ padding: 0 }}>
              {filteredDropped.map((alert, idx) => (
                <AlertCard key={alert.id || idx} alert={alert} index={idx} sectionPrefix="dropped" watchlist={watchlist} onToggleWatchlist={handleToggleWatchlist} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ FULL ARCHIVE TABLE ═══ */}
      <div className="archive-section">
        <p className="section-title" style={{ marginLeft: 0 }}>📅 Full Archive — All Historical Picks</p>
        <button className="archive-toggle-btn" onClick={() => setShowArchive(!showArchive)}>
          📂 {showArchive ? 'Hide' : 'Show'} Archive ({alerts.length} total)
        </button>
        {showArchive && (
          <div className="archive-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>⭐</th>
                  <th>Pick Status</th>
                  <th>Date Alerted</th>
                  <th>Ticker</th>
                  <th>Company</th>
                  <th>Signal Type</th>
                  <th>Alert Reason</th>
                  <th>Price at Alert</th>
                  <th>Latest Price</th>
                  <th>% Change</th>
                  <th>AI Rec</th>
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
                    const pickLabel = pickStatus === 'new' ? '🆕 NEW' : pickStatus === 'dropped' ? '📦 DROPPED' : '🟢 ACTIVE';
                    const isWatched = watchlist.includes(alert.ticker);
                    return (
                      <tr key={alert.id || idx} className={pickStatus === 'dropped' ? 'row-dropped' : ''}>
                        <td>
                          <button
                            className={`watchlist-btn-sm ${isWatched ? 'watched' : ''}`}
                            onClick={() => handleToggleWatchlist(alert.ticker)}
                          >
                            {isWatched ? '★' : '☆'}
                          </button>
                        </td>
                        <td><span className={`pick-status-chip pick-${pickStatus}`}>{pickLabel}</span></td>
                        <td className="tbl-alert-date">{alert.alert_date}</td>
                        <td className="tbl-ticker">{alert.ticker}</td>
                        <td style={{ color: '#a0b8d0' }}>{alert.company}</td>
                        <td><span className="signal-chip">{alert.signal_type}</span></td>
                        <td style={{ maxWidth: 260, color: '#7a9bc0', fontSize: '0.73rem' }}>{alert.alert_reason}</td>
                        <td className="tbl-alert-price">${parseFloat(alert.price_at_alert).toFixed(2)}</td>
                        <td>${latest?.price?.toFixed(2) || '—'}</td>
                        <td className={`tbl-${perfStatus}`}>{fmtPct(pct)}</td>
                        <td><span className={`rec-chip ${recClass(alert.recommendation || 'HOLD')}`}>{recLabel(alert.recommendation || 'HOLD')}</span></td>
                        <td className={`tbl-${perfStatus}`}>{statusLabel(pct)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ═══ DISTRIBUTION LIST ═══ */}
      <div className="archive-section">
        <button className="archive-toggle-btn" onClick={() => setShowDistList(!showDistList)}>
          📧 {showDistList ? 'Hide' : 'Manage'} Signal Change Alert List
        </button>
        {showDistList && <DistributionListManager />}
      </div>

      <footer>
        ⚡ Auto-updated daily at 9am &nbsp;|&nbsp; Powered by <span>Social Stock Intelligence Monitor</span> &nbsp;|&nbsp; Sources: <span>WSB · Reddit · Polymarket · Yahoo Finance · Google Finance · StockTwits</span>
        <div className="disclaimer">⚠️ AI recommendations are based on momentum, timing &amp; price action analysis. This is NOT financial advice. Always do your own research before investing.</div>
      </footer>
    </>
  );
}
