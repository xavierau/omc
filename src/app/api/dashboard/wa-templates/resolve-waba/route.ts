import { NextResponse } from 'next/server'
import {
  getRestaurantPhoneNumberId,
  getMetaBusinessAccountId,
  updateMetaBusinessAccountId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { resolveWabaId } from '@/infrastructure/whatsapp/templates'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'

export async function POST() {
  try {
    const { restaurantId } = await getTenantContext()
    const existing = await getMetaBusinessAccountId(restaurantId)
    if (existing) {
      return NextResponse.json({ wabaId: existing })
    }

    const phoneNumberId = await getRestaurantPhoneNumberId(restaurantId)
    if (!phoneNumberId) {
      return NextResponse.json(
        { error: 'No phone number ID configured' },
        { status: 400 }
      )
    }

    const wabaId = await resolveWabaId(phoneNumberId)
    if (!wabaId) {
      return NextResponse.json(
        { error: 'Could not resolve WABA ID from phone number' },
        { status: 502 }
      )
    }

    await updateMetaBusinessAccountId(restaurantId, wabaId)
    return NextResponse.json({ wabaId })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    const message = error instanceof Error ? error.message : 'Failed to resolve WABA ID'
    console.error('Resolve WABA API error:', error)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
