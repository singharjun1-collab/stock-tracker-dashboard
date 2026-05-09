'use client';

// SectorPulseBar
//
// Mobile-first horizontal-scrolling sector overview. Sits between the
// recommendation chip row and the source-health banner. Three layers:
//   1. Sector Pulse cards (horizontal scroll) — quick snapshot per sector
//      with today's % move, sentiment dot, and buzz level.
//   2. Filter chips                            — All / sector1 / sector2 ...
//      tapping a chip filters the cards list to that sector.
//   3. Macro panel                              — appears when a non-All
//      sector is selected. AI-generated 2-line read + sources.
//
// Data sources
//   /api/sector-pulse  → latest pulse row per sector_key
//   /api/ticker-meta   → industry per ticker (used to count cards per sector)
//
// Failure mode
//   If either endpoint errors or returns empty, the bar renders nothing.
//   Existing dashboard cards are completely unaffected.
//
// Feature gate
//   Parent passes `enabled` — when false, the entire component returns null.
//   Used to keep this admin-only during the soft launch.

import { useEffect, useMemo, useState } from 'react';

const TONE_DOT = {
  v_bull:  '#26d07c',
  bull:    '#1d9e75',
  neutral: '#888780',
  mixed:   '#efb045',
  bear:    '#e24b4a',
  v_bear:  '#a32d2d',
};
const TONE_LABEL = {
  v_bull: 'Very bullish',
  bull: 'Bullish',
  neutral: 'Neutral',
  mixed: 'Mixed',
  bear: 'Bearish',
  v_bear: 'Very bearish',
};
const BUZZ_LABEL = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  v_high: 'Very high',
};

function fmtPct(p) {
  if (p === null || p === undefined) return '—';
  const n = Number(p);
  return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
}

export default function SectorPulseBar({ enabled, selected = 'ALL', onSelect, tickerMeta }) {
  const [sectors, setSectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch('/api/sector-pulse', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { if (!cancelled) { setSectors(d.sectors || []); setLoading(false); } })
      .catch(() => { if (!cancelled) { setErrored(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [enabled]);

  // Map { industry → count of active cards } from ticker_meta + alerts.
  // tickerMeta is { TICKER: { industry } } — passed in from the page.
  const cardCounts = useMemo(() => {
    const counts = {};
    if (!tickerMeta) return counts;
    for (const ticker of Object.keys(tickerMeta)) {
      const ind = tickerMeta[ticker]?.industry;
      if (ind) counts[ind] = (counts[ind] || 0) + 1;
    }
    return counts;
  }, [tickerMeta]);

  if (!enabled) return null;
  if (loading) return null;             // show nothing while loading; existing UI is unaffected
  if (errored) return null;             // ditto on error
  if (!sectors.length) return null;     // pre-classification: hide entirely

  // Sort sectors: by pct_today descending so the hottest reads first.
  const sorted = sectors
    .filter((s) => (cardCounts[s.sector_label] || 0) >= 1)  // only show sectors with cards
    .slice()
    .sort((a, b) => (Number(b.pct_today ?? 0) - Number(a.pct_today ?? 0)));

  if (!sorted.length) return null;

  const selectedSector = selected === 'ALL' ? null : sorted.find((s) => s.sector_label === selected);

  return (
    <div className="sector-pulse-wrap">
      {/* Header */}
      <div className="sp-header">
        <div className="sp-header-title">Sector pulse</div>
        <div className="sp-header-sub">AI read across news · Reddit (curated, last 24h)</div>
      </div>

      {/* Pulse row */}
      <div className="sp-row" role="list">
        {sorted.map((s) => {
          const active = selected === s.sector_label;
          const pct = Number(s.pct_today ?? 0);
          return (
            <button
              key={s.sector_key}
              role="listitem"
              className={`sp-card ${active ? 'sp-card-active' : ''}`}
              onClick={() => onSelect?.(active ? 'ALL' : s.sector_label)}
              title={`${s.sector_label} — ${cardCounts[s.sector_label] || 0} card(s)`}
            >
              <div className="sp-card-head">
                <span className="sp-card-name">{s.sector_label}</span>
                <span
                  className="sp-card-dot"
                  style={{ background: TONE_DOT[s.sentiment_label] || TONE_DOT.neutral }}
                  title={TONE_LABEL[s.sentiment_label] || 'Sentiment unknown'}
                />
              </div>
              <div
                className="sp-card-pct"
                style={{ color: pct >= 0 ? '#26d07c' : '#e24b4a' }}
              >{fmtPct(s.pct_today)}</div>
              <div className="sp-card-meta">
                Buzz · {BUZZ_LABEL[s.buzz_label] || '—'} · {cardCounts[s.sector_label] || 0} card{(cardCounts[s.sector_label] || 0) === 1 ? '' : 's'}
              </div>
            </button>
          );
        })}
      </div>

      {/* Filter chips: All + sector chips */}
      <div className="sp-chips" role="tablist">
        <button
          role="tab"
          className={`sp-chip ${selected === 'ALL' ? 'sp-chip-active' : ''}`}
          onClick={() => onSelect?.('ALL')}
        >All</button>
        {sorted.map((s) => (
          <button
            key={s.sector_key}
            role="tab"
            className={`sp-chip ${selected === s.sector_label ? 'sp-chip-active' : ''}`}
            onClick={() => onSelect?.(s.sector_label)}
          >{s.sector_label}</button>
        ))}
      </div>

      {/* Macro panel — only when a sector is picked */}
      {selectedSector && (
        <div className="sp-macro">
          <div className="sp-macro-head">
            <span className="sp-macro-dot" style={{ background: TONE_DOT[selectedSector.sentiment_label] || TONE_DOT.neutral }} />
            <span className="sp-macro-title">{selectedSector.sector_label} — AI macro read</span>
            <span
              className="sp-macro-pct"
              style={{ color: Number(selectedSector.pct_today ?? 0) >= 0 ? '#26d07c' : '#e24b4a' }}
            >{fmtPct(selectedSector.pct_today)}</span>
          </div>
          <div className="sp-macro-summary">{selectedSector.summary}</div>
          <div className="sp-macro-stats">
            <div className="sp-macro-stat">
              <span className="sp-macro-stat-label">News</span>
              <span className="sp-macro-stat-value">{selectedSector.news_count} item{selectedSector.news_count === 1 ? '' : 's'}</span>
            </div>
            <div className="sp-macro-stat">
              <span className="sp-macro-stat-label">Social buzz</span>
              <span className="sp-macro-stat-value">{BUZZ_LABEL[selectedSector.buzz_label] || '—'}</span>
            </div>
            <div className="sp-macro-stat">
              <span className="sp-macro-stat-label">7d avg</span>
              <span
                className="sp-macro-stat-value"
                style={{ color: Number(selectedSector.pct_7d ?? 0) >= 0 ? '#26d07c' : '#e24b4a' }}
              >{fmtPct(selectedSector.pct_7d)}</span>
            </div>
          </div>
          {selectedSector.ai_model && selectedSector.ai_model !== 'fallback' && (
            <div className="sp-macro-foot">Generated by {selectedSector.ai_model.replace('claude-', 'Claude ').replace(/-\d{8}$/, '')} · {new Date(selectedSector.generated_at).toLocaleString()}</div>
          )}
        </div>
      )}
    </div>
  );
}
