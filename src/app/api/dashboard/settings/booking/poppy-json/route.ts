/**
 * BOOK-003 (R43): GET /api/dashboard/settings/booking/poppy-json, the
 * restaurant's poppy.json as a download. The restaurant hosts it at
 * https://{websiteHost}/.well-known/poppy.json (owner decision 1B); we never
 * serve it on our host. Tenant admin only; 409 until agent booking is on, and
 * 409 no_whatsapp_number while the restaurant has no usable WhatsApp number.
 */
import { NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { AgentAppUrlError, generatePoppyJson } from '@/application/booking/agent-booking-settings'
import { agentBookingSettingsDeps } from '@/application/booking/booking-deps'

export async function GET() {
  try {
    const ctx = await getTenantContext()
    requireTenantAdmin(ctx)
    const result = await generatePoppyJson(agentBookingSettingsDeps(), ctx.restaurantId)
    if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 409 })
    return new NextResponse(`${JSON.stringify(result.document, null, 2)}\n`, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': 'attachment; filename="poppy.json"',
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.statusCode })
    console.error('[AgentBookingSettings] poppy.json failed:', (error as Error).name)
    // F6: no usable NEXT_PUBLIC_APP_URL, so no absolute OpenAPI URL to put in the file.
    if (error instanceof AgentAppUrlError) return NextResponse.json({ error: 'server_error' }, { status: 500 })
    return NextResponse.json({ error: 'Failed to generate poppy.json' }, { status: 500 })
  }
}
