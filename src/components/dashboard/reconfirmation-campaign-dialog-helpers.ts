import type { PreflightViolation, ViolationKey } from '@/hooks/use-reconfirmation-preflight'

export type { PreflightViolation, ViolationKey }

export interface FormatViolationResult {
  i18nKey: string
  values: Record<string, string>
}

const I18N_KEY_BY_VIOLATION: Record<ViolationKey, string> = {
  quality_not_green: 'preflightFailQualityNotGreen',
  empty_audience: 'preflightFailEmptyAudience',
  daily_cap_met: 'preflightFailDailyCapMet',
  auto_paused: 'preflightFailQualityPaused',
}

function parseQualityDetail(detail: string | undefined): { state: string; since: string } {
  if (!detail) return { state: 'unknown', since: 'unknown' }
  const sinceMatch = detail.match(/since\s+(\S+)/i)
  const stateMatch = detail.match(/^\s*(\S+)/)
  return {
    state: stateMatch?.[1] ?? 'unknown',
    since: sinceMatch?.[1] ?? 'unknown',
  }
}

function parseCapDetail(detail: string | undefined): { sent: string; cap: string } {
  if (!detail) return { sent: '?', cap: '?' }
  const m = detail.match(/(\d+)\s*\/\s*(\d+)/)
  if (!m) return { sent: '?', cap: '?' }
  return { sent: m[1], cap: m[2] }
}

export function formatViolation(v: PreflightViolation): FormatViolationResult {
  const i18nKey = I18N_KEY_BY_VIOLATION[v.key]
  if (v.key === 'quality_not_green') return { i18nKey, values: parseQualityDetail(v.detail) }
  if (v.key === 'daily_cap_met') return { i18nKey, values: parseCapDetail(v.detail) }
  return { i18nKey, values: {} }
}

export interface SubmitEnabledArgs {
  allowed: boolean
  isSubmitting: boolean
  name: string
}

export function isSubmitEnabled({ allowed, isSubmitting, name }: SubmitEnabledArgs): boolean {
  return allowed && !isSubmitting && name.trim().length > 0
}
