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

    // Combine alerts with their prices and status
    const combined = alerts.map(alert => ({
      ...alert,
      status: alert.status || 'active',
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
