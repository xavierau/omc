import { describe, it, expect } from 'vitest'
import {
  formatViolation,
  isSubmitEnabled,
  type PreflightViolation,
} from '@/components/dashboard/reconfirmation-campaign-dialog-helpers'

describe('formatViolation', () => {
  it('maps quality_not_green to its i18n key with state/since', () => {
    const v: PreflightViolation = {
      key: 'quality_not_green',
      detail: 'YELLOW since 2026-04-30',
    }
    expect(formatViolation(v)).toEqual({
      i18nKey: 'preflightFailQualityNotGreen',
      values: { state: 'YELLOW', since: '2026-04-30' },
    })
  })

  it('uses fallback values when quality_not_green has no detail', () => {
    expect(formatViolation({ key: 'quality_not_green' })).toEqual({
      i18nKey: 'preflightFailQualityNotGreen',
      values: { state: 'unknown', since: 'unknown' },
    })
  })

  it('maps empty_audience without dynamic values', () => {
    expect(formatViolation({ key: 'empty_audience' })).toEqual({
      i18nKey: 'preflightFailEmptyAudience',
      values: {},
    })
  })

  it('maps daily_cap_met to its i18n key with sent/cap parsed from detail', () => {
    expect(formatViolation({ key: 'daily_cap_met', detail: '50/50' })).toEqual({
      i18nKey: 'preflightFailDailyCapMet',
      values: { sent: '50', cap: '50' },
    })
  })

  it('falls back to unknown when daily_cap_met detail is missing', () => {
    expect(formatViolation({ key: 'daily_cap_met' })).toEqual({
      i18nKey: 'preflightFailDailyCapMet',
      values: { sent: '?', cap: '?' },
    })
  })

  it('maps auto_paused to the quality-paused i18n key', () => {
    expect(formatViolation({ key: 'auto_paused' })).toEqual({
      i18nKey: 'preflightFailQualityPaused',
      values: {},
    })
  })
})

describe('isSubmitEnabled', () => {
  it('returns true only when allowed && not submitting && name set', () => {
    expect(
      isSubmitEnabled({ allowed: true, isSubmitting: false, name: 'My' })
    ).toBe(true)
  })

  it('returns false when not allowed', () => {
    expect(
      isSubmitEnabled({ allowed: false, isSubmitting: false, name: 'My' })
    ).toBe(false)
  })

  it('returns false while submitting', () => {
    expect(
      isSubmitEnabled({ allowed: true, isSubmitting: true, name: 'My' })
    ).toBe(false)
  })

  it('returns false when name is empty or whitespace', () => {
    expect(
      isSubmitEnabled({ allowed: true, isSubmitting: false, name: '' })
    ).toBe(false)
    expect(
      isSubmitEnabled({ allowed: true, isSubmitting: false, name: '   ' })
    ).toBe(false)
  })
})
