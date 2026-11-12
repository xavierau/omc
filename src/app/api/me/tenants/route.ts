import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { createAuthServerClient } from '@/infrastructure/supabase/auth-client'

export async function GET() {
  try {
    const supabase = await createAuthServerClient(cookies())
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const { data, error } = await supabase
      .from('user_tenants')
      .select('restaurant_id, role, restaurants(id, name, slug)')
      .eq('user_id', user.id)

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch tenants' },
        { status: 500 }
      )
    }

    const tenants = (data ?? []).map((row) => {
      const r = row.restaurants as unknown as {
        id: string
        name: string
        slug: string
      }
      return {
        id: r.id,
        name: r.name,
        slug: r.slug,
        role: row.role,
      }
    })

    return NextResponse.json(tenants)
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
