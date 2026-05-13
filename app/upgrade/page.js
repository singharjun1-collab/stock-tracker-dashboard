'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '../lib/supabase/browser';
import '../globals.css';
import { Ico } from '../components/Icon';

/**
 * /upgrade — full-page paywall.
 *
 * Shown when:
 *   - Trial expired AND no active Lemon Squeezy subscription (the "day 8" gate).
 *   - User clicks "Subscribe" anywhere in the app.
 *
 * Design intent:
 *   Robinhood-style — one screen, one decision. Big amount, clear value
 *   recap, single primary CTA, sign-out as the only secondary action.
 *   Mobile-first: card centred, single column, generous spacing.
 *
 * Subscribe CTA opens the Lemon Squeezy hosted checkout. The webhook
 * (/api/webhooks/lemonsqueezy) flips profiles.status='approved' on payment
 * AND auto-adds them to the alert_distribution_list, so they get the
 * dashboard + the daily digest immediately.
 */

const CHECKOUT_URL = process.env.NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL || '';

const PAID_STATES = new Set(['active', 'on_trial', 'past_due']);

export default function UpgradePage() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Auto-bounce paying / on-trial users — they shouldn't see the paywall.
  useEffect(() => {
    let alive = true;
    fetch('/api/profile', { cache: 'no-store' })
      .then(res => (res.status === 401 ? null : res.json()))
      .then(data => {
        if (!alive) return;
        if (!data?.profile) {
          router.replace('/login');
          return;
        }
        // Active subscriber → straight to dashboard
        if (data.subscription && PAID_STATES.has((data.subscription.status || '').toLowerCase())) {
          router.replace('/dashboard');
          return;
        }
        // Still in trial → straight to dashboard
        const ends = data.profile.trial_ends_at ? new Date(data.profile.trial_ends_at) : null;
        if (ends && ends.getTime() > Date.now()) {
          router.replace('/dashboard');
          return;
        }
        setProfile(data.profile);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { alive = false; };
  }, [router]);

  const handleSignOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    document.cookie = 'stock_auth=; Path=/; Max-Age=0; SameSite=Lax';
    router.replace('/login');
  };

  if (loading) {
    return <div className="login-container"><div className="spinner"></div></div>;
  }

  const firstName = (profile?.display_name || '').split(' ')[0]
    || profile?.email?.split('@')[0]
    || 'there';

  return (
    <div className="login-container">
      <div
        className="login-box"
        style={{
          maxWidth: 460,
          padding: '32px 28px',
          textAlign: 'center',
        }}
      >
        <img src="/logo.png" alt="Stock Chatter" className="login-logo" width="64" height="64" />

        <div
          style={{
            display: 'inline-block',
            background: 'linear-gradient(135deg,#0b2540,#1565c0)',
            color: '#fff',
            padding: '4px 12px',
            borderRadius: 999,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 0.5,
            textTransform: 'uppercase',
            marginBottom: 12,
          }}
        >
          Trial ended
        </div>

        <h1 style={{ fontSize: 26, lineHeight: 1.2, margin: '0 0 8px' }}>
          Hi {firstName} &mdash; ready to lock it in?
        </h1>
        <p className="login-subtitle" style={{ marginBottom: 24, color: '#7a9bc0' }}>
          Your 7-day free trial is up. Subscribe to keep your daily AI watchlist, pre-market digest, and full mobile dashboard.
        </p>

        {/* Pricing card */}
        <div
          style={{
            background: 'linear-gradient(180deg,#0a1929,#0f2238)',
            border: '1px solid #1e3a5f',
            borderRadius: 14,
            padding: '20px 18px',
            marginBottom: 22,
            textAlign: 'left',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, color: '#fff', marginBottom: 4 }}>
            <span style={{ fontSize: 14, color: '#7a9bc0' }}>AUD&nbsp;$</span>
            <span style={{ fontSize: 36, fontWeight: 800, lineHeight: 1 }}>199</span>
            <span style={{ fontSize: 14, color: '#7a9bc0' }}>/ year</span>
          </div>
          <div style={{ color: '#7a9bc0', fontSize: 12, marginBottom: 14 }}>
            ≈ AUD $16.58 / month &middot; cancel anytime
          </div>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              color: '#cfd8e3',
              fontSize: 14,
              lineHeight: 1.8,
            }}
          >
            <li><span style={{ color: '#22c55e', marginRight: 8, display: 'inline-flex', verticalAlign: 'middle' }}><Ico name="check" size={14} strokeWidth={2.5} /></span>Daily AI watchlist with BUY / HOLD / TRIM / EXIT / SELL</li>
            <li><span style={{ color: '#22c55e', marginRight: 8, display: 'inline-flex', verticalAlign: 'middle' }}><Ico name="check" size={14} strokeWidth={2.5} /></span>Pre-market email digest at 6:30 AM ET</li>
            <li><span style={{ color: '#22c55e', marginRight: 8, display: 'inline-flex', verticalAlign: 'middle' }}><Ico name="check" size={14} strokeWidth={2.5} /></span>Mobile dashboard with full signal history</li>
            <li><span style={{ color: '#22c55e', marginRight: 8, display: 'inline-flex', verticalAlign: 'middle' }}><Ico name="check" size={14} strokeWidth={2.5} /></span>All 14 leading-indicator signal sources (incl. insider buys & niche subs)</li>
          </ul>
        </div>

        {CHECKOUT_URL ? (
          <a
            className="google-signin-btn"
            href={CHECKOUT_URL}
            rel="nofollow"
            style={{
              background: 'linear-gradient(135deg, #1565c0, #4fc3f7)',
              color: '#fff',
              border: 'none',
              fontWeight: 700,
              fontSize: 15,
              textDecoration: 'none',
              display: 'inline-flex',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <span>Subscribe &mdash; AUD $199 / year</span>
          </a>
        ) : (
          <p style={{ color: '#ef4444', fontSize: 13 }}>
            Checkout link not configured. Please contact support.
          </p>
        )}

        <button className="google-signin-btn" onClick={handleSignOut}>
          <span>Sign out</span>
        </button>

        <p style={{ color: '#7a9bc0', fontSize: 12, marginTop: 18, lineHeight: 1.6 }}>
          You&rsquo;ll be auto-approved on payment &mdash; back in your dashboard within seconds.
          <br />
          <a href="/privacy" style={{ color: '#7a9bc0' }}>Privacy</a>
          {' · '}
          <a href="/terms" style={{ color: '#7a9bc0' }}>Terms</a>
        </p>
      </div>
    </div>
  );
}
