import type { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import type { OnboardingPhase } from '@/domain/value-objects/onboarding-phase'

/**
 * Contract for the `tenant_onboarding_state` writer/reader. The Supabase
 * implementation is the SOLE writer (service role bypasses RLS); there are
 * no INSERT/UPDATE policies on the table by design.
 */
export interface TenantOnboardingStateRepository {
  /** Returns the row for a tenant, or null when none exists. */
  findByRestaurantId(restaurantId: string): Promise<TenantOnboardingState | null>

  /**
   * Insert a fresh default row. Idempotent: callers that lose a race for
   * insertion should fall back to `findByRestaurantId`. Implementations
   * propagate raw DB errors so the caller can decide the strategy.
   */
  insert(state: TenantOnboardingState): Promise<void>

  /**
   * Persist path / checklist updates with optimistic concurrency. Issues
   * `UPDATE … WHERE id = $id AND phase = $expectedPhase`; if 0 rows match,
   * the row has already advanced and the impl throws `ConcurrentAdvanceError`.
   * Callers that want the surface error to read as a path-locked situation
   * (e.g. `setOnboardingPath`) catch and rethrow as `OnboardingPathLockedError`.
   */
  update(state: TenantOnboardingState, expectedPhase: OnboardingPhase): Promise<void>

  /**
   * Optimistic-concurrency advance. Issues
   * `UPDATE … WHERE id = $id AND phase = $expectedFrom`; if 0 rows match,
   * throws `ConcurrentAdvanceError`. Returns the persisted entity.
   */
  advance(
    state: TenantOnboardingState,
    expectedFrom: OnboardingPhase
  ): Promise<TenantOnboardingState>
}
