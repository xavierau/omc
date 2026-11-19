/**
 * AGENT-001 W2 (R7): read and save a restaurant's AI reply agent settings.
 *
 * Mirrors settings/booking: GET for any tenant member, PUT admin only
 * (`requireTenantAdmin`). The restaurant id comes from the session, never the
 * body. The PUT is a compare-and-swap on the rev the form was loaded with
 * (409 when the config changed meanwhile), and the body is merged onto the
 * stored config and run through `resolveAgentConfig`, so clamping has one
 * source of truth; fields it changed come back in `adjusted`.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { isTenantAdmin, requireTenantAdmin } from '@/infrastructure/supabase/guards/require-tenant-admin'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getAgentSettings, saveAgentSettingsAtRev } from '@/infrastructure/supabase/repositories/agent-config-repository'
import { isSettingsObject, mergeAgentSettings, type MergedAgentSettings } from '@/domain/services/agent-settings'

function authError(error: unknown) {
  return error instanceof AuthError ? NextResponse.json({ error: error.message }, { status: error.statusCode }) : null
}

export async function GET() {
  try {
    const ctx = await getTenantContext()
    const { config, rev } = await getAgentSettings(ctx.restaurantId)
    return NextResponse.json({ config, rev, canEdit: isTenantAdmin(ctx) })
  } catch (error) {
    const denied = authError(error)
    if (denied) return denied
    console.error('[AgentSettings] read failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to load agent settings' }, { status: 500 })
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
    if (!isSettingsObject(body) || !Number.isInteger(body.rev) || !isSettingsObject(body.config)) {
      return NextResponse.json({ error: 'invalid', fields: { body: 'rev_and_config_required' } }, { status: 400 })
    }
    const input = body.config
    let merged: MergedAgentSettings | null = null
    const result = await saveAgentSettingsAtRev(ctx.restaurantId, body.rev as number, (current) => {
      merged = mergeAgentSettings(current, input)
      return merged.config
    })
    if (result.kind === 'stale') return NextResponse.json({ error: 'stale', rev: result.rev }, { status: 409 })
    const adjusted = (merged as MergedAgentSettings | null)?.adjusted ?? []
    return NextResponse.json({ success: true, config: result.config, rev: result.rev, adjusted })
  } catch (error) {
    const denied = authError(error)
    if (denied) return denied
    console.error('[AgentSettings] update failed:', (error as Error).message)
    return NextResponse.json({ error: 'Failed to update agent settings' }, { status: 500 })
  }
}
