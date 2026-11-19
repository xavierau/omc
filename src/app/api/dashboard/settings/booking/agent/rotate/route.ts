/**
 * BOOK-003 (R43): POST /api/dashboard/settings/booking/agent/rotate, a new
 * agent booking id. The old id answers 404 at once, so the restaurant must
 * host the new poppy.json. Tenant admin only.
 */
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { rotateAgentBookingId } from '@/application/booking/agent-booking-settings'
import { agentBookingSettingsDeps } from '@/application/booking/booking-deps'

export async function POST() {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const config = await rotateAgentBookingId(agentBookingSettingsDeps(), ctx.restaurantId)
    return NextResponse.json({ success: true, agentBooking: config.agentBooking })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.statusCode })
    console.error('[AgentBookingSettings] rotate failed:', (error as Error).name)
    return NextResponse.json({ error: 'Failed to rotate the agent booking id' }, { status: 500 })
  }
}
