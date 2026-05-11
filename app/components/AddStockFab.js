'use client';

// AddStockFab
//
// The big blue "+" button that lives in the middle of the bottom nav.
// Robinhood-style elevated FAB — always thumb-reachable, hard to miss,
// the primary action of the app.
//
// Renders a fixed-position button positioned to sit above the bottom nav.
// On mobile, it floats; on larger screens, it can still be visible above
// the bottom-right corner.

export default function AddStockFab({ onClick, label = 'Add' }) {
  return (
    <>
      <button
        className="asfab"
        onClick={onClick}
        aria-label="Add a stock"
        type="button"
      >
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <div className="asfab-label" aria-hidden="true">{label}</div>

      <style>{`
        .asfab {
          position: fixed;
          bottom: calc(54px + env(safe-area-inset-bottom, 0px));
          left: 50%;
          transform: translateX(-50%);
          width: 58px;
          height: 58px;
          background: linear-gradient(135deg, #0a84ff 0%, #0066ff 100%);
          color: white;
          border: 4px solid #0a0e14;
          border-radius: 50%;
          display: grid;
          place-items: center;
          box-shadow: 0 8px 24px rgba(10,132,255,0.4), 0 2px 6px rgba(0,0,0,0.4);
          cursor: pointer;
          z-index: 1000;
          padding: 0;
          transition: transform 0.18s ease, box-shadow 0.18s ease;
          font-family: inherit;
        }
        .asfab:active {
          transform: translateX(-50%) scale(0.93);
          box-shadow: 0 4px 16px rgba(10,132,255,0.5);
        }
        .asfab:hover {
          box-shadow: 0 10px 28px rgba(10,132,255,0.5), 0 2px 6px rgba(0,0,0,0.4);
        }
        .asfab-label {
          position: fixed;
          bottom: calc(40px + env(safe-area-inset-bottom, 0px));
          left: 50%;
          transform: translateX(-50%);
          font-size: 9px;
          font-weight: 700;
          color: #0a84ff;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          z-index: 999;
          pointer-events: none;
        }
        @media (min-width: 900px) {
          .asfab {
            bottom: 32px;
            left: auto;
            right: 32px;
            transform: none;
            width: 62px;
            height: 62px;
          }
          .asfab:active { transform: scale(0.93); }
          .asfab-label { display: none; }
        }
      `}</style>
    </>
  );
}
