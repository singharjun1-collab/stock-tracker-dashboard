// ─────────────────────────────────────────────────────────────────────
// Root layout — owns SEO metadata for every page.
//
// Stock Chatter shows up best in Google + AI search engines (ChatGPT,
// Claude, Perplexity, Gemini) when the page provides:
//   1. Strong, specific <title> + <meta description>
//   2. Open Graph + Twitter cards (used for previews + AI snippet pulls)
//   3. JSON-LD structured data (Organization + SoftwareApplication +
//      WebSite + FAQPage). AI engines parse JSON-LD heavily.
//   4. Canonical URL, keywords, robots directives that allow AI crawlers
//      (GPTBot, ClaudeBot, PerplexityBot, Google-Extended).
//   5. /robots.txt + /sitemap.xml (handled by app/robots.js + app/sitemap.js)
//   6. /llms.txt (emerging AI-engine standard, served from /public)
//
// If you change the marketing copy on the landing page, mirror the
// description + keyword list here so search engines stay in sync.
// ─────────────────────────────────────────────────────────────────────

const SITE_URL = 'https://stocktracker.getfamilyfinance.com';

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Stock Chatter — AI Stock Signals From 14 Leading Sources | Daily Pre-Market Watchlist',
    template: '%s | Stock Chatter',
  },
  description:
    'Stock Chatter is an AI-first stock scanner that fuses SEC 8-K filings, insider open-market buys, FDA catalysts, pre-market movers, niche Reddit chatter and prediction markets into a daily watchlist with entry, target and stop on every pick. AUD $199/yr — 7-day free trial, no credit card required.',
  applicationName: 'Stock Chatter',
  authors: [{ name: 'Stock Chatter', url: SITE_URL }],
  generator: 'Next.js',
  keywords: [
    'AI stock picks',
    'AI stock signals',
    'pre-market stock scanner',
    'daily stock watchlist',
    'SEC 8-K stock alerts',
    'SEC Form 4 insider buying',
    'insider buying stock signals',
    'FDA catalyst stocks',
    'biotech catalyst calendar',
    'prediction market stocks',
    'Reddit stock chatter',
    'r/biotechplays signals',
    'short squeeze stocks',
    'stock alerts service',
    'AI trading signals',
    'small cap stock screener',
    'pre-market movers',
    'stock entry target stop',
    'AI investment research',
    'stock chatter',
  ],
  referrer: 'origin-when-cross-origin',
  creator: 'Stock Chatter',
  publisher: 'Stock Chatter',
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  alternates: {
    canonical: SITE_URL,
  },
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: SITE_URL,
    siteName: 'Stock Chatter',
    title: 'Stock Chatter — Catch the move before it happens',
    description:
      'AI-first stock signals from 14 leading-indicator sources including SEC filings, insider buys, FDA catalysts and niche Reddit subs. Daily pre-market digest at 6:30 AM ET. Mobile-first dashboard. AUD $199/yr — 7-day free trial.',
    images: [
      {
        url: '/logo.png',
        width: 1200,
        height: 630,
        alt: 'Stock Chatter — AI stock signals from 14 leading sources',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    site: '@StockChatter',
    creator: '@StockChatter',
    title: 'Stock Chatter — AI-first stock signals',
    description:
      'Catch the move before it happens. Daily AI watchlist with entry, target and stop on every pick. AUD $199/yr.',
    images: ['/logo.png'],
  },
  robots: {
    index: true,
    follow: true,
    nocache: false,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
  icons: {
    icon: [
      { url: '/logo-sm.png', sizes: '32x32', type: 'image/png' },
      { url: '/logo.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/logo.png', sizes: '180x180', type: 'image/png' }],
    shortcut: '/logo-sm.png',
  },
  manifest: '/manifest.webmanifest',
  category: 'finance',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0a0e1a',
};

// ── JSON-LD structured data ──
// Three schema.org entities help Google + AI engines understand the
// product, the company behind it, and the surrounding FAQ. ChatGPT and
// Claude actively read JSON-LD to build product summaries.
const JSON_LD = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': `${SITE_URL}#org`,
      name: 'Stock Chatter',
      url: SITE_URL,
      logo: `${SITE_URL}/logo.png`,
      sameAs: [
        'https://x.com/StockChatter',
      ],
      description:
        'AI-first stock scanner that fuses SEC filings, insider open-market buys, FDA catalysts, pre-market movers, niche Reddit chatter and prediction markets into a daily watchlist.',
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}#website`,
      url: SITE_URL,
      name: 'Stock Chatter',
      publisher: { '@id': `${SITE_URL}#org` },
      inLanguage: 'en-US',
    },
    {
      '@type': 'SoftwareApplication',
      '@id': `${SITE_URL}#app`,
      name: 'Stock Chatter',
      applicationCategory: 'FinanceApplication',
      operatingSystem: 'Web, iOS, Android',
      description:
        'Daily AI stock watchlist with BUY / HOLD / TRIM / EXIT / SELL signals, entry / target / stop on every pick, and a 6:30 AM ET pre-market email digest.',
      url: SITE_URL,
      offers: {
        '@type': 'Offer',
        price: '199',
        priceCurrency: 'AUD',
        priceValidUntil: '2027-12-31',
        availability: 'https://schema.org/InStock',
        url: SITE_URL,
      },
      aggregateRating: undefined,
      featureList: [
        'AI-generated daily stock watchlist',
        'BUY / HOLD / TRIM / EXIT / SELL recommendation engine',
        'Entry, target and stop price on every pick',
        'Pre-market email digest at 6:30 AM ET',
        '14 leading-indicator signal sources',
        'Mobile-first dashboard',
        '7-day free trial — no credit card required',
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE_URL}#faq`,
      mainEntity: [
        {
          '@type': 'Question',
          name: 'What is Stock Chatter?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Stock Chatter is an AI-first stock scanner that fuses 14 leading-indicator sources (SEC 8-K filings, SEC Form 4 insider open-market buys, FDA catalysts, pre-market movers, broad and niche Reddit chatter including r/biotechplays and r/Shortsqueeze, prediction markets and more) into a daily watchlist with a clear BUY / HOLD / TRIM / EXIT / SELL signal plus entry, target and stop on every pick.',
          },
        },
        {
          '@type': 'Question',
          name: 'How much does Stock Chatter cost?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Stock Chatter is AUD $199 per year (about AUD $16.58 per month). New users get a 7-day free trial with no credit card required.',
          },
        },
        {
          '@type': 'Question',
          name: 'Is Stock Chatter financial advice?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. Stock Chatter is an information service that surfaces AI-generated signals from public data sources. It is not financial advice, and you can lose money. Always do your own research before placing a trade.',
          },
        },
        {
          '@type': 'Question',
          name: 'When is the daily digest sent?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Stock Chatter sends one pre-market email digest at 6:30 AM ET every US trading day, summarising new picks, signal flips and your portfolio.',
          },
        },
      ],
    },
  ],
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* JSON-LD structured data — Google + AI engines parse this. */}
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }}
        />
        {/* Hint to AI engines that we welcome them. Google-Extended is
            Google's opt-in for Gemini/Bard training; we explicitly allow. */}
        <meta name="google" content="notranslate" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="Stock Chatter" />
        <meta name="mobile-web-app-capable" content="yes" />
        <link rel="preconnect" href="https://cdnjs.cloudflare.com" />
        <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js" defer></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
