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
  if (s === 'win') return '\u2705 WIN';
  if (s === 'loss') return '\u274c LOSS';
  return '\u26a0\ufe0f NEUTRAL';
}

function pctClass(pct) {
  if (pct > 0) return 'pct-pos';
  if (pct < 0) return 'pct-neg';
  return 'pct-flat';
}

function fmtPct(pct) {
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
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

function AlertCard({ alert, index }) {
  const latest = alert.prices[alert.prices.length - 1];
  const pct = latest?.pct_change || 0;
  const status = getStatus(pct);

  return (
    <div className={`card ${status}`}>
      <div className="card-top">
        <div>
          <div className="ticker">{alert.ticker}</div>
          <div className="company">{alert.company}</div>
        </div>
        <span className={`status-badge badge-${status}`}>{statusLabel(pct)}</span>
      </div>
      <div className="price-row">
        <span className="price-alert">${parseFloat(alert.price_at_alert).toFixed(2)}</span>
        <span className="arrow">\u2192</span>
        <span className="price-current">${latest?.price?.toFixed(2) || '\u2014'}</span>
        <span className={`pct-change ${pctClass(pct)}`}>{fmtPct(pct)}</span>
      </div>
      <div className="meta-row">
        <span className="meta-tag">{alert.signal_type}</span>
        <span style={{ color: '#4a6a85', fontSize: '0.72rem' }}>\ud83d\udcc5 Alerted {alert.alert_date}</span>
      </div>
      <SparklineChart prices={alert.prices} canvasId={`spark-${index}`} />
      <div className="alert-reason">{alert.alert_reason}</div>
    </div>
  );
}

export default function Dashboard() {
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [showArchive, setShowArchive] = useState(false);
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

  const sorted = [...alerts].sort((a, b) => {
    const pa = getLatestPct(a);
    const pb = getLatestPct(b);
    const sa = getStatus(pa) === 'win' ? 0 : getStatus(pa) === 'neutral' ? 1 : 2;
    const sb = getStatus(pb) === 'win' ? 0 : getStatus(pb) === 'neutral' ? 1 : 2;
    if (sa !== sb) return sa - sb;
    return pb - pa;
  });

  const filtered = filter === 'ALL' ? sorted : sorted.filter(a => a.signal_type === filter);
  const signalTypes = ['ALL', ...new Set(alerts.map(a => a.signal_type))];

  const totalAlerts = alerts.length;
  const wins = alerts.filter(a => getStatus(getLatestPct(a)) === 'win').length;
  const losses = alerts.filter(a => getStatus(getLatestPct(a)) === 'loss').length;
  const avgPct = alerts.length > 0
    ? (alerts.reduce((sum, a) => sum + getLatestPct(a), 0) / alerts.length)
    : 0;

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
        <h1>\ud83d\udcc8 Social Stock <span>Intelligence Monitor</span></h1>
        <div className="subtitle">Last updated: {dateStr} \u00b7 Auto-scan complete</div>
      </header>

      <div className="stats-bar">
        <div className="stat-card">
          <div className="stat-value">{totalAlerts}</div>
          <div className="stat-label">Total Alerts</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#22c55e' }}>{wins}</div>
          <div className="stat-label">Winners (&gt;10%)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: '#ef4444' }}>{losses}</div>
          <div className="stat-label">Losses (&lt;-10%)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value" style={{ color: avgPct >= 0 ? '#22c55e' : '#ef4444' }}>
            {fmtPct(avgPct)}
          </div>
          <div className="stat-label">Avg Return</div>
        </div>
      </div>

      <p className="section-title">\ud83d\udce1 Signal Sources</p>
      <div className="sources-row">
        <span className="source-badge src-wsb">\ud83d\udfe0 WallStreetBets</span>
        <span className="source-badge src-poly">\ud83d\udfe2 Polymarket</span>
        <span className="source-badge src-yahoo">\ud83d\udfe3 Yahoo Finance</span>
        <span className="source-badge src-google">\ud83d\udfe2 Google Finance</span>
        <span className="source-badge src-st">\ud83d\udd34 StockTwits</span>
      </div>

      <p className="section-title">\ud83d\udd25 Active Picks \u2014 Performance Scoreboard</p>
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

      <div className="cards-grid">
        {filtered.map((alert, idx) => (
          <AlertCard key={alert.id || idx} alert={alert} index={idx} />
        ))}
      </div>

      <div className="archive-section">
        <p className="section-title" style={{ marginLeft: 0 }}>\ud83d\udcc5 Archive \u2014 All Historical Picks</p>
        <button className="archive-toggle-btn" onClick={() => setShowArchive(!showArchive)}>
          \ud83d\udcc2 {showArchive ? 'Hide' : 'Show'} Archive
        </button>
        {showArchive && (
          <div className="archive-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date Alerted</th>
                  <th>Ticker</th>
                  <th>Company</th>
                  <th>Signal Type</th>
                  <th>Alert Reason</th>
                  <th>Price at Alert</th>
                  <th>Latest Price</th>
                  <th>% Change</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {[...alerts]
                  .sort((a, b) => b.alert_date.localeCompare(a.alert_date))
                  .map((alert, idx) => {
                    const latest = alert.prices[alert.prices.length - 1];
                    const pct = latest?.pct_change || 0;
                    const status = getStatus(pct);
                    return (
                      <tr key={alert.id || idx}>
                        <td>{alert.alert_date}</td>
                        <td className="tbl-ticker">{alert.ticker}</td>
                        <td style={{ color: '#a0b8d0' }}>{alert.company}</td>
                        <td><span className="signal-chip">{alert.signal_type}</span></td>
                        <td style={{ maxWidth: 260, color: '#7a9bc0', fontSize: '0.73rem' }}>{alert.alert_reason}</td>
                        <td>${parseFloat(alert.price_at_alert).toFixed(2)}</td>
                        <td>${latest?.price?.toFixed(2) || '\u2014'}</td>
                        <td className={`tbl-${status}`}>{fmtPct(pct)}</td>
                        <td className={`tbl-${status}`}>{statusLabel(pct)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <footer>
        \u26a1 Auto-updated daily at 9am &nbsp;|&nbsp; Powered by <span>Social Stock Intelligence Monitor</span> &nbsp;|&nbsp; Sources: <span>WSB \u00b7 Polymarket \u00b7 Yahoo Finance \u00b7 Google Finance \u00b7 StockTwits</span>
      </footer>
    </>
  );
}
