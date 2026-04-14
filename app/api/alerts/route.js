import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export async function GET(request) {
  // Check auth cookie
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Fetch all alerts with their prices
    const { data: alerts, error: alertsError } = await supabase
      .from('stock_alerts')
      .select('*')
      .order('alert_date', { ascending: false });

    if (alertsError) throw alertsError;

    const { data: prices, error: pricesError } = await supabase
      .from('stock_prices')
      .select('*')
      .order('price_date', { ascending: true });

    if (pricesError) throw pricesError;

    // Fetch signal changes
    const { data: signalChanges, error: scError } = await supabase
      .from('signal_changes')
      .select('*')
      .order('created_at', { ascending: false });

    if (scError) console.error('Signal changes error:', scError);

    // Fetch user ratings
    const { data: ratings, error: ratingsError } = await supabase
      .from('user_ratings')
      .select('*');

    if (ratingsError) console.error('Ratings error:', ratingsError);

    // Build ratings lookup
    const ratingsMap = {};
    (ratings || []).forEach(r => { ratingsMap[r.alert_id] = r.rating; });

    // Build signal changes lookup (latest change per alert)
    const changesMap = {};
    (signalChanges || []).forEach(sc => {
      if (!changesMap[sc.alert_id]) {
        changesMap[sc.alert_id] = sc;
      }
    });

    // Combine alerts with their prices, signal changes, and ratings
    const combined = alerts.map(alert => ({
      ...alert,
      status: alert.status || 'active',
      recommendation: alert.recommendation || 'HOLD',
      recommendation_reason: alert.recommendation_reason || '',
      source: alert.source || 'unknown',
      market_cap: alert.market_cap ? parseFloat(alert.market_cap) : null,
      forecast_sell_date: alert.forecast_sell_date || null,
      user_rating: ratingsMap[alert.id] || null,
      latest_signal_change: changesMap[alert.id] || null,
      prices: prices
        .filter(p => p.alert_id === alert.id)
        .map(p => ({
          date: p.price_date,
          price: parseFloat(p.price),
          pct_change: parseFloat(p.pct_change),
        })),
    }));

    return NextResponse.json({ alerts: combined });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}
