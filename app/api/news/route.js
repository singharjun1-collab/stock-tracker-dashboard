import { NextResponse } from 'next/server';

export async function GET(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const ticker = searchParams.get('ticker');

  if (!ticker) {
    return NextResponse.json({ error: 'Missing ticker parameter' }, { status: 400 });
  }

  try {
    // Yahoo Finance news search via v1 API
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=10&quotesCount=0&listsCount=0`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (!res.ok) {
      return NextResponse.json({ ticker: ticker.toUpperCase(), news: [] });
    }

    const data = await res.json();
    const rawNews = data?.news || [];

    // Filter to last 7 days
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const news = rawNews
      .filter(item => {
        const publishTime = item.providerPublishTime
          ? item.providerPublishTime * 1000
          : 0;
        return publishTime >= sevenDaysAgo;
      })
      .map(item => ({
        title: item.title || '',
        publisher: item.publisher || '',
        link: item.link || '',
        publishedAt: item.providerPublishTime
          ? new Date(item.providerPublishTime * 1000).toISOString()
          : null,
      }))
      .slice(0, 8); // Max 8 headlines

    return NextResponse.json({ ticker: ticker.toUpperCase(), news });
  } catch (error) {
    console.error(`Error fetching news for ${ticker}:`, error);
    return NextResponse.json({ ticker: ticker.toUpperCase(), news: [] });
  }
}
