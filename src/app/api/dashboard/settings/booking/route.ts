/**
 * BOOK-001 AC-1/AC-2/AC-3: read and save a restaurant's booking settings.
 *
 * PUT is admin only (`requireTenantAdmin`; owner 2026-11-12, stricter than the
 * other settings routes, R14): the external URL is sent to every diner, so
 * staff must not be able to point it at a phishing page. The restaurant id
 * comes from the session, never the body.
 *
 * W3: saving Simple booking then provisions the booking templates. The
 * settings are saved first and stay saved if provisioning fails; the response
 * carries each template's status. GET (any tenant member: the campaign form
 * needs the mode) returns the mode, the external URL and those statuses.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getBookingConfig, updateBookingConfig } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { parseBookingSettings, type BookingConfig } from '@/domain/value-objects/booking-config'
import { bookingTemplateStatusesFor, provisionBookingTemplatesFor } from '@/application/booking/booking-template-deps'
import type { BookingTemplateStatuses } from '@/domain/services/booking-templates'

function authError(error: unknown) {
  return error instanceof AuthError ? NextResponse.json({ error: error.message }, { status: error.statusCode }) : null
}

export async function GET() {
  try {
    const { restaurantId } = await getTenantContext()
    const [config, templates] = await Promise.all([getBookingConfig(restaurantId), bookingTemplateStatusesFor(restaurantId)])
    return NextResponse.json({ mode: config.mode, externalUrl: config.externalUrl, templates })
  } catch (error) {
    const denied = authError(error)
    if (denied) return denied
    console.error('[BookingSettings] read failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to load booking settings' }, { status: 500 })
  }
}

/** Never fails the save: on a crash, report what is stored. */
async function templatesAfterSave(restaurantId: string, config: BookingConfig): Promise<BookingTemplateStatuses | null> {
  try {
    if (config.mode === 'simple') return await provisionBookingTemplatesFor(restaurantId)
    return await bookingTemplateStatusesFor(restaurantId)
  } catch (error) {
    console.error('[BookingSettings] template provisioning failed:', (error as Error).message)
    return bookingTemplateStatusesFor(restaurantId).catch(() => null)
  }
}

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
    const templates = await templatesAfterSave(ctx.restaurantId, result.config)
    return NextResponse.json({ success: true, config: result.config, templates })
  } catch (error) {
    const denied = authError(error)
    if (denied) return denied
    console.error('[BookingSettings] update failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to update booking settings' }, { status: 500 })
  }
}
