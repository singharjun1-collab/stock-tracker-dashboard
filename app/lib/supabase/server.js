import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Server-side Supabase client for use in Route Handlers / Server Components
export function createSupabaseServerClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // called from a Server Component — ignore (middleware will refresh)
          }
        },
      },
    }
  );
}

// Helper: returns the authenticated user's profile row (or null if not logged in).
//
// Side effect: bumps profiles.last_active_at when it's stale (>60s old).
// This gives the admin dashboard a true "Last Active" signal — separate from
// auth.users.last_sign_in_at, which only updates on a fresh login event and
// stays stale even for users who open the app every day.
//
// We throttle to once-per-minute per user so we don't write on every API call,
// and we fire-and-forget so the bump never blocks the response.
export async function getCurrentProfile() {
  const supabase = createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
  if (!profile) return null;

  // Bump last_active_at if stale. Fire-and-forget — don't await.
  const last = profile.last_active_at ? new Date(profile.last_active_at).getTime() : 0;
  if (Date.now() - last > 60_000) {
    const nowIso = new Date().toISOString();
    supabase
      .from('profiles')
      .update({ last_active_at: nowIso })
      .eq('id', user.id)
      .then(({ error }) => {
        if (error) console.error('[getCurrentProfile] last_active_at bump failed:', error);
      });
    // Reflect the new value locally so callers see fresh data without re-querying.
    profile.last_active_at = nowIso;
  }

  return { ...profile, authUser: user };
}
