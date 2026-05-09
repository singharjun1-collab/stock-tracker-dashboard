// Dynamic sitemap.xml for Stock Chatter.
//
// Lists every public page so Google + Bing + AI crawlers can discover
// them. The dashboard, /pending, /auth and /api routes are gated and
// intentionally NOT in the sitemap.
//
// Auto-served at https://stocktracker.getfamilyfinance.com/sitemap.xml.

const SITE_URL = 'https://stocktracker.getfamilyfinance.com';

export default function sitemap() {
  const lastModified = new Date();

  return [
    {
      url: `${SITE_URL}/`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/login`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${SITE_URL}/privacy`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/terms`,
      lastModified,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${SITE_URL}/upgrade`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
  ];
}
