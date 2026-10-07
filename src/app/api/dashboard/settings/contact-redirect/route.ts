import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { updateRestaurantRedirect } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { isValidPhoneE164 } from '@/infrastructure/validation/validators'

const DEFAULT_LABEL = 'Contact us'
const MAX_LABEL = 20

type ParsedRedirect = { redirectNumber: string | null; redirectLabel: string }

function parseRedirect(body: {
  redirectNumber?: unknown
  redirectLabel?: unknown
}): ParsedRedirect | { error: string } {
  const number =
    typeof body.redirectNumber === 'string' ? body.redirectNumber.trim() : ''
  if (number !== '' && !isValidPhoneE164(number)) {
    return { error: 'Invalid redirect number' }
  }
  const label =
    typeof body.redirectLabel === 'string' ? body.redirectLabel.trim() : ''
  if (label.length > MAX_LABEL) {
    return { error: 'Redirect label must be 20 characters or fewer' }
  }
  return {
    redirectNumber: number === '' ? null : number,
    redirectLabel: label === '' ? DEFAULT_LABEL : label,
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Tenant scoping is app-layer: the restaurant id comes from the
    // authenticated session, never from the client-supplied body.
    const { restaurantId } = await getTenantContext()
    const body = await request.json()
    const parsed = parseRedirect(body)
    if ('error' in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    await updateRestaurantRedirect(restaurantId, parsed)

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Contact redirect update error:', error)
    return NextResponse.json(
      { error: 'Failed to update contact redirect' },
      { status: 500 }
    )
  }
}
