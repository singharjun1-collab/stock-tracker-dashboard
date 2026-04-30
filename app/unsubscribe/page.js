'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import '../globals.css';

function UnsubscribeInner() {
  const params = useSearchParams();
  const u = params.get('u');
  const sig = params.get('sig');

  // Three states: idle (showing the confirm button), submitting, done/error.
  const [status, setStatus] = useState('idle');
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);

  // On mount, decode the email from the token (purely cosmetic — the
  // server re-verifies the signature on the actual unsubscribe POST).
  useEffect(() => {
    if (!u) {
      setError('This link is missing required information. Use the link from the email exactly as received.');
      return;
    }
    try {
      // Replicate base64url decode in the browser
      const padded = u.replace(/-/g, '+').replace(/_/g, '/') +
        '==='.slice((u.length + 3) % 4);
      const decoded = atob(padded);
      setEmail(decoded);
    } catch (e) {
      setError('We could not read this unsubscribe link. Try clicking it again from the email.');
    }
  }, [u]);

  const handleConfirm = async () => {
    setStatus('submitting');
    setError(null);
    try {
      const res = await fetch('/api/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ u, sig }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || 'Something went wrong. Please try again.');
        setStatus('idle');
        return;
      }
      setStatus('done');
    } catch (e) {
      setError('Network error. Please try again in a moment.');
      setStatus('idle');
    }
  };

  if (status === 'done') {
    return (
      <div className="login-container">
        <div className="login-box">
          <h1 style={{ marginBottom: 8 }}>You're unsubscribed</h1>
          <p className="login-subtitle" style={{ marginBottom: 24 }}>
            <strong>{email}</strong> will no longer receive Stock Chatter pre-market emails. You can keep using the dashboard at any time.
          </p>
          <a
            className="google-signin-btn"
            href="https://stocktracker.getfamilyfinance.com"
            style={{
              background: 'linear-gradient(135deg, #1565c0, #4fc3f7)',
              color: '#fff',
              border: 'none',
              fontWeight: 700,
              textDecoration: 'none',
              display: 'inline-flex',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <span>Open Stock Chatter</span>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <h1 style={{ marginBottom: 8 }}>Unsubscribe?</h1>
        <p className="login-subtitle" style={{ marginBottom: 20 }}>
          {email ? (
            <>
              Stop sending Stock Chatter pre-market emails to <strong>{email}</strong>?
            </>
          ) : (
            <>Loading…</>
          )}
        </p>
        {error && (
          <p style={{ color: '#ef4444', fontSize: 13, marginBottom: 16 }}>{error}</p>
        )}
        <button
          className="google-signin-btn"
          onClick={handleConfirm}
          disabled={!email || status === 'submitting'}
          style={{
            background: status === 'submitting' ? '#475569' : 'linear-gradient(135deg, #b91c1c, #ef4444)',
            color: '#fff',
            border: 'none',
            fontWeight: 700,
            marginBottom: 12,
            cursor: status === 'submitting' ? 'wait' : 'pointer',
          }}
        >
          <span>{status === 'submitting' ? 'Unsubscribing…' : 'Yes, unsubscribe me'}</span>
        </button>
        <a
          className="google-signin-btn"
          href="https://stocktracker.getfamilyfinance.com"
          style={{ textDecoration: 'none', display: 'inline-flex', justifyContent: 'center' }}
        >
          <span>Cancel — keep emails</span>
        </a>
      </div>
    </div>
  );
}

export default function UnsubscribePage() {
  return (
    <Suspense fallback={<div className="login-container"><div className="spinner"></div></div>}>
      <UnsubscribeInner />
    </Suspense>
  );
}
