// WAQ-009: platform-admin override that drops a tenant out of the auto
// throttle / auto-pause state. Auth is enforced at the route layer (route
// must call `assertPlatformAdmin` before invoking this); this layer adds
// argument validation + audit-log emission so the action is observable.
//
// Audit logging is best-effort (logAdminAction is fire-and-forget). The
// repo write is the source of truth for state change; we only audit AFTER
// the repo write succeeds so a failure to clear does not leave a misleading
// audit trail.

import { clearAutoQualityFlags } from '@/infrastructure/supabase/repositories/quality-auto-flags'
import { logAdminAction } from '@/infrastructure/supabase/audit-logger'

export interface ClearTenantAutoQualityFlagsArgs {
  restaurantId: string
  actor: { userId: string }
}

export async function clearTenantAutoQualityFlags(
  args: ClearTenantAutoQualityFlagsArgs
): Promise<void> {
  validate(args)
  await clearAutoQualityFlags(args.restaurantId)
  logAdminAction({
    userId: args.actor.userId,
    action: 'tenant.clear_auto_quality_flags',
    resourceType: 'tenant_campaign_settings',
    resourceId: args.restaurantId,
    details: { restaurantId: args.restaurantId },
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
