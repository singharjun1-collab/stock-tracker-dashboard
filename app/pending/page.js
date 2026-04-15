'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '../lib/supabase/browser';
import '../globals.css';

export default function PendingPage() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  // Fetch the profile via the server API (uses HTTP-only cookies, always fresh)
  const checkStatus = async () => {
    try {
      const res = await fetch('/api/profile', { cache: 'no-store' });
      if (res.status === 401) {
        router.replace('/');
        return;
      }
      const data = await res.json();
      if (!data?.profile) return;
      if (data.profile.status === 'approved') {
        router.replace('/dashboard');
        return;
      }
      setProfile(data.profile);
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
    router.replace('/');
  };

  if (loading) {
    return <div className="login-container"><div className="spinner"></div></div>;
  }

  const isDisabled = profile?.status === 'disabled';
  const name = profile?.display_name || profile?.email?.split('@')[0] || 'there';

  return (
    <div className="login-container">
      <div className="login-box">
        {profile?.avatar_url && (
          <img src={profile.avatar_url} alt="" className="pending-avatar" referrerPolicy="no-referrer" />
        )}
        <h1>{isDisabled ? 'Access Disabled' : 'Pending Approval'}</h1>
        <p className="login-subtitle" style={{ marginBottom: 20 }}>
          {isDisabled
            ? 'Your access to Stock Tracker has been disabled. Please contact the admin if you believe this is a mistake.'
            : `Hi ${name}! Your account is waiting for admin approval. This page will refresh automatically once you're in.`}
        </p>
        <button className="google-signin-btn" onClick={handleSignOut}>
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}
