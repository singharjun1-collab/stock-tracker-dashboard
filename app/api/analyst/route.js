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
    // Fetch analyst data from Yahoo Finance v11 API
    const url = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=recommendationTrend,financialData`;

    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      next: { revalidate: 3600 },
    });

    if (!res.ok) {
      // Fallback: try the v6 quote endpoint for basic recommendation
      const fallbackUrl = `https://query1.finance.yahoo.com/v6/finance/quote?symbols=${encodeURIComponent(ticker)}`;
      const fallbackRes = await fetch(fallbackUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
        next: { revalidate: 3600 },
      });

      if (fallbackRes.ok) {
        const fallbackData = await fallbackRes.json();
        const quote = fallbackData?.quoteResponse?.result?.[0];
        if (quote) {
          return NextResponse.json({
            ticker: ticker.toUpperCase(),
            averageRating: quote.averageAnalystRating || null,
            targetMeanPrice: quote.targetMeanPrice || null,
            targetHighPrice: null,
            targetLowPrice: null,
            numberOfAnalysts: quote.numberOfAnalystOpinions || 0,
            recommendationKey: quote.recommendationKey || null,
            breakdown: null,
          });
        }
      }

      return NextResponse.json({
        ticker: ticker.toUpperCase(),
        averageRating: null,
        numberOfAnalysts: 0,
        recommendationKey: null,
        breakdown: null,
      });
    }

    const data = await res.json();
    const financialData = data?.quoteSummary?.result?.[0]?.financialData;
    const recTrend = data?.quoteSummary?.result?.[0]?.recommendationTrend?.trend?.[0]; // Current month

    const result = {
      ticker: ticker.toUpperCase(),
      recommendationKey: financialData?.recommendationKey || null,
      targetMeanPrice: financialData?.targetMeanPrice?.raw || null,
      targetHighPrice: financialData?.targetHighPrice?.raw || null,
      targetLowPrice: financialData?.targetLowPrice?.raw || null,
      numberOfAnalysts: financialData?.numberOfAnalystOpinions?.raw || 0,
      breakdown: recTrend ? {
        strongBuy: recTrend.strongBuy || 0,
        buy: recTrend.buy || 0,
        hold: recTrend.hold || 0,
        sell: recTrend.sell || 0,
        strongSell: recTrend.strongSell || 0,
      } : null,
    };

    // Build average rating text
    const key = result.recommendationKey;
    if (key) {
      const ratingMap = {
        'strong_buy': '1.0 - Strong Buy',
        'buy': '2.0 - Buy',
        'hold': '3.0 - Hold',
        'underperform': '4.0 - Underperform',
        'sell': '5.0 - Sell',
      };
      result.averageRating = ratingMap[key] || key;
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error(`Error fetching analyst data for ${ticker}:`, error);
    return NextResponse.json({
      ticker: ticker.toUpperCase(),
      averageRating: null,
      numberOfAnalysts: 0,
      recommendationKey: null,
      breakdown: null,
    });
  }
}
