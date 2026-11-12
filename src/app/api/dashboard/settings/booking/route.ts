/**
 * BOOK-001 AC-1/AC-2/AC-3: save a restaurant's booking settings.
 *
 * Admin only (`requireTenantAdmin`; owner 2026-11-12, stricter than the other
 * settings routes, R14): the external URL is sent to every diner, so staff
 * must not be able to point it at a phishing page. The restaurant id comes
 * from the session, never the body.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getBookingConfig, updateBookingConfig } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { parseBookingSettings } from '@/domain/value-objects/booking-config'

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
    }
    const result = parseBookingSettings(body, await getBookingConfig(ctx.restaurantId))
    if (!result.ok) return NextResponse.json({ error: 'invalid', fields: result.errors }, { status: 400 })
    await updateBookingConfig(ctx.restaurantId, result.config)
    return NextResponse.json({ success: true, config: result.config })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('[BookingSettings] update failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to update booking settings' }, { status: 500 })
  }
}
