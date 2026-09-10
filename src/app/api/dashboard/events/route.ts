import { NextRequest, NextResponse } from 'next/server'
import { getEvents } from '@/infrastructure/supabase/repositories/event-repository'
import { EVENTS_PAGE_SIZE } from '@/lib/constants'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await getTenantContext()
    const { searchParams } = request.nextUrl
    const type = searchParams.get('type') ?? undefined
    const limit = parseInt(searchParams.get('limit') ?? String(EVENTS_PAGE_SIZE), 10)

    const events = await getEvents({ restaurantId, limit, type })
    return NextResponse.json({ events })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Events API error:', error)
    return NextResponse.json({ error: 'Failed to load events' }, { status: 500 })
  }
}
