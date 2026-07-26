import { NextRequest, NextResponse } from 'next/server'
import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { updateContactConfig } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { validateContactConfig } from '@/domain/services/contact-config'
import { ensureContactFlowDeployed } from '@/application/ensure-contact-flow-deployed'

export async function PATCH(request: NextRequest) {
  try {
    // Tenant scoping is app-layer: the restaurant id comes from the
    // authenticated session, never from the client-supplied body.
    const { restaurantId } = await getTenantContext()
    const body = await request.json()

    const result = validateContactConfig(body)
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    await updateContactConfig(restaurantId, result.config)

    // REPLY-007 AD-4: form-mode save self-serves the per-tenant Flow deploy.
    // A deploy failure must NOT fail this response — the config above is
    // already persisted, and retrying the save here would just re-store the
    // same config while the runtime safely degrades to the redirect CTA
    // until a later deploy succeeds.
    if (result.config.mode === 'form') {
      const deployResult = await ensureContactFlowDeployed(restaurantId)
      const flowDeploy = deployResult.ok
        ? { ok: true as const }
        : { ok: false as const, error: deployResult.error }
      return NextResponse.json({ success: true, flowDeploy })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode })
    }
    console.error('Contact config update error:', error)
    return NextResponse.json(
      { error: 'Failed to update contact config' },
      { status: 500 }
    )
  }
}
