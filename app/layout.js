export const metadata = {
  title: 'Stock Chatter — AI-first stock signals from 10 leading sources',
  description:
    'Catch the move before it happens. Stock Chatter is an AI scanner that fuses SEC filings, FDA catalysts, pre-market movers, Reddit chatter, and prediction markets into a daily watchlist with entry, target, and stop on every pick.',
  metadataBase: new URL('https://stocktracker.getfamilyfinance.com'),
  openGraph: {
    title: 'Stock Chatter — Catch the move before it happens',
    description:
      'AI-first stock signals from 10 leading-indicator sources. Daily pre-market digest, mobile dashboard, $199/yr.',
    type: 'website',
    siteName: 'Stock Chatter',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Stock Chatter — AI-first stock signals',
    description: 'Catch the move before it happens. $199/yr. AI-first stock signals from 10 leading-indicator sources.',
  },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  themeColor: '#0a0e1a',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.0/chart.umd.min.js" defer></script>
      </head>
      <body>{children}</body>
    </html>
  );
}
