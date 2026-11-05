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
}
