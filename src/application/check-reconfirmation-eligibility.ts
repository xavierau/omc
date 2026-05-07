import { checkCampaignGuardrails } from './check-campaign-guardrails'
import {
  isGreenForDays,
  findLatest,
} from '@/infrastructure/supabase/repositories/quality-state-repository'
import { countByGradeStatus } from '@/infrastructure/supabase/repositories/consent-record-repository'
import {
  getReconfirmationDailyCap,
  getReconfirmationSendsToday,
} from '@/infrastructure/supabase/repositories/campaign-settings-repository'
import {
  formatQualityDetail,
  type ReconfirmationEligibilityViolation,
  type ReconfirmationEligibilityViolationKey,
} from '@/domain/services/__errors__/reconfirmation-errors'
import type { QualityStateEvent } from '@/domain/entities/quality-state-event'

const GREEN_MIN_DAYS = 7

interface CheckInput {
  restaurantId: string
}

export interface ReconfirmationEligibilityResult {
  allowed: boolean
  violations: ReconfirmationEligibilityViolation[]
  audienceCount: number
  currentDailySent: number
  cap: number
}

/**
 * WONB-008 pre-flight gate. Composes the existing tenant-wide guardrails
 * (auto-pause + monthly limits) with three reconfirmation-specific checks:
 *   - GREEN-for-7-days quality streak
 *   - non-empty weak+opted_in audience
 *   - per-tenant daily reconfirmation cap not yet reached
 * Reports each gate as a typed violation key so the dialog can render a
 * specific i18n string per failure.
 */
export async function checkReconfirmationEligibility(
  input: CheckInput
): Promise<ReconfirmationEligibilityResult> {
  const [guardrails, green, audienceCount, cap, sentToday, latest] =
    await Promise.all([
      checkCampaignGuardrails(input.restaurantId, 0),
      isGreenForDays(input.restaurantId, GREEN_MIN_DAYS),
      countByGradeStatus({
        restaurantId: input.restaurantId,
        grade: 'weak',
        status: 'opted_in',
        category: 'marketing',
      }),
      getReconfirmationDailyCap(input.restaurantId),
      getReconfirmationSendsToday(input.restaurantId),
      findLatest({ restaurantId: input.restaurantId }),
    ])

  const violations = collectViolations({
    autoPaused: guardrails.usage.autoPauseActive,
    green,
    audienceCount,
    sentToday,
    cap,
    latestQualityEvent: latest,
  })

  return {
    allowed: violations.length === 0,
    violations,
    audienceCount,
    currentDailySent: sentToday,
    cap,
  }
}

interface ViolationsInput {
  autoPaused: boolean
  green: boolean
  audienceCount: number
  sentToday: number
  cap: number
  latestQualityEvent: QualityStateEvent | null
}

function collectViolations(
  input: ViolationsInput
): ReconfirmationEligibilityViolation[] {
  const out: ReconfirmationEligibilityViolation[] = []
  if (input.autoPaused) out.push(violation('auto_paused'))
  if (!input.green) {
    out.push(violation('quality_not_green', formatQualityDetail(input.latestQualityEvent)))
  }
  if (input.audienceCount === 0) out.push(violation('empty_audience'))
  if (input.sentToday >= input.cap) {
    out.push(violation('daily_cap_met', `${input.sentToday}/${input.cap}`))
  }
  return out
}

function violation(
  key: ReconfirmationEligibilityViolationKey,
  detail?: string
): ReconfirmationEligibilityViolation {
  return detail !== undefined ? { key, detail } : { key }
}
