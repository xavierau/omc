import { describe, it, expect } from 'vitest'
import {
  buildQualityVerdict,
  isPmmThrottled,
  type QualityEvidence,
} from '@/components/dashboard/member-detail-helpers'

const fmt = (iso: string) => `D(${iso})`

function evidence(over: Partial<QualityEvidence['quality']>, extra: Partial<QualityEvidence> = {}): QualityEvidence {
  return {
    quality: { rating: 'yellow', deliveryRate: 0.7, sampleSize: 10, reason: 'meets_yellow', ...over },
    windowDays: 90,
    thresholds: { green: 0.9, yellow: 0.6 },
    counts: { delivered: 7, read: 3, failed: 3, pending: 0 },
    unreachableAt: null,
    pmmThrottledUntil: null,
    recentMessages: [],
    ...extra,
  }
}

describe('buildQualityVerdict', () => {
  it('yellow quotes rate, window and the Green threshold from the payload', () => {
    expect(buildQualityVerdict(evidence({}), fmt)).toEqual({
      key: 'qualityVerdictYellow',
      values: { delivered: 7, total: 10, rate: 70, days: 90, green: 90 },
    })
  })

  it('green meets the green threshold', () => {
    const v = buildQualityVerdict(evidence({ rating: 'green', deliveryRate: 0.95, reason: 'meets_green' }), fmt)
    expect(v.key).toBe('qualityVerdictGreen')
    expect(v.values).toMatchObject({ rate: 95, green: 90 })
  })

  it('below_yellow quotes the Yellow threshold', () => {
    const v = buildQualityVerdict(evidence({ rating: 'red', deliveryRate: 0.5, reason: 'below_yellow' }), fmt)
    expect(v).toEqual({
      key: 'qualityVerdictRed',
      values: { delivered: 7, total: 10, rate: 50, days: 90, yellow: 60 },
    })
  })

  it('unreachable names error 131026 and the formatted date', () => {
    const v = buildQualityVerdict(
      evidence({ rating: 'red', reason: 'unreachable' }, { unreachableAt: '2026-09-01T00:00:00Z' }),
      fmt
    )
    expect(v).toEqual({ key: 'qualityVerdictUnreachable', values: { date: 'D(2026-09-01T00:00:00Z)' } })
  })

  it('no_data quotes the window', () => {
    const v = buildQualityVerdict(
      evidence({ rating: 'unknown', deliveryRate: null, sampleSize: 0, reason: 'no_data' }),
      fmt
    )
    expect(v).toEqual({ key: 'qualityVerdictNoData', values: { days: 90 } })
  })
})

describe('isPmmThrottled', () => {
  const now = new Date('2026-10-07T00:00:00Z')
  it('is true only for a future timestamp', () => {
    expect(isPmmThrottled('2026-10-08T00:00:00Z', now)).toBe(true)
    expect(isPmmThrottled('2026-10-06T00:00:00Z', now)).toBe(false)
    expect(isPmmThrottled(null, now)).toBe(false)
  })
})
