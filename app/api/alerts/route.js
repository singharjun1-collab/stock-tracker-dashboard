import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';
import { buildActivityIndex, computeSignalStrength } from '../../lib/signalStrength';

export async function GET() {
  // Require Google-auth'd, approved user
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (profile.status !== 'approved') {
    return NextResponse.json({ error: 'Pending approval' }, { status: 403 });
  }

  const supabase = createSupabaseServerClient();

  try {
    // Fetch ONLY this user's alerts. RLS on stock_alerts enforces this
    // too, but we filter explicitly for clarity/safety.
    const { data: alerts, error: alertsError } = await supabase
      .from('stock_alerts')
      .select('*')
      .eq('user_id', profile.id)
      .order('alert_date', { ascending: false });

    if (alertsError) throw alertsError;

    const alertIds = (alerts || []).map(a => a.id);

    // Prices for just this user's alerts
    let prices = [];
    if (alertIds.length > 0) {
      const { data: priceRows, error: pricesError } = await supabase
        .from('stock_prices')
        .select('*')
        .in('alert_id', alertIds)
        .order('price_date', { ascending: true });
      if (pricesError) throw pricesError;
      prices = priceRows || [];
    }

    // Signal changes for just this user's alerts
    let signalChanges = [];
    if (alertIds.length > 0) {
      const { data: scRows, error: scError } = await supabase
        .from('signal_changes')
        .select('*')
        .in('alert_id', alertIds)
        .order('created_at', { ascending: false });
      if (scError) console.error('Signal changes error:', scError);
      signalChanges = scRows || [];
    }

    // Ratings (already user-scoped by user_ratings table design)
    const { data: ratings, error: ratingsError } = await supabase
      .from('user_ratings')
      .select('*')
      .eq('user_id', profile.id);

    if (ratingsError) console.error('Ratings error:', ratingsError);

    const ratingsMap = {};
    (ratings || []).forEach(r => { ratingsMap[r.alert_id] = r.rating; });

    const changesMap = {};
    signalChanges.forEach(sc => {
      if (!changesMap[sc.alert_id]) changesMap[sc.alert_id] = sc;
    });

    const activityIndex = buildActivityIndex(alerts || [], signalChanges);

    const combined = (alerts || []).map(alert => {
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
