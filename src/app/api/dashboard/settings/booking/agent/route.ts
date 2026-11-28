/**
 * BOOK-003 (R43): PUT /api/dashboard/settings/booking/agent, an admin turns
 * booking through AI agents on or off and sets the website host that serves
 * poppy.json. Tenant admin only; the restaurant comes from the session.
 * Enabling needs Simple booking and a host; the first enable mints the agent
 * booking id. Answers with the stored agent booking settings.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { saveAgentBookingSettings } from '@/application/booking/agent-booking-settings'
import { agentBookingSettingsDeps } from '@/application/booking/booking-deps'

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
    const result = await saveAgentBookingSettings(agentBookingSettingsDeps(), ctx.restaurantId, body)
    if (!result.ok) return NextResponse.json({ error: 'invalid', fields: result.errors }, { status: 400 })
    return NextResponse.json({ success: true, agentBooking: result.config.agentBooking })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.statusCode })
    console.error('[AgentBookingSettings] update failed:', (error as Error).name)
    return NextResponse.json({ error: 'Failed to update agent booking settings' }, { status: 500 })
  }
}
