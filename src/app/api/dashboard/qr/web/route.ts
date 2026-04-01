import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { generateWebQr } from '@/application/generate-web-qr'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'

export async function POST(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    const slug = await fetchRestaurantSlug(ctx.restaurantId)

    const body = await request.json().catch(() => ({}))
    const campaignId = body.campaignId as string | undefined

    const result = await generateWebQr(slug, campaignId)
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Web QR error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function fetchRestaurantSlug(restaurantId: string): Promise<string> {
  const supabase = createServerSupabaseClient()
  const { data, error } = await supabase
    .from('restaurants')
    .select('slug')
    .eq('id', restaurantId)
    .single()

  if (error || !data) {
    throw new Error(`Restaurant not found: ${restaurantId}`)
  }
  return data.slug
}
