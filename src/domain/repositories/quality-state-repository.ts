import type { QualityStateEvent } from '../entities/quality-state-event'

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
  findLatest(restaurantId: string): Promise<QualityStateEvent | null>
}
