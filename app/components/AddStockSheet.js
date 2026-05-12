'use client';

// AddStockSheet
//
// Unified bottom-sheet for finding/adding/tracking a stock.
// Used from:
//   1. The + FAB in the bottom nav  (empty state — global discovery + add)
//   2. The "+ Track this stock" button on each AlertCard
//                                    (prefilled with that ticker + its AI data)
//   3. A row in the "My Stocks" list (jump straight to that ticker)
//
// Three sections in search results:
//   - In your stocks         (already tracked — jump to it)
//   - AI flagging today      (in today's stock_alerts — show AI rec)
//   - Add new                (any ticker not in either — adds in "monitor mode")
//
// Two primary actions per stock:
//   - Add to Watchlist  → POST /api/watchlist
//   - Log a Position    → POST /api/paper-trades  (with optional alert_id reference)
//
// All styles are namespaced with .as- to avoid colliding with the rest of the
// dashboard's CSS. We render a <style> block inline so this component is fully
// self-contained — drop it in, render it, it just works.

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';

const TICKER_RE = /^[A-Z0-9.\-]{1,12}$/;

export default function AddStockSheet({
  isOpen,
  onClose,
  // Optional prefill — when opened from a card's "+ Track" button
  prefillTicker = null,
  prefillCompany = null,
  prefillAlert = null,           // full stock_alerts row, used to snapshot AI data on add
  // Data the parent already has (avoid duplicate fetches)
  watchlist = [],                // current user's watchlist rows
  activeAlerts = [],             // today's active stock_alerts (any subset is fine)
  // Callbacks
  onAdded,                       // called after successful add (parent refreshes)
  onPositionLogged,              // called after position created
}) {
  const [query, setQuery] = useState('');
  const [selectedTicker, setSelectedTicker] = useState(null);
  const [selectedAlert, setSelectedAlert] = useState(null);  // the AI alert object for the selected ticker (or null)
  // Which sub-screen is showing after a ticker is selected:
  //   'choice'        — Watch vs I-own-shares choice cards (default)
  //   'log-position'  — Robinhood-style shares + avg cost form with live preview
  // Replaces the old `showPositionForm` boolean. Updated 2026-05-12 in the
  // Add-to-Portfolio redesign — see PR feat/add-to-portfolio-redesign.
  const [screen, setScreen] = useState('choice');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState(null);            // {type:'success'|'error', message}
  const inputRef = useRef(null);
  const sheetRef = useRef(null);

  // Position form fields — new Robinhood-style model:
  //   shares     — integer count via +/- stepper (default 1)
  //   entryPrice — avg cost per share (default = AI entry_low or current price)
  //   notes      — optional free text
  // On submit we compute entry_amount = shares × entryPrice and POST that to
  // /api/paper-trades to preserve the existing API contract.
  const [shares, setShares] = useState(1);
  const [entryPrice, setEntryPrice] = useState('');
  const [notes, setNotes] = useState('');

  // Focus search on open + reset state on close
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 320);
      // If opened with a prefill, jump straight into the selected view
      if (prefillTicker) {
        const ticker = prefillTicker.toUpperCase();
        setSelectedTicker(ticker);
        setSelectedAlert(prefillAlert || null);
        setEntryPrice(
          prefillAlert?.entry_low != null
            ? String(prefillAlert.entry_low)
            : prefillAlert?.price_at_alert != null
              ? String(prefillAlert.price_at_alert)
              : ''
        );
      }
    } else {
      // Reset state when closed
      setQuery('');
      setSelectedTicker(null);
      setSelectedAlert(null);
      setScreen('choice');
      setBusy(false);
      setFeedback(null);
      setShares(1);
      setEntryPrice('');
      setNotes('');
    }
  }, [isOpen, prefillTicker, prefillAlert]);

  // Lock body scroll while open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Set of tickers currently in user's watchlist (for fast lookup)
  const watchedTickerSet = useMemo(() => {
    const s = new Set();
    (watchlist || []).forEach((w) => s.add((w.ticker || '').toUpperCase()));
    return s;
  }, [watchlist]);

  // Latest alert per ticker — for "AI flagging today" section
  const alertByTicker = useMemo(() => {
    const m = {};
    (activeAlerts || []).forEach((a) => {
      const t = (a.ticker || '').toUpperCase();
      if (!t) return;
      if (!m[t] || new Date(a.alert_date) > new Date(m[t].alert_date)) m[t] = a;
    });
    return m;
  }, [activeAlerts]);

  // Filter logic: as the user types, partition into 3 buckets
  const results = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return null;

    const inYourStocks = (watchlist || [])
      .filter((w) => (w.ticker || '').toUpperCase().includes(q) || (w.company || '').toUpperCase().includes(q))
      .slice(0, 6);

    const yourTickers = new Set(inYourStocks.map((w) => w.ticker.toUpperCase()));

    const aiFlagging = (activeAlerts || [])
      .filter((a) => {
        const t = (a.ticker || '').toUpperCase();
        const c = (a.company || '').toUpperCase();
        return (t.includes(q) || c.includes(q)) && !yourTickers.has(t);
      })
      .slice(0, 8);

    // "Add new" — show only if the typed string looks like a clean ticker and isn't in either above
    const showAddNew =
      TICKER_RE.test(q) &&
      !inYourStocks.some((w) => w.ticker.toUpperCase() === q) &&
      !aiFlagging.some((a) => a.ticker.toUpperCase() === q);

    return { inYourStocks, aiFlagging, addNew: showAddNew ? q : null };
  }, [query, watchlist, activeAlerts]);

  // Selected stock derived view (from selectedAlert, watchlist match, or just the ticker string)
  const selectedView = useMemo(() => {
    if (!selectedTicker) return null;
    const ticker = selectedTicker.toUpperCase();
    const wm = (watchlist || []).find((w) => (w.ticker || '').toUpperCase() === ticker);
    const am = selectedAlert || alertByTicker[ticker] || wm?.current_alert || null;
    const cp = wm?.current_price ?? am?.price_at_alert ?? null;
    const pct = wm?.today_pct ?? null;
    return {
      ticker,
      company: prefillCompany || wm?.company || am?.company || null,
      alert: am,
      currentPrice: cp != null ? parseFloat(cp) : null,
      todayPct: pct != null ? parseFloat(pct) : null,
      alreadyWatching: watchedTickerSet.has(ticker),
    };
  }, [selectedTicker, selectedAlert, watchlist, alertByTicker, watchedTickerSet, prefillCompany]);

  // --- Actions ---

  const pickStock = useCallback((ticker, alert = null, company = null) => {
    const t = (ticker || '').toUpperCase();
    setSelectedTicker(t);
    setSelectedAlert(alert);
    setQuery(t);
    setScreen('choice');
    setShares(1);
    setNotes('');
    setFeedback(null);
    // Prefill avg cost from AI entry_low or the latest price we know about.
    // The user can tap "Use $X" in the log-position screen to swap to the
    // current price if their actual fill was different.
    if (alert?.entry_low != null) setEntryPrice(String(alert.entry_low));
    else if (alert?.price_at_alert != null) setEntryPrice(String(alert.price_at_alert));
    else setEntryPrice('');
  }, []);

  const handleAddToWatchlist = async () => {
    if (!selectedView || busy) return;
    setBusy(true);
    setFeedback(null);

    const alert = selectedView.alert;
    const payload = {
      ticker: selectedView.ticker,
      company: selectedView.company,
      source: prefillAlert ? 'ai_card' : (alert ? 'fab' : 'manual'),
      alert_id: alert?.id || null,
      ai_rec_at_add: alert?.recommendation || null,
      entry_low_at_add: alert?.entry_low ?? null,
      entry_high_at_add: alert?.entry_high ?? null,
      target_low_at_add: alert?.target_low ?? null,
      target_high_at_add: alert?.target_high ?? null,
      stop_loss_at_add: alert?.stop_loss ?? null,
    };

    try {
      const r = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed');
      setFeedback({
        type: 'success',
        message: data.already_watching ? `${selectedView.ticker} is already in your watchlist` : `Added ${selectedView.ticker} to your watchlist`,
      });
      onAdded?.(data.watchlist);
      setTimeout(() => onClose?.(), 900);
    } catch (e) {
      console.error(e);
      setFeedback({ type: 'error', message: 'Could not add to watchlist. Try again?' });
    } finally {
      setBusy(false);
    }
  };

  // Remove from watchlist (called when user taps the new "Remove" button on
  // the selected stock panel). DELETEs the row server-side, then bubbles up
  // via onAdded() so the parent dashboard refreshes its watchlist state.
  const handleRemoveFromWatchlist = async () => {
    if (!selectedView || busy) return;
    setBusy(true);
    setFeedback(null);
    try {
      const r = await fetch(`/api/watchlist?ticker=${encodeURIComponent(selectedView.ticker)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!r.ok) throw new Error('Failed');
      setFeedback({ type: 'success', message: `Removed ${selectedView.ticker} from your watchlist` });
      onAdded?.(); // parent refreshes watchlist
      setTimeout(() => onClose?.(), 900);
    } catch (e) {
      console.error(e);
      setFeedback({ type: 'error', message: 'Could not remove. Try again?' });
    } finally {
      setBusy(false);
    }
  };

  const handleLogPosition = async () => {
    if (!selectedView || busy) return;
    const price = parseFloat(entryPrice);
    const shareCount = parseInt(shares, 10);
    if (!Number.isFinite(price) || price <= 0) {
      setFeedback({ type: 'error', message: 'Enter a valid average cost' });
      return;
    }
    if (!Number.isFinite(shareCount) || shareCount <= 0) {
      setFeedback({ type: 'error', message: 'Add at least 1 share' });
      return;
    }
    // Convert shares × cost → entry_amount to keep the existing
    // /api/paper-trades contract intact. Server still derives shares = amount/price.
    const amt = shareCount * price;
    setBusy(true);
    setFeedback(null);

    const alert = selectedView.alert;
    const payload = {
      ticker: selectedView.ticker,
      company: selectedView.company,
      alert_id: alert?.id || null,
      entry_price: price,
      entry_amount: amt,
      ai_recommendation_at_entry: alert?.recommendation || null,
      signal_type_at_entry: alert?.signal_type || null,
      notes: notes || null,
      recommendation_reason_at_entry: alert?.recommendation_reason || null,
      alert_reason_at_entry: alert?.alert_reason || null,
      forecast_sell_date_at_entry: alert?.forecast_sell_date || null,
      market_cap_at_entry: alert?.market_cap ?? null,
      source_at_entry: alert?.source || null,
    };

    try {
      const r = await fetch('/api/paper-trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || 'Failed');
      // Also add to watchlist so it shows up in My Stocks lists with both states
      try {
        await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            ticker: selectedView.ticker,
            company: selectedView.company,
            source: 'ai_card',
            alert_id: alert?.id || null,
            ai_rec_at_add: alert?.recommendation || null,
          }),
        });
      } catch { /* non-fatal */ }
      setFeedback({ type: 'success', message: `Logged ${shareCount} ${shareCount === 1 ? 'share' : 'shares'} of ${selectedView.ticker}` });
      onPositionLogged?.(data.trade);
      onAdded?.();
      setTimeout(() => onClose?.(), 1100);
    } catch (e) {
      console.error(e);
      setFeedback({ type: 'error', message: 'Could not log position. Try again?' });
    } finally {
      setBusy(false);
    }
  };

  // Quick-add chips: top AI picks + popular tickers (deduped vs watchlist)
  const quickChips = useMemo(() => {
    const chips = [];
    const seen = new Set();
    (activeAlerts || []).slice(0, 6).forEach((a) => {
      const t = (a.ticker || '').toUpperCase();
      if (t && !seen.has(t) && !watchedTickerSet.has(t)) {
        chips.push({ ticker: t, alert: a });
        seen.add(t);
      }
    });
    // Pad with popular fallbacks
    ['NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMD'].forEach((t) => {
      if (!seen.has(t) && chips.length < 6) {
        chips.push({ ticker: t, alert: null });
        seen.add(t);
      }
    });
    return chips;
  }, [activeAlerts, watchedTickerSet]);

  // Render -----
  return (
    <>
      <div
        className={`as-backdrop ${isOpen ? 'as-open' : ''}`}
        onClick={onClose}
        aria-hidden={!isOpen}
      />
      <div
        className={`as-sheet ${isOpen ? 'as-open' : ''}`}
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label="Add to Portfolio"
      >
        <div className="as-handle-wrap"><div className="as-handle" /></div>

        <div className="as-header">
          <div className="as-title">
            {selectedTicker
              ? <>Add <span className="as-title-ticker">{selectedTicker}</span> to Portfolio</>
              : 'Add to Portfolio'}
            <span className="as-subtitle">
              {selectedTicker
                ? 'Watch the AI signals or log a position you own'
                : 'Pick a stock to watch or log a position you own'}
            </span>
          </div>
          <button className="as-close" onClick={onClose}>Cancel</button>
        </div>

        {/* Search input — only shown when no stock is selected yet. Once a
            ticker is picked (via prefill from a card's "+ Add to My Stocks"
            button, or via tapping a result here), the search collapses
            away and the modal focuses purely on the two action buttons.
            The user can still swap tickers via the "Change" link in the
            selected-view panel. Updated 2026-05-12. */}
        {!selectedTicker && (
          <div className="as-search">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              inputMode="search"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck="false"
              placeholder="Pick a ticker to track…"
              value={query}
              onChange={(e) => {
                const v = e.target.value;
                setQuery(v);
                // If user clears the field, deselect
                if (!v.trim()) {
                  setSelectedTicker(null);
                  setSelectedAlert(null);
                }
              }}
            />
            {query && (
              <button className="as-clear" onClick={() => { setQuery(''); setSelectedTicker(null); }} aria-label="Clear">×</button>
            )}
          </div>
        )}

        <div className="as-body">
          {feedback && (
            <div className={`as-feedback as-feedback-${feedback.type}`}>
              {feedback.type === 'success' ? '✓' : '!'} {feedback.message}
            </div>
          )}

          {selectedView ? (
            <SelectedStockPanel
              view={selectedView}
              screen={screen}
              onGoToLogPosition={() => { setScreen('log-position'); setFeedback(null); }}
              onBackToChoice={() => { setScreen('choice'); setFeedback(null); }}
              shares={shares} setShares={setShares}
              entryPrice={entryPrice} setEntryPrice={setEntryPrice}
              notes={notes} setNotes={setNotes}
              busy={busy}
              onAddToWatchlist={handleAddToWatchlist}
              onRemoveFromWatchlist={handleRemoveFromWatchlist}
              onLogPosition={handleLogPosition}
              onChangeTicker={() => {
                // Restore the search bar + clear the selected stock. Lets
                // the user swap to a different ticker without closing the
                // sheet entirely.
                setSelectedTicker(null);
                setSelectedAlert(null);
                setScreen('choice');
                setQuery('');
                setEntryPrice('');
                setShares(1);
                setNotes('');
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
            />
          ) : results ? (
            <SearchResults
              results={results}
              alertByTicker={alertByTicker}
              onPickWatched={(w) => pickStock(w.ticker, w.current_alert, w.company)}
              onPickAlert={(a) => pickStock(a.ticker, a, a.company)}
              onPickNew={(t) => pickStock(t, null, null)}
            />
          ) : (
            <EmptyState
              quickChips={quickChips}
              recentWatched={(watchlist || []).slice(0, 4)}
              onPickChip={(c) => pickStock(c.ticker, c.alert, c.alert?.company)}
              onPickWatched={(w) => pickStock(w.ticker, w.current_alert, w.company)}
            />
          )}
        </div>
      </div>

      <style>{`
        .as-backdrop {
          position: fixed; inset: 0;
          background: rgba(0, 0, 0, 0.55);
          backdrop-filter: blur(4px);
          -webkit-backdrop-filter: blur(4px);
          z-index: 9000;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.28s ease;
        }
        .as-backdrop.as-open { opacity: 1; pointer-events: auto; }

        .as-sheet {
          position: fixed;
          left: 0; right: 0; bottom: 0;
          background: #131923;
          border-radius: 24px 24px 0 0;
          z-index: 9001;
          transform: translateY(100%);
          transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1);
          max-height: 92vh;
          display: flex;
          flex-direction: column;
          box-shadow: 0 -10px 40px rgba(0,0,0,0.4);
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }
        .as-sheet.as-open { transform: translateY(0); }

        .as-handle-wrap { padding: 10px 0 4px; display: grid; place-items: center; flex-shrink: 0; }
        .as-handle { width: 38px; height: 4px; background: #2a3447; border-radius: 2px; }

        .as-header {
          padding: 4px 20px 12px;
          display: flex; align-items: flex-start; justify-content: space-between;
          flex-shrink: 0;
          gap: 12px;
        }
        .as-title {
          font-size: 17px; font-weight: 700; color: #e8ecf3;
          display: flex; flex-direction: column; gap: 2px;
        }
        .as-subtitle {
          font-size: 12px; font-weight: 500; color: #7a9bc0;
          letter-spacing: 0;
        }
        .as-title-ticker {
          display: inline-block;
          padding: 2px 8px;
          margin: 0 2px;
          background: rgba(10, 132, 255, 0.15);
          color: #4fa3ff;
          border-radius: 6px;
          font-weight: 700;
          letter-spacing: 0.02em;
          font-size: 15px;
          vertical-align: 1px;
        }
        .as-change-ticker {
          margin: 4px 20px 12px;
          padding: 6px 10px;
          background: transparent;
          border: none;
          color: #7a9bc0;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          align-self: flex-start;
          font-family: inherit;
          border-radius: 8px;
          transition: background 0.15s, color 0.15s;
        }
        .as-change-ticker:hover,
        .as-change-ticker:active {
          background: rgba(122, 155, 192, 0.08);
          color: #cfe2ff;
        }
        .as-close {
          background: none; border: none;
          color: #8b95a8; font-size: 14px; font-weight: 600;
          cursor: pointer; padding: 6px 8px;
          font-family: inherit;
        }
        .as-close:active { color: #e8ecf3; }

        .as-search {
          margin: 0 20px 12px;
          padding: 12px 14px;
          background: #1a2230;
          border-radius: 12px;
          display: flex; align-items: center; gap: 10px;
          flex-shrink: 0;
          border: 1px solid transparent;
          transition: border-color 0.15s;
        }
        .as-search:focus-within { border-color: #0a84ff; }
        .as-search svg { color: #8b95a8; flex-shrink: 0; }
        .as-search input {
          background: transparent; border: none; outline: none;
          color: #e8ecf3; font-size: 15px; flex: 1; font-family: inherit;
          min-width: 0;
        }
        .as-search input::placeholder { color: #5a6478; }
        .as-clear {
          background: #2a3447; border: none; color: #e8ecf3;
          width: 22px; height: 22px; border-radius: 50%;
          font-size: 14px; cursor: pointer; padding: 0;
          display: grid; place-items: center; line-height: 1;
        }

        .as-body {
          flex: 1;
          overflow-y: auto;
          padding: 0 20px 24px;
          -webkit-overflow-scrolling: touch;
        }
        .as-body::-webkit-scrollbar { display: none; }

        .as-section-label {
          font-size: 11px;
          color: #5a6478;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          margin: 14px 0 8px;
          font-weight: 700;
        }
        .as-section-label:first-child { margin-top: 4px; }

        .as-chips { display: flex; flex-wrap: wrap; gap: 8px; }
        .as-chip {
          padding: 8px 14px;
          background: #1a2230;
          border-radius: 999px;
          font-size: 13px; font-weight: 600; color: #e8ecf3;
          cursor: pointer; border: 1px solid #2a3447;
          font-family: inherit;
        }
        .as-chip:active { background: #232d3e; }
        .as-chip-ai {
          background: rgba(175, 82, 222, 0.12);
          border-color: rgba(175, 82, 222, 0.3);
          color: #d4a5f0;
        }

        .as-result {
          padding: 12px 14px;
          background: #1a2230;
          border-radius: 14px;
          display: flex; align-items: center; gap: 12px;
          margin-bottom: 8px;
          cursor: pointer;
          border: 1px solid transparent;
          transition: border-color 0.15s, background 0.15s;
          font-family: inherit;
          width: 100%;
          text-align: left;
        }
        .as-result:active { border-color: #0a84ff; background: #232d3e; }

        .as-logo {
          width: 36px; height: 36px; border-radius: 10px;
          background: #232d3e; display: grid; place-items: center;
          font-weight: 700; font-size: 12px; color: #e8ecf3;
          flex-shrink: 0;
        }
        .as-result-meta { flex: 1; min-width: 0; }
        .as-result-row { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 700; color: #e8ecf3; }
        .as-result-sub { font-size: 11px; color: #8b95a8; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .as-result-right { text-align: right; flex-shrink: 0; }
        .as-result-price { font-size: 14px; font-weight: 700; color: #e8ecf3; }
        .as-result-pct { font-size: 11px; font-weight: 600; margin-top: 2px; }
        .as-result-pct.up { color: #00c853; }
        .as-result-pct.down { color: #ff3b30; }

        .as-rec-pill {
          font-size: 8px; font-weight: 800;
          padding: 2px 6px; border-radius: 4px;
          letter-spacing: 0.4px;
        }
        .as-rec-pill.buy { background: rgba(0,200,83,0.15); color: #00c853; }
        .as-rec-pill.hold { background: rgba(255,184,0,0.15); color: #ffb800; }
        .as-rec-pill.trim { background: rgba(255,149,0,0.15); color: #ff9500; }
        .as-rec-pill.sell, .as-rec-pill.exit { background: rgba(255,59,48,0.15); color: #ff3b30; }
        .as-rec-pill.watching { background: #232d3e; color: #8b95a8; }

        .as-add-new {
          padding: 14px;
          background: linear-gradient(135deg, rgba(10,132,255,0.1) 0%, #1a2230 60%);
          border: 1px dashed rgba(10,132,255,0.4);
          border-radius: 14px;
          display: flex; align-items: center; gap: 12px;
          cursor: pointer;
          font-family: inherit;
          width: 100%;
          text-align: left;
        }
        .as-add-new:active { background: rgba(10,132,255,0.18); }
        .as-add-new-icon {
          width: 36px; height: 36px; border-radius: 10px;
          background: #0a84ff; color: white;
          display: grid; place-items: center;
          font-size: 18px; font-weight: 700;
          flex-shrink: 0;
        }

        .as-feedback {
          margin: 4px 0 12px;
          padding: 10px 14px;
          border-radius: 10px;
          font-size: 13px;
          font-weight: 600;
        }
        .as-feedback-success { background: rgba(0,200,83,0.12); color: #00c853; }
        .as-feedback-error { background: rgba(255,59,48,0.12); color: #ff3b30; }

        /* Selected stock panel */
        .as-selected-card {
          padding: 16px;
          background: linear-gradient(135deg, #1a2230 0%, #131923 100%);
          border: 1px solid #2a3447;
          border-radius: 14px;
          margin-bottom: 14px;
        }
        .as-sel-row { display: flex; align-items: center; gap: 12px; }
        .as-sel-meta { flex: 1; min-width: 0; }
        .as-sel-ticker { font-size: 18px; font-weight: 700; color: #e8ecf3; }
        .as-sel-company { font-size: 12px; color: #8b95a8; margin-top: 2px; }
        .as-sel-right { text-align: right; flex-shrink: 0; }
        .as-sel-price { font-size: 18px; font-weight: 700; color: #e8ecf3; }
        .as-sel-pct { font-size: 12px; font-weight: 600; margin-top: 2px; }
        .as-sel-pct.up { color: #00c853; }
        .as-sel-pct.down { color: #ff3b30; }

        .as-ai-banner {
          margin-top: 14px;
          padding: 10px 12px;
          background: rgba(175, 82, 222, 0.1);
          border: 1px solid rgba(175, 82, 222, 0.25);
          border-radius: 10px;
          display: flex; align-items: flex-start; gap: 10px;
          font-size: 12px; color: #e8ecf3; line-height: 1.45;
        }
        .as-ai-icon {
          width: 22px; height: 22px; border-radius: 6px;
          background: #af52de; color: white;
          display: grid; place-items: center;
          font-size: 9px; font-weight: 700;
          flex-shrink: 0;
        }
        .as-monitor-banner {
          margin-top: 14px;
          padding: 10px 12px;
          background: rgba(10, 132, 255, 0.08);
          border: 1px solid rgba(10, 132, 255, 0.2);
          border-radius: 10px;
          font-size: 12px;
          color: #8b95a8;
          line-height: 1.45;
        }
        .as-monitor-banner strong { color: #0a84ff; }

        .as-already-watching {
          margin-top: 12px;
          padding: 8px 12px;
          background: rgba(0,200,83,0.08);
          border: 1px solid rgba(0,200,83,0.2);
          border-radius: 10px;
          font-size: 12px;
          color: #00c853;
          font-weight: 600;
          display: flex; align-items: center; gap: 6px;
        }

        /* Tappable "In your watchlist" pill — replaces the static green chip.
           Whole row is a button: tap anywhere to remove. The right-aligned
           "Tap to remove" hint signals that this is an action, not a label. */
        .as-watching-toggle {
          margin-top: 12px;
          padding: 10px 14px;
          background: rgba(0,200,83,0.08);
          border: 1px solid rgba(0,200,83,0.25);
          border-radius: 10px;
          font-size: 12px;
          font-weight: 600;
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px;
          width: 100%;
          cursor: pointer;
          font-family: inherit;
          transition: background 0.15s, border-color 0.15s;
        }
        .as-watching-toggle:active:not(:disabled) {
          background: rgba(255,59,48,0.1);
          border-color: rgba(255,59,48,0.3);
        }
        .as-watching-toggle:disabled { opacity: 0.5; cursor: not-allowed; }
        .as-watching-toggle-check { color: #00c853; }
        .as-watching-toggle-action {
          font-size: 11px;
          color: #8b95a8;
          font-weight: 500;
          letter-spacing: 0.02em;
        }

        /* Destructive primary button — used as the main CTA when the stock
           is already on the watchlist, replacing the disabled "✓ Already
           watching" affordance. Red tone signals removal; matches iOS
           "destructive action" conventions. */
        .as-btn-remove {
          width: 100%;
          padding: 15px;
          background: rgba(255,59,48,0.12);
          color: #ff3b30;
          border: 1px solid rgba(255,59,48,0.3);
          border-radius: 12px;
          font-size: 15px; font-weight: 700;
          cursor: pointer; font-family: inherit;
          display: flex; align-items: center; justify-content: center; gap: 8px;
        }
        .as-btn-remove:active:not(:disabled) {
          background: rgba(255,59,48,0.22);
          border-color: rgba(255,59,48,0.45);
        }
        .as-btn-remove:disabled { opacity: 0.5; cursor: not-allowed; }

        .as-actions { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; }
        .as-btn-primary {
          width: 100%;
          padding: 15px;
          background: #0a84ff;
          color: white;
          border: none;
          border-radius: 12px;
          font-size: 15px; font-weight: 700;
          cursor: pointer; font-family: inherit;
          display: flex; align-items: center; justify-content: center; gap: 8px;
          box-shadow: 0 4px 14px rgba(10,132,255,0.3);
        }
        .as-btn-primary:active:not(:disabled) { background: #0066d6; }
        .as-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }

        .as-btn-secondary {
          width: 100%;
          padding: 13px;
          background: #1a2230;
          color: #e8ecf3;
          border: 1px solid #2a3447;
          border-radius: 12px;
          font-size: 14px; font-weight: 600;
          cursor: pointer; font-family: inherit;
        }
        .as-btn-secondary:active:not(:disabled) { background: #232d3e; }
        .as-btn-secondary:disabled { opacity: 0.5; }

        /* Position form */
        .as-pos-form {
          margin-top: 14px;
          padding-top: 14px;
          border-top: 1px solid #2a3447;
        }
        .as-form-field { margin-bottom: 12px; }
        .as-field-label {
          font-size: 11px; color: #8b95a8;
          margin-bottom: 6px;
          display: flex; align-items: center; gap: 6px;
          letter-spacing: 0.3px;
        }
        .as-ai-pill {
          background: rgba(175,82,222,0.2);
          color: #af52de;
          font-size: 8px; font-weight: 800;
          padding: 1px 5px; border-radius: 4px;
          letter-spacing: 0.4px;
        }
        .as-field-input {
          width: 100%;
          padding: 12px 14px;
          background: #1a2230;
          border: 1px solid #2a3447;
          border-radius: 12px;
          color: #e8ecf3;
          font-size: 15px; font-weight: 600;
          font-family: inherit; outline: none;
          transition: border-color 0.15s;
        }
        .as-field-input:focus { border-color: #0a84ff; }
        .as-field-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .as-amount-presets { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
        .as-preset {
          flex: 1;
          min-width: 60px;
          padding: 8px;
          background: #1a2230;
          border: 1px solid #2a3447;
          border-radius: 8px;
          font-size: 12px; font-weight: 600;
          color: #e8ecf3; cursor: pointer;
          text-align: center;
          font-family: inherit;
        }
        .as-preset:active { background: #232d3e; }
        .as-preset.selected { background: #0a84ff; border-color: #0a84ff; color: white; }

        .as-calc {
          padding: 12px 14px;
          background: rgba(10,132,255,0.08);
          border: 1px solid rgba(10,132,255,0.2);
          border-radius: 10px;
          font-size: 12px; color: #8b95a8;
          margin: 12px 0;
        }
        .as-calc strong { color: #e8ecf3; font-weight: 700; font-size: 13px; }

        /* ── Add-to-Portfolio redesign (2026-05-12) ─────────────────────
           New compact stock strip + two-card choice + log-position form
           with live P&L preview. Replaces the old as-selected-card +
           inline form pattern.
           ─────────────────────────────────────────────────────────────── */

        .as-stock-strip {
          padding: 12px 14px;
          background: #1a2230;
          border: 1px solid #2a3447;
          border-radius: 14px;
          margin-bottom: 14px;
        }
        .as-stock-strip-top {
          display: flex; align-items: center; justify-content: space-between;
          gap: 10px;
        }
        .as-stock-strip-meta { flex: 1; min-width: 0; }
        .as-stock-strip-company {
          font-size: 13px; font-weight: 700; color: #e8ecf3;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .as-stock-strip-ticker {
          font-size: 10px; color: #8b95a8;
          letter-spacing: 0.4px; margin-top: 1px; font-weight: 600;
        }
        .as-stock-strip-right { text-align: right; flex-shrink: 0; }
        .as-stock-strip-price { font-size: 17px; font-weight: 700; color: #e8ecf3; }
        .as-stock-strip-pct { font-size: 11px; font-weight: 600; margin-top: 1px; }
        .as-stock-strip-pct.up { color: #00c853; }
        .as-stock-strip-pct.down { color: #ff3b30; }

        .as-stock-strip-ai {
          margin-top: 8px; padding-top: 8px;
          border-top: 1px solid rgba(255,255,255,0.06);
          display: flex; align-items: center; gap: 8px;
          flex-wrap: wrap;
        }
        .as-ai-tag {
          font-size: 9px; font-weight: 800;
          padding: 3px 7px; border-radius: 5px;
          letter-spacing: 0.5px; flex-shrink: 0;
        }
        .as-ai-tag.buy { background: rgba(0,200,83,0.18); color: #00c853; }
        .as-ai-tag.hold { background: rgba(255,184,0,0.18); color: #ffb800; }
        .as-ai-tag.trim { background: rgba(255,149,0,0.18); color: #ff9500; }
        .as-ai-tag.sell, .as-ai-tag.exit { background: rgba(255,59,48,0.18); color: #ff3b30; }
        .as-ai-tag.watching { background: #2a3447; color: #8b95a8; }

        .as-stock-strip-ai-text {
          font-size: 11px; color: #b8c4d6; line-height: 1.35;
          min-width: 0; flex: 1;
        }
        .as-stock-strip-monitor {
          margin-top: 8px; padding-top: 8px;
          border-top: 1px solid rgba(255,255,255,0.06);
          font-size: 11px; color: #8b95a8;
        }

        .as-choose-label {
          font-size: 11px; color: #5a6478;
          letter-spacing: 0.5px; text-transform: uppercase;
          margin: 6px 0 10px;
          font-weight: 700;
        }

        .as-choice-card {
          width: 100%;
          padding: 14px;
          background: #1a2230;
          border: 1px solid #2a3447;
          border-radius: 14px;
          display: flex; align-items: center; gap: 12px;
          cursor: pointer;
          font-family: inherit;
          text-align: left;
          margin-bottom: 10px;
          transition: background 0.15s, border-color 0.15s, transform 0.1s;
        }
        .as-choice-card:active:not(:disabled) {
          background: #232d3e;
          transform: scale(0.99);
        }
        .as-choice-card:disabled { opacity: 0.5; cursor: not-allowed; }
        .as-choice-card.is-active { border-color: rgba(0,200,83,0.4); }
        .as-choice-watch.is-active:active:not(:disabled) {
          background: rgba(255,59,48,0.08);
          border-color: rgba(255,59,48,0.4);
        }

        .as-choice-icon {
          width: 36px; height: 36px; border-radius: 10px;
          display: grid; place-items: center;
          flex-shrink: 0;
        }
        .as-choice-icon-watch {
          background: rgba(10,132,255,0.15);
          color: #4fa3ff;
        }
        .as-choice-card.is-active .as-choice-icon-watch {
          background: rgba(0,200,83,0.15);
          color: #00c853;
        }
        .as-choice-icon-own {
          background: rgba(0,200,83,0.15);
          color: #00c853;
        }

        .as-choice-body { flex: 1; min-width: 0; }
        .as-choice-title {
          font-size: 14px; font-weight: 700; color: #e8ecf3;
        }
        .as-choice-sub {
          font-size: 11px; color: #8b95a8;
          margin-top: 3px; line-height: 1.35;
        }
        .as-choice-action {
          background: #0a84ff;
          color: white;
          font-size: 12px; font-weight: 700;
          padding: 7px 14px;
          border-radius: 8px;
          flex-shrink: 0;
        }
        .as-choice-action.is-remove {
          background: rgba(255,59,48,0.12);
          color: #ff3b30;
          border: 1px solid rgba(255,59,48,0.3);
        }
        .as-choice-action-secondary {
          background: transparent;
          color: #e8ecf3;
          border: 1px solid #2a3447;
        }

        .as-choice-footer {
          margin-top: 12px;
          padding: 8px;
          display: flex; align-items: center; justify-content: center; gap: 6px;
          font-size: 11px; color: #5a6478;
        }

        /* ── Log Position screen ────────────────────────────────────── */

        .as-field-block { margin-bottom: 14px; }
        .as-field-label-row {
          display: flex; align-items: center; justify-content: space-between;
          margin-bottom: 8px;
        }
        .as-field-eyebrow {
          font-size: 11px; color: #5a6478;
          letter-spacing: 0.5px; text-transform: uppercase;
          font-weight: 700;
        }
        .as-use-current {
          background: transparent;
          border: 1px solid rgba(10,132,255,0.4);
          color: #4fa3ff;
          font-size: 11px; font-weight: 600;
          padding: 4px 10px; border-radius: 7px;
          cursor: pointer; font-family: inherit;
        }
        .as-use-current:active:not(:disabled) {
          background: rgba(10,132,255,0.12);
        }
        .as-use-current:disabled { opacity: 0.5; cursor: not-allowed; }

        .as-stepper {
          display: flex; align-items: center; justify-content: space-between;
          background: #1a2230;
          border: 1px solid #2a3447;
          border-radius: 14px;
          padding: 10px 14px;
        }
        .as-stepper-btn {
          width: 38px; height: 38px;
          border-radius: 10px;
          background: #2a3447;
          color: #e8ecf3;
          border: none;
          font-size: 20px; font-weight: 700;
          cursor: pointer; font-family: inherit;
          display: grid; place-items: center;
          line-height: 1;
        }
        .as-stepper-btn:active:not(:disabled) { background: #3a4459; }
        .as-stepper-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .as-stepper-value {
          display: flex; flex-direction: column; align-items: center;
        }
        .as-stepper-input {
          background: transparent; border: none; outline: none;
          color: #e8ecf3;
          font-size: 26px; font-weight: 700;
          text-align: center;
          width: 80px;
          font-family: inherit;
          padding: 0; line-height: 1;
          -moz-appearance: textfield;
        }
        .as-stepper-input::-webkit-outer-spin-button,
        .as-stepper-input::-webkit-inner-spin-button {
          -webkit-appearance: none; margin: 0;
        }
        .as-stepper-label {
          font-size: 10px; color: #8b95a8;
          margin-top: 2px;
        }

        .as-cost-input-wrap {
          background: #1a2230;
          border: 1px solid #2a3447;
          border-radius: 14px;
          padding: 12px 14px;
          display: flex; align-items: center; gap: 6px;
          transition: border-color 0.15s;
        }
        .as-cost-input-wrap:focus-within { border-color: #0a84ff; }
        .as-cost-input-currency {
          font-size: 22px; font-weight: 700; color: #8b95a8;
        }
        .as-cost-input {
          flex: 1; min-width: 0;
          background: transparent; border: none; outline: none;
          color: #e8ecf3;
          font-size: 22px; font-weight: 700;
          font-family: inherit;
          padding: 0;
        }

        .as-notes-input {
          width: 100%;
          padding: 11px 14px;
          background: #1a2230;
          border: 1px solid #2a3447;
          border-radius: 12px;
          color: #e8ecf3;
          font-size: 13px;
          font-family: inherit;
          outline: none;
          transition: border-color 0.15s;
        }
        .as-notes-input:focus { border-color: #0a84ff; }
        .as-notes-input::placeholder { color: #5a6478; }

        .as-preview {
          margin: 16px 0;
          padding: 14px;
          background: rgba(0,200,83,0.06);
          border: 1px solid rgba(0,200,83,0.22);
          border-radius: 14px;
        }
        .as-preview.is-down {
          background: rgba(255,59,48,0.06);
          border-color: rgba(255,59,48,0.22);
        }
        .as-preview-eyebrow {
          font-size: 10px; font-weight: 700;
          letter-spacing: 0.5px; text-transform: uppercase;
          color: #00c853;
          margin-bottom: 8px;
        }
        .as-preview.is-down .as-preview-eyebrow { color: #ff3b30; }
        .as-preview-hero {
          display: flex; align-items: baseline; gap: 10px;
          margin-bottom: 12px;
        }
        .as-preview-hero-pending {
          font-size: 13px; color: #8b95a8;
        }
        .as-preview-pct {
          font-size: 24px; font-weight: 700; color: #00c853;
          line-height: 1;
        }
        .as-preview.is-down .as-preview-pct { color: #ff3b30; }
        .as-preview-dollar {
          font-size: 13px; font-weight: 600; color: #00c853;
        }
        .as-preview.is-down .as-preview-dollar { color: #ff3b30; }
        .as-preview-row {
          display: flex; justify-content: space-between;
          font-size: 11px;
        }
        .as-preview-label { color: #8b95a8; }
        .as-preview-val {
          color: #e8ecf3; margin-top: 2px;
          font-size: 13px; font-weight: 600;
        }
        .as-preview-scenarios {
          margin-top: 12px; padding-top: 10px;
          border-top: 1px solid rgba(255,255,255,0.08);
        }
        .as-preview-scenarios-label {
          font-size: 10px; font-weight: 700;
          letter-spacing: 0.5px; text-transform: uppercase;
          color: #8b95a8;
          margin-bottom: 6px;
        }
        .as-preview-scenario-row {
          display: flex; justify-content: space-between;
          font-size: 12px;
          margin-bottom: 4px;
        }
        .as-preview-scenario-row span:first-child { color: #b8c4d6; }
        .as-preview-scenario-row .up { color: #00c853; font-weight: 600; }
        .as-preview-scenario-row .down { color: #ff3b30; font-weight: 600; }
      `}</style>
    </>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function EmptyState({ quickChips, recentWatched, onPickChip, onPickWatched }) {
  return (
    <>
      <div className="as-section-label">Quick add</div>
      <div className="as-chips">
        {quickChips.map((c) => (
          <button
            key={c.ticker}
            className={`as-chip ${c.alert ? 'as-chip-ai' : ''}`}
            onClick={() => onPickChip(c)}
          >
            {c.ticker}
            {c.alert?.recommendation ? ` · ${c.alert.recommendation}` : ''}
          </button>
        ))}
      </div>

      {recentWatched.length > 0 && (
        <>
          <div className="as-section-label">In your watchlist</div>
          {recentWatched.map((w) => (
            <button key={w.id} className="as-result" onClick={() => onPickWatched(w)}>
              <div className="as-logo">{w.ticker.slice(0, 2)}</div>
              <div className="as-result-meta">
                <div className="as-result-row">
                  {w.ticker}
                  <span className="as-rec-pill watching">WATCHING</span>
                </div>
                <div className="as-result-sub">{w.company || ''}</div>
              </div>
              <div className="as-result-right">
                {w.current_price != null && <div className="as-result-price">${Number(w.current_price).toFixed(2)}</div>}
                {w.today_pct != null && (
                  <div className={`as-result-pct ${w.today_pct >= 0 ? 'up' : 'down'}`}>
                    {w.today_pct >= 0 ? '+' : ''}{Number(w.today_pct).toFixed(2)}%
                  </div>
                )}
              </div>
            </button>
          ))}
        </>
      )}
    </>
  );
}

function SearchResults({ results, alertByTicker, onPickWatched, onPickAlert, onPickNew }) {
  const hasInYour = results.inYourStocks.length > 0;
  const hasAi = results.aiFlagging.length > 0;
  const hasAddNew = !!results.addNew;
  const empty = !hasInYour && !hasAi && !hasAddNew;

  if (empty) {
    return <div style={{ padding: '24px 0', color: '#5a6478', textAlign: 'center', fontSize: 13 }}>
      No matches. Try a different ticker.
    </div>;
  }

  return (
    <>
      {hasInYour && (
        <>
          <div className="as-section-label">In your stocks</div>
          {results.inYourStocks.map((w) => (
            <button key={w.id} className="as-result" onClick={() => onPickWatched(w)}>
              <div className="as-logo">{w.ticker.slice(0, 2)}</div>
              <div className="as-result-meta">
                <div className="as-result-row">{w.ticker} <span className="as-rec-pill watching">WATCHING</span></div>
                <div className="as-result-sub">{w.company || 'Already in your watchlist'}</div>
              </div>
              <div className="as-result-right">
                {w.current_price != null && <div className="as-result-price">${Number(w.current_price).toFixed(2)}</div>}
                {w.today_pct != null && (
                  <div className={`as-result-pct ${w.today_pct >= 0 ? 'up' : 'down'}`}>
                    {w.today_pct >= 0 ? '+' : ''}{Number(w.today_pct).toFixed(2)}%
                  </div>
                )}
              </div>
            </button>
          ))}
        </>
      )}

      {hasAi && (
        <>
          <div className="as-section-label">AI flagging today</div>
          {results.aiFlagging.map((a) => (
            <button key={a.id} className="as-result" onClick={() => onPickAlert(a)}>
              <div className="as-logo">{(a.ticker || '').slice(0, 2)}</div>
              <div className="as-result-meta">
                <div className="as-result-row">
                  {a.ticker}
                  {a.recommendation && <span className={`as-rec-pill ${a.recommendation.toLowerCase()}`}>{a.recommendation}</span>}
                </div>
                <div className="as-result-sub">{a.company || ''}</div>
              </div>
              <div className="as-result-right">
                {a.price_at_alert != null && <div className="as-result-price">${Number(a.price_at_alert).toFixed(2)}</div>}
              </div>
            </button>
          ))}
        </>
      )}

      {hasAddNew && (
        <>
          <div className="as-section-label">Add new</div>
          <button className="as-add-new" onClick={() => onPickNew(results.addNew)}>
            <div className="as-add-new-icon">+</div>
            <div style={{ flex: 1, textAlign: 'left' }}>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#e8ecf3' }}>Track {results.addNew}</div>
              <div style={{ fontSize: 11, color: '#8b95a8', marginTop: 2 }}>
                Not in today's AI feed — we'll monitor for emerging signals
              </div>
            </div>
          </button>
        </>
      )}
    </>
  );
}

// ----------------------------------------------------------------------------
// SelectedStockPanel — two-screen flow shown once a ticker is selected.
//   screen='choice'        → compact stock header + two choice cards
//                              (Watch  /  I own shares)
//   screen='log-position'  → Robinhood-style shares stepper + avg cost +
//                              live P&L preview against AI target/stop
// Replaces the old "single panel with two stacked buttons + inline form"
// pattern. See PR feat/add-to-portfolio-redesign (2026-05-12).
// ----------------------------------------------------------------------------
function SelectedStockPanel({
  view, screen,
  onGoToLogPosition, onBackToChoice,
  shares, setShares, entryPrice, setEntryPrice, notes, setNotes,
  busy, onAddToWatchlist, onRemoveFromWatchlist, onLogPosition,
  onChangeTicker,
}) {
  const a = view.alert;

  // Compact stock header used by both screens. Single row: company name +
  // current price on top, AI badge + target/stop strip below. Replaces the
  // old larger `.as-selected-card` block.
  const StockHeader = (
    <div className="as-stock-strip">
      <div className="as-stock-strip-top">
        <div className="as-stock-strip-meta">
          <div className="as-stock-strip-company">{view.company || view.ticker}</div>
          <div className="as-stock-strip-ticker">{view.ticker}</div>
        </div>
        <div className="as-stock-strip-right">
          {view.currentPrice != null && (
            <div className="as-stock-strip-price">${view.currentPrice.toFixed(2)}</div>
          )}
          {view.todayPct != null && (
            <div className={`as-stock-strip-pct ${view.todayPct >= 0 ? 'up' : 'down'}`}>
              {view.todayPct >= 0 ? '+' : ''}{view.todayPct.toFixed(2)}%
            </div>
          )}
        </div>
      </div>
      {a ? (
        <div className="as-stock-strip-ai">
          {a.recommendation && (
            <span className={`as-ai-tag ${a.recommendation.toLowerCase()}`}>AI {a.recommendation}</span>
          )}
          <span className="as-stock-strip-ai-text">
            {a.entry_low != null && <>Entry ${a.entry_low}{a.entry_high && a.entry_high !== a.entry_low ? `–${a.entry_high}` : ''}</>}
            {a.target_low != null && <> · Target ${a.target_low}{a.target_high && a.target_high !== a.target_low ? `–${a.target_high}` : ''}</>}
            {a.stop_loss != null && <> · Stop ${a.stop_loss}</>}
          </span>
        </div>
      ) : (
        <div className="as-stock-strip-monitor">
          🤖 No active AI signal — we'll monitor and flag if chatter emerges
        </div>
      )}
    </div>
  );

  // ─── Screen 1: choice ─────────────────────────────────────────────────
  if (screen === 'choice') {
    return (
      <>
        {onChangeTicker && (
          <button
            type="button"
            className="as-change-ticker"
            onClick={onChangeTicker}
            aria-label="Change ticker"
          >
            {"\u{2190}"} Change ticker
          </button>
        )}
        {StockHeader}

        <div className="as-choose-label">Choose how to track it</div>

        {/* Watch card — toggles between Add and Remove based on current state */}
        <button
          type="button"
          className={`as-choice-card as-choice-watch ${view.alreadyWatching ? 'is-active' : ''}`}
          onClick={view.alreadyWatching ? onRemoveFromWatchlist : onAddToWatchlist}
          disabled={busy}
        >
          <div className="as-choice-icon as-choice-icon-watch">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          </div>
          <div className="as-choice-body">
            <div className="as-choice-title">
              {view.alreadyWatching ? '✓ Watching this stock' : 'Watch this stock'}
            </div>
            <div className="as-choice-sub">
              {view.alreadyWatching
                ? 'Tap to stop watching'
                : a?.entry_low != null
                  ? `Alert me when it enters the buy zone`
                  : `Alert me on AI signal updates`}
            </div>
          </div>
          <span className={`as-choice-action ${view.alreadyWatching ? 'is-remove' : ''}`}>
            {busy ? '…' : view.alreadyWatching ? 'Remove' : 'Add'}
          </span>
        </button>

        {/* Own card — opens the log-position screen */}
        <button
          type="button"
          className="as-choice-card as-choice-own"
          onClick={onGoToLogPosition}
          disabled={busy}
        >
          <div className="as-choice-icon as-choice-icon-own">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="7" width="18" height="13" rx="2" />
              <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            </svg>
          </div>
          <div className="as-choice-body">
            <div className="as-choice-title">I own shares</div>
            <div className="as-choice-sub">
              {a?.target_low != null ? `Track P&L vs AI target` : `Track P&L over time`}
            </div>
          </div>
          <span className="as-choice-action as-choice-action-secondary">Log →</span>
        </button>

        <div className="as-choice-footer">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
          </svg>
          You can switch between these anytime
        </div>
      </>
    );
  }

  // ─── Screen 2: log-position ───────────────────────────────────────────
  return (
    <LogPositionScreen
      view={view}
      shares={shares} setShares={setShares}
      entryPrice={entryPrice} setEntryPrice={setEntryPrice}
      notes={notes} setNotes={setNotes}
      busy={busy}
      onBackToChoice={onBackToChoice}
      onLogPosition={onLogPosition}
      StockHeader={StockHeader}
    />
  );
}

// ----------------------------------------------------------------------------
// LogPositionScreen — Robinhood-style shares + avg cost form with a live P&L
// preview pane. Pure presentation; all submit logic lives in the parent's
// handleLogPosition (preserves the existing /api/paper-trades contract).
// ----------------------------------------------------------------------------
function LogPositionScreen({
  view, shares, setShares, entryPrice, setEntryPrice, notes, setNotes,
  busy, onBackToChoice, onLogPosition, StockHeader,
}) {
  const a = view.alert;
  const currentPrice = view.currentPrice;
  const targetLow = a?.target_low != null ? parseFloat(a.target_low) : null;
  const targetHigh = a?.target_high != null ? parseFloat(a.target_high) : targetLow;
  const targetMid = targetLow != null && targetHigh != null ? (targetLow + targetHigh) / 2 : null;
  const stopPrice = a?.stop_loss != null ? parseFloat(a.stop_loss) : null;

  const shareCount = parseInt(shares, 10) || 0;
  const cost = parseFloat(entryPrice);
  const validCost = Number.isFinite(cost) && cost > 0;
  const basis = validCost ? shareCount * cost : 0;
  const curVal = validCost && currentPrice != null ? shareCount * currentPrice : null;
  const pnl = curVal != null ? curVal - basis : null;
  const pnlPct = pnl != null && basis > 0 ? (pnl / basis) * 100 : null;
  const targetGain = validCost && targetMid != null ? shareCount * (targetMid - cost) : null;
  const stopLoss = validCost && stopPrice != null ? shareCount * (stopPrice - cost) : null;

  const fmt$ = (n) =>
    (n < 0 ? '−$' : '$') +
    Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
      <button
        type="button"
        className="as-change-ticker"
        onClick={onBackToChoice}
        aria-label="Back"
      >
        {"\u{2190}"} Back
      </button>

      {StockHeader}

      {/* Shares stepper */}
      <div className="as-field-block">
        <div className="as-field-label-row">
          <span className="as-field-eyebrow">How many shares?</span>
        </div>
        <div className="as-stepper">
          <button
            type="button"
            className="as-stepper-btn"
            onClick={() => setShares(Math.max(1, shareCount - 1))}
            disabled={busy || shareCount <= 1}
            aria-label="Decrease shares"
          >−</button>
          <div className="as-stepper-value">
            <input
              type="number"
              inputMode="numeric"
              className="as-stepper-input"
              value={shareCount}
              min={1}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                setShares(Number.isFinite(v) && v > 0 ? v : 1);
              }}
            />
            <span className="as-stepper-label">{shareCount === 1 ? 'share' : 'shares'}</span>
          </div>
          <button
            type="button"
            className="as-stepper-btn"
            onClick={() => setShares(shareCount + 1)}
            disabled={busy}
            aria-label="Increase shares"
          >+</button>
        </div>
      </div>

      {/* Avg cost input */}
      <div className="as-field-block">
        <div className="as-field-label-row">
          <span className="as-field-eyebrow">Avg cost per share</span>
          {currentPrice != null && (
            <button
              type="button"
              className="as-use-current"
              onClick={() => setEntryPrice(String(currentPrice.toFixed(2)))}
              disabled={busy}
            >
              Use ${currentPrice.toFixed(2)}
            </button>
          )}
        </div>
        <div className="as-cost-input-wrap">
          <span className="as-cost-input-currency">$</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            className="as-cost-input"
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      {/* Notes — collapsed by default, expands on focus */}
      <div className="as-field-block">
        <input
          type="text"
          className="as-notes-input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes (optional) — why this trade?"
        />
      </div>

      {/* Live preview */}
      {validCost && shareCount > 0 && (
        <div className={`as-preview ${pnl != null && pnl < 0 ? 'is-down' : 'is-up'}`}>
          <div className="as-preview-eyebrow">Your position so far</div>
          {pnl != null && pnlPct != null ? (
            <div className="as-preview-hero">
              <span className="as-preview-pct">
                {pnl >= 0 ? '+' : '−'}{Math.abs(pnlPct).toFixed(1)}%
              </span>
              <span className="as-preview-dollar">{fmt$(pnl)}</span>
            </div>
          ) : (
            <div className="as-preview-hero as-preview-hero-pending">
              Live P&L will appear here
            </div>
          )}
          <div className="as-preview-row">
            <div>
              <div className="as-preview-label">Cost basis</div>
              <div className="as-preview-val">{fmt$(basis)}</div>
            </div>
            {curVal != null && (
              <div style={{ textAlign: 'right' }}>
                <div className="as-preview-label">Current value</div>
                <div className="as-preview-val">{fmt$(curVal)}</div>
              </div>
            )}
          </div>
          {(targetGain != null || stopLoss != null) && (
            <div className="as-preview-scenarios">
              <div className="as-preview-scenarios-label">If AI signal plays out</div>
              {targetGain != null && (
                <div className="as-preview-scenario-row">
                  <span>Reaches target ${targetMid.toFixed(2)}</span>
                  <span className={targetGain >= 0 ? 'up' : 'down'}>
                    {targetGain >= 0 ? '+' : '−'}{fmt$(targetGain).replace('−', '').replace('$', '$')}
                  </span>
                </div>
              )}
              {stopLoss != null && (
                <div className="as-preview-scenario-row">
                  <span>Hits stop ${stopPrice.toFixed(2)}</span>
                  <span className={stopLoss >= 0 ? 'up' : 'down'}>
                    {stopLoss >= 0 ? '+' : '−'}{fmt$(stopLoss).replace('−', '').replace('$', '$')}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <button className="as-btn-primary" onClick={onLogPosition} disabled={busy}>
        {busy ? 'Saving…' : 'Save position'}
      </button>
    </>
  );
}
