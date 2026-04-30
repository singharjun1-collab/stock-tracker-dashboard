'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '../lib/supabase/browser';
import '../globals.css';

const PAID_STATES = new Set(['active', 'on_trial', 'past_due']);

export default function PendingPage() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch the profile via the server API (uses HTTP-only cookies, always fresh)
  const checkStatus = async () => {
    try {
      const res = await fetch('/api/profile', { cache: 'no-store' });
      if (res.status === 401) {
        router.replace('/login');
        return;
      }
      const data = await res.json();
      if (!data?.profile) return;
      if (data.profile.status === 'approved') {
        router.replace('/dashboard');
        return;
      }
      setProfile(data.profile);
      setSubscription(data.subscription || null);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();
    // Auto re-check every 5 seconds so the page advances once AJ approves
    const interval = setInterval(checkStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleSignOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    document.cookie = 'stock_auth=; Path=/; Max-Age=0; SameSite=Lax';
    router.replace('/login');
  };

  if (loading) {
    return <div className="login-container"><div className="spinner"></div></div>;
  }

  const isDisabled = profile?.status === 'disabled';
  const hasPaidSub = subscription && PAID_STATES.has((subscription.status || '').toLowerCase());
  const name = profile?.display_name || profile?.email?.split('@')[0] || 'there';

  // Three states for non-disabled pending users:
  //   1. No subscription on file → push them back to landing to subscribe.
  //   2. Has paid sub but profile still pending → race between Stripe webhook
  //      and Google sign-in; tell them we're approving + auto-refresh.
  //   3. Has cancelled/expired sub → renewal flow.
  let title = 'Pending Approval';
  let body = `Hi ${name}! Your account is waiting for admin approval. This page will refresh automatically once you're in.`;
  let primaryCta = null;

  if (isDisabled) {
    title = 'Access Disabled';
    body = 'Your access to Stock Chatter has been disabled. Please contact the admin if you believe this is a mistake.';
  } else if (!subscription) {
    title = 'One step away';
    body = `Hi ${name}! You're signed in. To unlock your daily AI watchlist, complete your subscription below — you'll be auto-approved instantly on payment.`;
    primaryCta = { label: 'Complete subscription — $199/yr', href: '/' };
  } else if (!hasPaidSub) {
    title = 'Subscription not active';
    body = `Hi ${name}! We see your account but no active subscription is on file (status: ${subscription.status}). Reactivate to regain access.`;
    primaryCta = { label: 'Reactivate subscription', href: '/' };
  } else {
    title = 'Approving your account…';
    body = `Hi ${name}! Payment received — we're finalising your access. This page will refresh in a moment.`;
  }

  return (
    <div className="login-container">
      <div className="login-box">
        {profile?.avatar_url && (
          <img src={profile.avatar_url} alt="" className="pending-avatar" referrerPolicy="no-referrer" />
        )}
        <h1>{title}</h1>
        <p className="login-subtitle" style={{ marginBottom: 20 }}>{body}</p>
        {primaryCta && (
          <a
            className="google-signin-btn"
            href={primaryCta.href}
            style={{
              background: 'linear-gradient(135deg, #1565c0, #4fc3f7)',
              color: '#fff',
              border: 'none',
              fontWeight: 700,
              textDecoration: 'none',
              display: 'inline-flex',
              justifyContent: 'center',
              alignItems: 'center',
              marginBottom: 12,
            }}
          >
            <span>{primaryCta.label}</span>
          </a>
        )}
        <button className="google-signin-btn" onClick={handleSignOut}>
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}
