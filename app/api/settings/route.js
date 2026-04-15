import { NextResponse } from 'next/server';
import { createSupabaseServerClient, getCurrentProfile } from '@/app/lib/supabase/server';

// GET the current user's AI settings
export async function GET() {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (profile.status !== 'approved') {
    return NextResponse.json({ error: 'Not approved' }, { status: 403 });
  }

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('ai_settings')
      .select('*')
      .eq('user_id', profile.id);

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

// POST to update a setting for the current user
export async function POST(request) {
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (profile.status !== 'approved') {
    return NextResponse.json({ error: 'Not approved' }, { status: 403 });
  }

  try {
    const { key, value } = await request.json();

    if (!key || value === undefined) {
      return NextResponse.json({ error: 'Missing key or value' }, { status: 400 });
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from('ai_settings')
      .upsert(
        {
          user_id: profile.id,
          setting_key: key,
          setting_value: value,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,setting_key' }
      )
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error) {
    console.error('Error updating setting:', error);
    return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 });
  }
}
