'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '../lib/supabase/browser';
import '../globals.css';

export default function PendingPage() {
  const router = useRouter();
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        router.replace('/');
        return;
      }
      const { data: p } = await supabase
        .from('profiles').select('*').eq('id', user.id).single();
      if (p?.status === 'approved') {
        router.replace('/dashboard');
        return;
      }
      setProfile(p);
      setLoading(false);
    })();
  }, [router]);

  const handleSignOut = async () => {
    const supabase = createSupabaseBrowserClient();
    await supabase.auth.signOut();
    router.replace('/');
  };

  if (loading) {
    return <div className="login-container"><div className="spinner"></div></div>;
  }

  const isDisabled = profile?.status === 'disabled';

  return (
    <div className="login-container">
      <div className="login-box">
        {profile?.avatar_url && (
          <img src={profile.avatar_url} alt="" className="pending-avatar" />
        )}
        <h1>{isDisabled ? 'Access Disabled' : 'Pending Approval'}</h1>
        <p className="login-subtitle" style={{ marginBottom: 20 }}>
          {isDisabled
            ? 'Your access to Stock Tracker has been disabled. Please contact the admin if you believe this is a mistake.'
            : `Hi ${profile?.display_name || profile?.email}! Your account is waiting for admin approval. You'll be let in as soon as AJ reviews it.`}
        </p>
        <button className="google-signin-btn" onClick={handleSignOut}>
          <span>Sign out</span>
        </button>
      </div>
    </div>
  );
}
