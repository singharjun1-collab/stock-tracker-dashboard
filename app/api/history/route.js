import { NextResponse } from 'next/server';

export async function GET(request) {
  // Check auth cookie
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
    // Fetch 3-month daily price history from Yahoo Finance
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=3mo&interval=1d&includePrePost=false`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      next: { revalidate: 3600 }, // Cache for 1 hour
    });

    if (!res.ok) {
      throw new Error(`Yahoo Finance returned ${res.status}`);
    }

    const data = await res.json();
    const result = data?.chart?.result?.[0];

    if (!result) {
      return NextResponse.json({ error: 'No data found for ticker' }, { status: 404 });
    }

    const timestamps = result.timestamp || [];
    const closes = result.indicators?.quote?.[0]?.close || [];

    // Build clean price array
    const prices = timestamps.map((ts, i) => ({
      date: new Date(ts * 1000).toISOString().split('T')[0],
      price: closes[i] != null ? Math.round(closes[i] * 100) / 100 : null,
    })).filter(p => p.price !== null);

    // Calculate 3-month change
    const startPrice = prices[0]?.price;
    const endPrice = prices[prices.length - 1]?.price;
    const change3mo = startPrice && endPrice
      ? Math.round(((endPrice - startPrice) / startPrice) * 10000) / 100
      : null;

    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      prices,
      change3mo,
      startPrice,
      endPrice,
    });
  } catch (error) {
    console.error(`Error fetching history for ${ticker}:`, error);
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 });
  }
}
