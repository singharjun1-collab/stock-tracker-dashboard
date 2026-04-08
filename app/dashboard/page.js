'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import '../globals.css';

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
          borderWidth: 2,
          pointRadius: 0,
          tension: 0.3,
          fill: true,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
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

function AlertCard({ alert, index, sectionPrefix }) {
  const latest = alert.prices[alert.prices.length - 1];
  const pct = latest?.pct_change || 0;
  const perfStatus = getStatus(pct);
  const isNew = alert.status === 'new';
  const isDropped = alert.status === 'dropped';
  const yahooUrl = `https://finance.yahoo.com/quote/${alert.ticker}/`;

  return (
    <div className={`card ${perfStatus}${isNew ? ' card-new' : ''}${isDropped ? ' card-dropped' : ''}`}>
      <div className="card-top">
        <div>
          <div className="ticker">
            {alert.ticker}
            {isNew && <span className="new-badge">🆕 NEW</span>}
            {isDropped && <span className="dropped-badge">📦 DROPPED</span>}
          </div>
          <div className="company">{alert.company}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <a href={yahooUrl} target="_blank" rel="noopener noreferrer" className="research-link" title="View on Yahoo Finance">🔍 Research</a>
          <span className={`status-badge badge-${perfStatus}`}>{statusLabel(pct)}</span>
        </div>
      </div>
      <div className="price-grid">
        <div className="price-grid-item">
          <div className="price-grid-label">Alert Price</div>
          <div className="price-grid-value">${parseFloat(alert.price_at_alert).toFixed(2)}</div>
          <div className="price-grid-sub">{alert.alert_date}</div>
        </div>
        <div className="price-grid-item">
          <div className="price-grid-label">Latest Price</div>
          <div className="price-grid-value" style={{ color: '#00e5ff' }}>${latest?.price?.toFixed(2) || '—'}</div>
          <div className="price-grid-sub">{latest?.date || '—'}</div>
        </div>
        <div className="price-grid-item">
          <div className="price-grid-label">Return</div>
          <div className={`price-grid-value ${pctClass(pct)}`}>{fmtPct(pct)}</div>
          <div className="price-grid-sub">since alert</div>
        </div>
      </div>
      <div className="meta-row">
        <span className="meta-tag">{alert.signal_type}</span>
        <span style={{ color: '#4a6a85', fontSize: '0.72rem' }}>📅 Alerted {alert.alert_date}</span>
      </div>
      <SparklineChart prices={alert.prices} canvasId={`${sectionPrefix}-spark-${index}`} />
      {alert.recommendation && (
        <div className={`rec-bar ${recClass(alert.recommendation)}`}>
          <span className="rec-label">{recLabel(alert.recommendation)}</span>
          <span className="rec-reason">{alert.recommendation_reason || ''}</span>
        </div>
      )}
      <div className="alert-reason">{alert.alert_reason}</div>
    </div>
  );
}

export default function Dashboard() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [showArchive, setShowArchive] = useState(false);
  const [showDropped, setShowDropped] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/alerts')
      .then(res => {
        if (res.status === 401) {
          router.replace('/');
          return null;
        }
        return res.json();
      })
      .then(data => {
        if (data?.alerts) {
          setAlerts(data.alerts);
        }
        setLoading(false);
      })
      .catch(() => {
        router.replace('/');
      });
  }, [router]);

  const getLatestPct = useCallback((alert) => {
    const latest = alert.prices[alert.prices.length - 1];
    return latest?.pct_change || 0;
  }, []);

  // Sort: wins first, then neutral, then losses
  const sortByPerf = (list) => [...list].sort((a, b) => {
    const pa = getLatestPct(a);
    const pb = getLatestPct(b);
    const sa = getStatus(pa) === 'win' ? 0 : getStatus(pa) === 'neutral' ? 1 : 2;
    const sb = getStatus(pb) === 'win' ? 0 : getStatus(pb) === 'neutral' ? 1 : 2;
    if (sa !== sb) return sa - sb;
    return pb - pa;
  });

  // Split by pick status
  const newPicks = sortByPerf(alerts.filter(a => a.status === 'new'));
  const activePicks = sortByPerf(alerts.filter(a => a.status === 'active'));
  const droppedPicks = sortByPerf(alerts.filter(a => a.status === 'dropped'));

  // Apply signal type filter
  const applyFilter = (list) => filter === 'ALL' ? list : list.filter(a => a.signal_type === filter);

  const filteredNew = applyFilter(newPicks);
  const filteredActive = applyFilter(activePicks);
  const filteredDropped = applyFilter(droppedPicks);

  const signalTypes = ['ALL', ...new Set(alerts.map(a => a.signal_type))];

  // Stats (only for active + new picks — the ones you should be watching)
  const currentPicks = [...newPicks, ...activePicks];
  const totalAlerts = alerts.length;
  const totalCurrent = currentPicks.length;
  const buys = currentPicks.filter(a => a.recommendation === 'BUY').length;
  const sells = currentPicks.filter(a => a.recommendation === 'SELL').length;
  const wins = currentPicks.filter(a => getStatus(getLatestPct(a)) === 'win').length;
  const losses = currentPicks.filter(a => getStatus(getLatestPct(a)) === 'loss').length;
  const avgPct = currentPicks.length > 0
    ? (currentPicks.reduce((sum, a) => sum + getLatestPct(a), 0) / currentPicks.length)
    : 0;

  // Date for header
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
          <div className="stat-value" style={{ color: '#7a9bc0' }}>{droppedPicks.length}</div>
          <div className="stat-label">📦 Dropped</div>
        </div>
      </div>

      {/* SOURCES */}
      <p className="section-title">📡 Signal Sources</p>
      <div className="sources-row">
        <span className="source-badge src-wsb">🟠 WallStreetBets</span>
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
      </div>

      {/* ═══ NEW PICKS SECTION ═══ */}
      {filteredNew.length > 0 && (
        <>
          <p className="section-title section-new">🆕 New Picks Today — Fresh Signals</p>
          <p className="section-hint">These stocks just appeared on the radar today. Worth investigating before they move.</p>
          <div className="cards-grid">
            {filteredNew.map((alert, idx) => (
              <AlertCard key={alert.id || idx} alert={alert} index={idx} sectionPrefix="new" />
            ))}
          </div>
        </>
      )}

      {/* ═══ ACTIVE PICKS SECTION ═══ */}
      <p className="section-title">🔥 Active Picks — Performance Scoreboard</p>
      <p className="section-hint">These are your current picks still being tracked. The ones to watch and consider investing in.</p>
      <div className="cards-grid">
        {filteredActive.length > 0 ? filteredActive.map((alert, idx) => (
          <AlertCard key={alert.id || idx} alert={alert} index={idx} sectionPrefix="active" />
        )) : (
          <p style={{ color: '#4a6a85', padding: '20px 0', fontSize: '0.9rem' }}>No active picks match this filter.</p>
        )}
      </div>

      {/* ═══ DROPPED PICKS SECTION ═══ */}
      {droppedPicks.length > 0 && (
        <div className="dropped-section">
          <p className="section-title section-dropped" style={{ marginLeft: 0 }}>📦 Dropped Picks — No Longer Recommended</p>
          <p className="section-hint" style={{ marginLeft: 0 }}>These stocks were previously tracked but the signal has faded. They stay here for your records.</p>
          <button className="archive-toggle-btn" onClick={() => setShowDropped(!showDropped)}>
            📦 {showDropped ? 'Hide' : 'Show'} Dropped Picks ({droppedPicks.length})
          </button>
          {showDropped && (
            <div className="cards-grid" style={{ padding: 0 }}>
              {filteredDropped.map((alert, idx) => (
                <AlertCard key={alert.id || idx} alert={alert} index={idx} sectionPrefix="dropped" />
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
                    // Sort: new first, then active, then dropped
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
                    return (
                      <tr key={alert.id || idx} className={pickStatus === 'dropped' ? 'row-dropped' : ''}>
                        <td><span className={`pick-status-chip pick-${pickStatus}`}>{pickLabel}</span></td>
                        <td>{alert.alert_date}</td>
                        <td className="tbl-ticker"><a href={`https://finance.yahoo.com/quote/${alert.ticker}/`} target="_blank" rel="noopener noreferrer" style={{ color: '#00e5ff', textDecoration: 'none' }}>{alert.ticker}</a></td>
                        <td style={{ color: '#a0b8d0' }}>{alert.company}</td>
                        <td><span className="signal-chip">{alert.signal_type}</span></td>
                        <td style={{ maxWidth: 260, color: '#7a9bc0', fontSize: '0.73rem' }}>{alert.alert_reason}</td>
                        <td>${parseFloat(alert.price_at_alert).toFixed(2)}</td>
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

      <footer>
        ⚡ Auto-updated daily at 9am &nbsp;|&nbsp; Powered by <span>Social Stock Intelligence Monitor</span> &nbsp;|&nbsp; Sources: <span>WSB · Polymarket · Yahoo Finance · Google Finance · StockTwits</span>
        <div className="disclaimer">⚠️ AI recommendations are based on momentum, timing &amp; price action analysis. This is NOT financial advice. Always do your own research before investing.</div>
      </footer>
    </>
  );
}
