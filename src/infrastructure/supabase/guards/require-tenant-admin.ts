import { AuthError } from './auth-guard'
import type { TenantContext } from './tenant-guard'

/**
 * Explicit allowlist: only the 'admin' role may perform state-changing
 * integration-settings actions (PATCH, DELETE, secret rotation). Guards
 * against silent permission widening if a future role (e.g. 'viewer') is
 * added to user_tenants.role without updating this check (T-M5).
 */
export function requireTenantAdmin(ctx: Pick<TenantContext, 'role'>): void {
  if (ctx.role !== 'admin') {
    throw new AuthError('Forbidden', 403)
  }
}
