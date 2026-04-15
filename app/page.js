'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from './lib/supabase/browser';
import './globals.css';

export default function LoginPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) {
        setChecking(false);
        return;
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('status')
        .eq('id', user.id)
        .single();
      if (profile?.status === 'approved') {
        router.replace('/dashboard');
      } else {
        router.replace('/pending');
      }
    }).catch(() => setChecking(false));
  }, [router]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="login-container">
        <div className="spinner"></div>
      </div>
    );
  }

  return (
    <div className="login-container">
      <div className="login-box">
        <div className="login-lock-icon">&#x1f4c8;</div>
        <h1>Stock <span>Intelligence</span></h1>
        <p className="login-subtitle">Sign in to access your personal portfolio and the community leaderboard.</p>

        <button className="google-signin-btn" onClick={handleGoogleSignIn} disabled={loading}>
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z"/>
            <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"/>
            <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"/>
          </svg>
          <span>{loading ? 'Redirecting to Google…' : 'Sign in with Google'}</span>
        </button>

        {error && <p className="login-error">{error}</p>}

        <p className="login-footer-note">
          New here? Sign in with Google and the admin will approve your access.
        </p>
      </div>
    </div>
  );
}
