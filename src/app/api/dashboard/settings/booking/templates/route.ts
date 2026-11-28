/**
 * BOOK-002 (AC-2, AC-4, AC-5, AC-6): change or reset one booking message's
 * text, per kind × language.
 *
 * Admin only (`requireTenantAdmin`, checked first; R14/R22) and only in Simple
 * mode (409 otherwise). The restaurant id comes from the session, never the
 * body. Body `{kind, language, body: string | null}`; null resets to the
 * default copy. Validation errors → 400 `{errors}` with nothing stored or
 * submitted; a success returns the warnings and the refreshed overview.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { bookingTemplateOverviewFor, editBookingTemplateFor } from '@/application/booking/booking-template-deps'
import { TEMPLATE_KINDS, TEMPLATE_LANGUAGES, type BookingTemplateKind } from '@/domain/value-objects/booking-config'
import type { LanguageCode } from '@/domain/value-objects/language'

interface EditRequest {
  kind: BookingTemplateKind
  language: LanguageCode
  body: string | null
}

const FIELDS = ['kind', 'language', 'body']

function parseEditRequest(raw: unknown): EditRequest | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (Object.keys(r).some((k) => !FIELDS.includes(k))) return null
  if (!TEMPLATE_KINDS.includes(r.kind as BookingTemplateKind)) return null
  if (!TEMPLATE_LANGUAGES.includes(r.language as LanguageCode)) return null
  if (r.body !== null && typeof r.body !== 'string') return null
  return { kind: r.kind as BookingTemplateKind, language: r.language as LanguageCode, body: r.body }
}

async function readEditRequest(request: NextRequest): Promise<EditRequest | null> {
  try {
    return parseEditRequest(await request.json())
  } catch {
    return null
  }
}

export async function PUT(request: NextRequest) {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const input = await readEditRequest(request)
    if (!input) return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
    const result = await editBookingTemplateFor({ restaurantId: ctx.restaurantId, ...input })
    if (!result.ok && result.reason === 'not_simple') return NextResponse.json({ error: 'booking_mode_not_simple' }, { status: 409 })
    if (!result.ok) return NextResponse.json({ error: 'invalid', errors: result.errors }, { status: 400 })
    const overview = await bookingTemplateOverviewFor(ctx.restaurantId)
    return NextResponse.json({ success: true, warnings: result.warnings, ...overview })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.statusCode })
    console.error('[BookingTemplates] edit failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to save the message' }, { status: 500 })
  }
}
