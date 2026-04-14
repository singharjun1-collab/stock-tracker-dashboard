import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// GET - fetch recent signal changes
export async function GET(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
      .from('signal_changes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json({ changes: data });
  } catch (error) {
    console.error('Error fetching signal changes:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

// POST - record a signal change and send email alerts
export async function POST(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { alert_id, ticker, old_recommendation, new_recommendation } = body;

    // Record the signal change
    const { data: change, error: changeError } = await supabase
      .from('signal_changes')
      .insert({
        alert_id,
        ticker,
        old_recommendation,
        new_recommendation,
      })
      .select()
      .single();

    if (changeError) throw changeError;

    // Get distribution list
    const { data: members, error: membersError } = await supabase
      .from('alert_distribution_list')
      .select('email, name')
      .eq('active', true);

    if (membersError) throw membersError;

    // Send email notifications (via Supabase Edge Function or external service)
    // For now, we log and mark as notified. The scheduled scan handles actual email sending.
    const { error: updateError } = await supabase
      .from('signal_changes')
      .update({ notified: true })
      .eq('id', change.id);

    return NextResponse.json({
      success: true,
      change,
      notified_count: members?.length || 0,
      members: members?.map(m => m.email) || [],
    });
  } catch (error) {
    console.error('Error recording signal change:', error);
    return NextResponse.json({ error: 'Failed to record' }, { status: 500 });
  }
}
