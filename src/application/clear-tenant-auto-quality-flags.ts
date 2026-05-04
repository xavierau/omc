// WAQ-009: platform-admin override that drops a tenant out of the auto
// throttle / auto-pause state. Authorization is enforced natively at this
// layer (defense in depth): the route layer SHOULD also call
// `assertPlatformAdmin`, but we double-check here so a future route author
// who forgets the route-layer guard cannot let a tenant user clear their
// own auto-pause.
//
// Audit logging is best-effort (logAdminAction is fire-and-forget). The
// repo write is the source of truth for state change; we only audit AFTER
// the repo write succeeds so a failure to clear does not leave a misleading
// audit trail.

import { clearAutoQualityFlags } from '@/infrastructure/supabase/repositories/quality-auto-flags'
import { logAdminAction } from '@/infrastructure/supabase/audit-logger'
import { ForbiddenError } from './forbidden-error'

const PLATFORM_ADMIN_ROLE = 'platform_admin'

export interface ClearTenantAutoQualityFlagsArgs {
  restaurantId: string
  actor: { userId: string; role: string }
}

export async function clearTenantAutoQualityFlags(
  args: ClearTenantAutoQualityFlagsArgs
): Promise<void> {
  validate(args)
  assertActorIsPlatformAdmin(args.actor)
  await clearAutoQualityFlags(args.restaurantId)
  logAdminAction({
    userId: args.actor.userId,
    action: 'tenant.clear_auto_quality_flags',
    resourceType: 'tenant_campaign_settings',
    resourceId: args.restaurantId,
    details: { restaurantId: args.restaurantId, actorRole: args.actor.role },
  })
}

function validate(args: ClearTenantAutoQualityFlagsArgs): void {
  if (!args.restaurantId || !args.restaurantId.trim()) {
    throw new Error('clearTenantAutoQualityFlags: restaurantId is required')
  }
  if (!args.actor?.userId || !args.actor.userId.trim()) {
    throw new Error('clearTenantAutoQualityFlags: actor.userId is required')
  }
}

function assertActorIsPlatformAdmin(actor: { role: string }): void {
  if (actor.role !== PLATFORM_ADMIN_ROLE) {
    throw new ForbiddenError(
      `clearTenantAutoQualityFlags: requires ${PLATFORM_ADMIN_ROLE}, got '${actor.role || 'none'}'`
    )
  }
}
