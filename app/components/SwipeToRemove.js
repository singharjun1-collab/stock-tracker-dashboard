'use client';

// SwipeToRemove
//
// Robinhood/Apple Mail-style swipe-left-to-reveal-Remove wrapper.
// Wraps any child (typically an AlertCard) and lets the user swipe the
// row to the left to reveal a red "Remove" action button.
//
// Behavior
//   - Drag past 32px → snap "open" (action revealed)
//   - Drag past ACTION_WIDTH * 0.55 → fully open, snapped
//   - Drag right or release short → snap closed
//   - Tap anywhere on the card while open → close (no remove triggered)
//   - Tap the revealed "Remove" button → calls onRemove(ticker)
//
// Mobile-first: uses pointer events so it works for touch AND mouse.
// Vertical scrolls are detected and pass through (no horizontal hijack).
//
// Used on the Portfolio/Watchlist tab to give a native, discoverable
// way to remove a stock — fixes the long-standing "I don't see how to
// remove from watchlist" UX gap (2026-05-12).

import { useRef, useState, useCallback, useEffect } from 'react';

const ACTION_WIDTH = 96;          // px width of the revealed Remove button
const OPEN_THRESHOLD = 32;        // px drag before considering "open intent"
const SNAP_OPEN_THRESHOLD = 52;   // past this → snap fully open
const VERTICAL_LOCK_THRESHOLD = 8;// if y > x by this much, treat as vertical scroll

export default function SwipeToRemove({
  ticker,
  onRemove,           // (ticker) => Promise|void — parent handles the actual removal
  confirm = false,    // if true, show window.confirm before calling onRemove.
                      // Default false — swipe-then-tap is already a 2-step
                      // gesture, so an additional confirm popup is friction the
                      // user explicitly asked us to remove (2026-05-12).
  children,
}) {
  const [dx, setDx] = useState(0);
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState(false);
  const dragRef = useRef({
    startX: 0, startY: 0,
    startDx: 0,
    active: false,
    locked: null,    // 'horizontal' | 'vertical' | null
    pointerId: null,
  });
  const rowRef = useRef(null);

  // Effective translation while dragging or snapped
  const effectiveDx = dragRef.current.active ? dx : (open ? -ACTION_WIDTH : 0);

  const closeRow = useCallback(() => {
    setOpen(false);
    setDx(0);
  }, []);

  const onPointerDown = useCallback((e) => {
    // Only react to primary pointer (left-click / first touch)
    if (e.button !== undefined && e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startDx: open ? -ACTION_WIDTH : 0,
      active: true,
      locked: null,
      pointerId: e.pointerId,
    };
  }, [open]);

  const onPointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (!d.active || d.pointerId !== e.pointerId) return;
    const xDelta = e.clientX - d.startX;
    const yDelta = e.clientY - d.startY;

    // Lock direction on first meaningful movement
    if (d.locked === null) {
      if (Math.abs(yDelta) > VERTICAL_LOCK_THRESHOLD && Math.abs(yDelta) > Math.abs(xDelta)) {
        // Vertical scroll — abandon gesture so the page can scroll
        d.locked = 'vertical';
        d.active = false;
        return;
      }
      if (Math.abs(xDelta) > 6) {
        d.locked = 'horizontal';
        try { rowRef.current?.setPointerCapture?.(e.pointerId); } catch {}
      }
    }
    if (d.locked !== 'horizontal') return;

    let next = d.startDx + xDelta;
    // Resistance past fully-open
    if (next < -ACTION_WIDTH) next = -ACTION_WIDTH + (next + ACTION_WIDTH) * 0.25;
    // Resistance past closed (don't allow swiping right far)
    if (next > 0) next = next * 0.2;
    setDx(next);
    // Prevent the underlying card from receiving accidental clicks while dragging
    if (Math.abs(xDelta) > 4 && e.cancelable) e.preventDefault();
  }, []);

  const onPointerUp = useCallback((e) => {
    const d = dragRef.current;
    if (!d.active && d.locked !== 'horizontal') {
      // Wasn't a horizontal drag — leave state as-is (page scroll continues)
      dragRef.current = { ...d, active: false, locked: null, pointerId: null };
      return;
    }
    try { rowRef.current?.releasePointerCapture?.(e.pointerId); } catch {}

    const finalDx = dx;
    // Decide snap target
    if (finalDx < -SNAP_OPEN_THRESHOLD) {
      setOpen(true);
      setDx(0);
    } else if (finalDx > -OPEN_THRESHOLD) {
      setOpen(false);
      setDx(0);
    } else {
      // Halfway state — bias toward whichever we were already in
      setOpen((wasOpen) => {
        if (wasOpen && finalDx > -OPEN_THRESHOLD) { setDx(0); return false; }
        setDx(0);
        return wasOpen;
      });
    }
    dragRef.current = { startX: 0, startY: 0, startDx: 0, active: false, locked: null, pointerId: null };
  }, [dx]);

  const onPointerCancel = useCallback(() => {
    setDx(0);
    dragRef.current = { startX: 0, startY: 0, startDx: 0, active: false, locked: null, pointerId: null };
  }, []);

  // Close when the user clicks anywhere outside this row
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (!rowRef.current) return;
      if (!rowRef.current.contains(e.target)) closeRow();
    };
    document.addEventListener('mousedown', onDocClick, true);
    document.addEventListener('touchstart', onDocClick, true);
    return () => {
      document.removeEventListener('mousedown', onDocClick, true);
      document.removeEventListener('touchstart', onDocClick, true);
    };
  }, [open, closeRow]);

  const handleRemoveClick = useCallback(async (e) => {
    e.stopPropagation();
    if (removing) return;
    if (confirm && !window.confirm(`Remove ${ticker} from your watchlist?`)) {
      closeRow();
      return;
    }
    setRemoving(true);
    try {
      await onRemove?.(ticker);
    } finally {
      setRemoving(false);
      closeRow();
    }
  }, [confirm, onRemove, ticker, removing, closeRow]);

  // If the row is open, capture clicks on the content area so they close
  // the row rather than activating something inside (more forgiving on
  // mobile where mis-taps after a swipe are common).
  const onContentClickCapture = (e) => {
    if (open) {
      e.stopPropagation();
      e.preventDefault();
      closeRow();
    }
  };

  return (
    <div
      ref={rowRef}
      className={`swipe-row${open ? ' swipe-row-open' : ''}${dragRef.current.active ? ' swipe-row-dragging' : ''}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      style={{ touchAction: 'pan-y' }}
    >
      <div
        className="swipe-row-content"
        style={{
          transform: `translateX(${effectiveDx}px)`,
          transition: dragRef.current.active ? 'none' : 'transform 0.22s cubic-bezier(0.32, 0.72, 0, 1)',
        }}
        onClickCapture={onContentClickCapture}
      >
        {children}
      </div>

      <button
        type="button"
        className="swipe-row-action"
        onClick={handleRemoveClick}
        aria-label={`Remove ${ticker} from watchlist`}
        disabled={removing}
        style={{
          width: ACTION_WIDTH,
          opacity: Math.min(1, Math.max(0, -effectiveDx / ACTION_WIDTH)),
        }}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M6 6l1 14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-14" />
        </svg>
        <span className="swipe-row-action-label">
          {removing ? 'Removing…' : 'Remove'}
        </span>
      </button>

      <style>{`
        .swipe-row {
          position: relative;
          overflow: hidden;
          border-radius: 14px;
          margin-bottom: 12px;
        }
        .swipe-row-content {
          position: relative;
          z-index: 2;
          will-change: transform;
        }
        .swipe-row-action {
          position: absolute;
          top: 0; right: 0; bottom: 0;
          z-index: 1;
          background: linear-gradient(180deg, #ef4444 0%, #dc2626 100%);
          color: #fff;
          border: none;
          padding: 0 8px;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 4px;
          font-family: inherit;
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.02em;
          cursor: pointer;
          transition: opacity 0.18s ease;
        }
        .swipe-row-action:active:not(:disabled) {
          background: linear-gradient(180deg, #dc2626 0%, #b91c1c 100%);
        }
        .swipe-row-action:disabled { opacity: 0.7; cursor: wait; }
        .swipe-row-action-label {
          font-size: 12px;
          font-weight: 700;
          color: #fff;
          letter-spacing: 0.02em;
        }
        /* Subtle hint that the row is interactive — only on hover-capable
           devices so it doesn't flash on every scroll-touch on mobile. */
        @media (hover: hover) {
          .swipe-row:hover .swipe-row-content {
            transform: translateX(-4px);
          }
        }
        /* Override the hover hint when actively dragging or open */
        .swipe-row-dragging .swipe-row-content,
        .swipe-row-open .swipe-row-content { /* drag/open transform set inline */ }
      `}</style>
    </div>
  );
}
