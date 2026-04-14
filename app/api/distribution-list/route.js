import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// GET - fetch all distribution list members
export async function GET(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
      .from('alert_distribution_list')
      .select('*')
      .order('created_at', { ascending: true });

    if (error) throw error;
    return NextResponse.json({ members: data });
  } catch (error) {
    console.error('Error fetching distribution list:', error);
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 });
  }
}

// POST - add a new member
export async function POST(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { email, name } = body;

    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('alert_distribution_list')
      .insert({ email, name: name || null })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'Email already exists' }, { status: 409 });
      }
      throw error;
    }

    return NextResponse.json({ member: data });
  } catch (error) {
    console.error('Error adding to distribution list:', error);
    return NextResponse.json({ error: 'Failed to add' }, { status: 500 });
  }
}

// DELETE - remove a member
export async function DELETE(request) {
  const authCookie = request.cookies.get('stock_auth');
  if (!authCookie || authCookie.value !== 'authenticated') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'ID is required' }, { status: 400 });
    }

    const { error } = await supabase
      .from('alert_distribution_list')
      .delete()
      .eq('id', parseInt(id));

    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error removing from distribution list:', error);
    return NextResponse.json({ error: 'Failed to remove' }, { status: 500 });
  }
}
