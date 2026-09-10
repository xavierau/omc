// INT-001 WI-3: pure welcome DECISION (spec US-4, plan §"Member-create job
// (worker)" step 6). This function only decides an outcome + optional
// detail; it never sends anything, never mints a coupon, and never touches
// I/O. `process-member-create-job.ts` gathers the inputs (template
// resolution, tenant quality-pause, hourly-cap check, post-write consent
// status) and, on `{ outcome: 'queued' }`, enqueues a `welcome-send` job
// (WI-4 owns that job's processor) and records this outcome on the
// `integration_member_jobs` row's `welcome_outcome`/`welcome_detail`
// columns -- never in the partner-facing job result (OD-11).
//
// Evaluation order (dependency-respecting reading of the plan's prose list,
// which states the rules but not their true dependency order -- you cannot
// know a template's CATEGORY, and therefore cannot check that category's
// consent status, before the template itself has been resolved):
//   existing -> by_request -> off -> member unsubscribed -> template
//   resolution -> category opted_out -> category consent level -> quality
//   paused -> rate capped -> queued.

import type { ConsentLevel } from '@/domain/value-objects/consent-level'
import { covers, requiredLevelFor, type PartnerConsentCategory } from '@/domain/value-objects/consent-level'
import type { ConsentStatus } from '@/domain/value-objects/consent-status'

export type WelcomeTemplateCategory = 'MARKETING' | 'UTILITY'

export type TemplateResolution =
  | { found: false }
  | { found: true; templateId: string; category: WelcomeTemplateCategory }

export interface DecideWelcomeInput {
  /** The member-create outcome -- an existing member never gets a welcome (D1). */
  memberOutcome: 'created' | 'existing'
  /** Request's `send_welcome` flag (default true upstream -- D5: suppresses only, never forces). */
  sendWelcomeRequested: boolean
  /** Integration setting `new_join_template_id` -- null means "send nothing" (OD-3 default). */
  newJoinTemplateId: string | null
  /** The member's status AFTER create-or-get (never reactivated by this path). */
  memberStatus: 'active' | 'unsubscribed'
  /** Result of resolving `newJoinTemplateId` to a real, tenant-owned, approved template.
   * Only meaningful once `newJoinTemplateId` is non-null; the caller may pass
   * `{ found: false }` unconditionally when it is null (short-circuited before use). */
  template: TemplateResolution
  /** Latest consent status for the RESOLVED template's own category, after
   * this request's consent write -- null when `template.found` is false
   * (not yet knowable, and not needed). */
  categoryStatus: ConsentStatus | null
  /** Effective consent level after this request's consent write (D6). */
  effectiveLevel: ConsentLevel
  tenantAutoPaused: boolean
  hourlyCapExceeded: boolean
}

export type WelcomeDecision =
  | { outcome: 'skipped_existing' }
  | { outcome: 'skipped_by_request' }
  | { outcome: 'skipped_off' }
  | { outcome: 'skipped_opted_out' }
  | { outcome: 'skipped_no_template' }
  | { outcome: 'skipped_consent_level'; requiredLevel: ConsentLevel; effectiveLevel: ConsentLevel }
  | { outcome: 'skipped_quality_paused' }
  | { outcome: 'skipped_rate_capped' }
  | { outcome: 'queued'; templateId: string; category: WelcomeTemplateCategory }

function toPartnerCategory(category: WelcomeTemplateCategory): PartnerConsentCategory {
  return category === 'MARKETING' ? 'marketing' : 'utility'
}

export function decideWelcome(input: DecideWelcomeInput): WelcomeDecision {
  if (input.memberOutcome === 'existing') return { outcome: 'skipped_existing' }
  if (!input.sendWelcomeRequested) return { outcome: 'skipped_by_request' }
  if (input.newJoinTemplateId === null) return { outcome: 'skipped_off' }
  if (input.memberStatus === 'unsubscribed') return { outcome: 'skipped_opted_out' }
  if (!input.template.found) return { outcome: 'skipped_no_template' }

  const category = toPartnerCategory(input.template.category)
  if (input.categoryStatus === 'opted_out') return { outcome: 'skipped_opted_out' }
  if (!covers(input.effectiveLevel, category)) {
    return {
      outcome: 'skipped_consent_level',
      requiredLevel: requiredLevelFor(category),
      effectiveLevel: input.effectiveLevel,
    }
  }
  if (input.tenantAutoPaused) return { outcome: 'skipped_quality_paused' }
  if (input.hourlyCapExceeded) return { outcome: 'skipped_rate_capped' }

  return { outcome: 'queued', templateId: input.template.templateId, category: input.template.category }
}
