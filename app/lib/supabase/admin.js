import { createClient } from '@supabase/supabase-js';

// Service-role Supabase client — bypasses RLS. ONLY use this from
// server-side code that has already authorized the caller (e.g. a
// Vercel Cron route validating CRON_SECRET, or an authenticated
// approved-user request inside a Route Handler).
//
// NEVER expose the service role key to the browser. Never import this
// file from a Client Component.
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error(
      'Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars'
    );
  }
  return createClient(url, serviceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
