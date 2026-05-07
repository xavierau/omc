import type { QualityStateEvent } from '../entities/quality-state-event'

export interface FindLatestArgs {
  restaurantId: string
  /**
   * Optional phone-number-id filter. A tenant can have multiple phone
   * numbers under one WABA; without this filter the result interleaves
   * history from every phone. Pass it for per-phone health checks; omit
   * it for tenant-wide dashboard rollups.
   */
  phoneNumberId?: string
}

/**
 * Contract for the `tenant_quality_state` writer/reader. The Supabase
 * implementation lives in `src/infrastructure/supabase/repositories/`
 * and is the SOLE writer to the table (service role bypasses RLS).
 *
 * This is an append-only history; `findLatest` materialises the most
 * recent transition per tenant via an indexed scan.
 */
export interface QualityStateRepository {
  /** Append a new transition row. Errors propagate so the webhook handler
   * can decide retryability. */
  insertEvent(event: QualityStateEvent): Promise<void>

  /** Returns the most recent transition for a tenant, or null if no
   * quality signal has ever been recorded. */
  findLatest(args: FindLatestArgs): Promise<QualityStateEvent | null>

  /**
   * WONB-008 Q-H: thin wrapper around the `tenant_green_for_days(restaurant,
   * days)` SQL RPC. Returns true iff the tenant is currently GREEN AND has
   * been continuously GREEN for ≥ `minDays`. Strict semantics: any non-GREEN
   * transition within the window disqualifies. The pure-function mirror in
   * `src/domain/services/is-green-for-at-least.ts` is used by tests so we
   * don't need a live database to verify the boundary math.
   */
  isGreenForDays(restaurantId: string, minDays: number): Promise<boolean>
}
