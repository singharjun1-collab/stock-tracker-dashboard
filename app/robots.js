// Dynamic robots.txt for Stock Chatter.
//
// Allows all major search and AI engines (GPTBot, ClaudeBot,
// PerplexityBot, Google-Extended, etc.) to crawl public marketing
// pages. Blocks /dashboard, /api, /auth — those require login and
// expose user data.
//
// Generated at https://stocktracker.getfamilyfinance.com/robots.txt
// at build time by Next.js.

const SITE_URL = 'https://stocktracker.getfamilyfinance.com';

export default function robots() {
  return {
    rules: [
      // Default: every bot can crawl public pages, but not authed areas.
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/auth/',
          '/dashboard',
          '/dashboard/',
          '/pending',
          '/_next/',
        ],
      },
      // Explicit allow blocks for the major AI crawlers — declaring them
      // by name makes our position unambiguous and helps debugging.
      { userAgent: 'GPTBot', allow: '/', disallow: ['/api/', '/auth/', '/dashboard', '/dashboard/'] },
      { userAgent: 'ChatGPT-User', allow: '/', disallow: ['/api/', '/auth/', '/dashboard', '/dashboard/'] },
      { userAgent: 'OAI-SearchBot', allow: '/', disallow: ['/api/', '/auth/', '/dashboard', '/dashboard/'] },
      { userAgent: 'ClaudeBot', allow: '/', disallow: ['/api/', '/auth/', '/dashboard', '/dashboard/'] },
      { userAgent: 'Claude-Web', allow: '/', disallow: ['/api/', '/auth/', '/dashboard', '/dashboard/'] },
      { userAgent: 'anthropic-ai', allow: '/', disallow: ['/api/', '/auth/', '/dashboard', '/dashboard/'] },
      { userAgent: 'PerplexityBot', allow: '/', disallow: ['/api/', '/auth/', '/dashboard', '/dashboard/'] },
      { userAgent: 'Google-Extended', allow: '/', disallow: ['/api/', '/auth/', '/dashboard', '/dashboard/'] },
      { userAgent: 'Applebot-Extended', allow: '/', disallow: ['/api/', '/auth/', '/dashboard', '/dashboard/'] },
      { userAgent: 'CCBot', allow: '/', disallow: ['/api/', '/auth/', '/dashboard', '/dashboard/'] },
      { userAgent: 'Bytespider', allow: '/', disallow: ['/api/', '/auth/', '/dashboard', '/dashboard/'] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
