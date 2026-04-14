import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// GET all ratings
export async function GET(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
      .from('user_ratings')
      .select('*');

    if (error) throw error;
    return NextResponse.json({ ratings: data });
  } catch (error) {
    console.error('Error fetching ratings:', error);
    return NextResponse.json({ error: 'Failed to fetch ratings' }, { status: 500 });
  }
}

// POST or update a rating
export async function POST(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { alert_id, rating } = await request.json();

    if (!alert_id || !['up', 'down'].includes(rating)) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    // Upsert: insert or update existing rating
    const { data, error } = await supabase
      .from('user_ratings')
      .upsert({ alert_id, rating }, { onConflict: 'alert_id' })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json({ rating: data });
  } catch (error) {
    console.error('Error saving rating:', error);
    return NextResponse.json({ error: 'Failed to save rating' }, { status: 500 });
  }
}

// DELETE a rating
export async function DELETE(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const alertId = searchParams.get('alert_id');

    if (!alertId) {
      return NextResponse.json({ error: 'Missing alert_id' }, { status: 400 });
    }

    const { error } = await supabase
      .from('user_ratings')
      .delete()
      .eq('alert_id', parseInt(alertId));

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting rating:', error);
    return NextResponse.json({ error: 'Failed to delete rating' }, { status: 500 });
  }
}
