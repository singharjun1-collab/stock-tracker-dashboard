import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildActivityIndex, computeSignalStrength } from '../../lib/signalStrength';

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

    // Build activity index across ALL alerts so each ticker knows how many
    // distinct sources and total mentions it has (used by signal-strength scorer).
    const activityIndex = buildActivityIndex(alerts || [], signalChanges || []);

    // Combine alerts with their prices, signal changes, and ratings
    const combined = alerts.map(alert => {
      const enriched = {
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
      };

      // Signal strength (0-100) + sub-scores. Uses persisted value if the
      // scanner already wrote one, otherwise computes it on the fly from
      // sources, mention volume, velocity, and sentiment.
      const computed = computeSignalStrength(enriched, activityIndex);
      enriched.signal_strength = alert.signal_strength != null
        ? Math.round(parseFloat(alert.signal_strength))
        : computed.signal_strength;
      enriched.signal_sub_scores = computed.sub_scores;
      enriched.signal_source_count = computed.source_count;
      enriched.signal_mention_count = computed.mention_count;

      return enriched;
    });

    return NextResponse.json({ alerts: combined });
  } catch (error) {
    console.error('Error fetching alerts:', error);
    return NextResponse.json({ error: 'Failed to fetch data' }, { status: 500 });
  }
}
