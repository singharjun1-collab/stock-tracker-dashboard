import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// GET all AI settings
export async function GET(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
      .from('ai_settings')
      .select('*');

    if (error) throw error;

    const settings = {};
    (data || []).forEach(row => {
      settings[row.setting_key] = row.setting_value;
    });

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

// POST to update a setting
export async function POST(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { key, value } = await request.json();

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('ai_settings')
      .upsert(
        { setting_key: key, setting_value: value, updated_at: new Date().toISOString() },
        { onConflict: 'setting_key' }
      )
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error updating setting:', error);
    return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 });
  }
}
