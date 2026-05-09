import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

// ── Middleware ────────────────────────────────────────────────────
//
// Runs on every gated request and refreshes the Supabase session
// cookie so it stays valid as users move around the dashboard.
//
// Two hardening rules to avoid the production 504 we saw:
//
//   1. SKIP public marketing routes entirely (/, /privacy, /terms,
//      /login, /unsubscribe, /robots.txt, /sitemap.xml, /llms.txt,
//      /manifest.webmanifest). These don't need a session refresh,
//      and running middleware on /robots.txt etc. blocks AI crawlers
//      whenever Supabase has a hiccup.
//
//   2. Race the Supabase getUser() call against a 4-second timeout.
//      If Supabase is slow or unreachable, we fail OPEN — return
//      NextResponse.next() rather than hang the whole request and
//      trigger Vercel's MIDDLEWARE_INVOCATION_TIMEOUT (504).
//
// The matcher below also explicitly excludes Next's internal paths
// and image extensions; together with the in-handler skip list,
// only authed surfaces actually do session work.
// ─────────────────────────────────────────────────────────────────

// Routes the middleware deliberately does NOTHING for — they are
// either public marketing pages or files that must be reachable to
// anonymous (and crawler) traffic without a Supabase round-trip.
const PUBLIC_PREFIXES = [
  '/login',
  '/privacy',
  '/terms',
  '/unsubscribe',
  '/upgrade',
];

const PUBLIC_EXACT = new Set([
  '/',
  '/robots.txt',
  '/sitemap.xml',
  '/llms.txt',
  '/manifest.webmanifest',
  '/favicon.ico',
]);

function isPublicPath(pathname) {
  if (PUBLIC_EXACT.has(pathname)) return true;
  for (const p of PUBLIC_PREFIXES) {
    if (pathname === p || pathname.startsWith(`${p}/`)) return true;
  }
  return false;
}

// Promise that resolves to `null` after `ms` milliseconds. Used to
// fail-open when Supabase is slow.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), ms)),
  ]);
}

export async function middleware(request) {
  const { pathname } = request.nextUrl;

  // Fast path: public marketing + SEO endpoints get nothing from us.
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh the session if it expired — but never let this hang the
  // request. 4s is generous; in healthy operation the call is <200ms.
  try {
    await withTimeout(supabase.auth.getUser(), 4000);
  } catch (e) {
    // Defensive: even if getUser throws synchronously somehow, we
    // still let the request through. The page-level guards (e.g. the
    // /dashboard server-side trial check) will redirect unauthed
    // users to /login.
    console.error('[middleware] getUser failed:', e);
  }

  return response;
}

export const config = {
  // Match all paths except Next internals and static asset extensions.
  // The handler itself short-circuits public routes via isPublicPath().
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)'],
};
