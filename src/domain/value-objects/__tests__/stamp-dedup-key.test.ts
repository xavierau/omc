import { describe, it, expect } from 'vitest'
import {
  hkLocalDateString,
  buildStampDedupKey,
} from '../stamp-dedup-key'

const CAMPAIGN = '11111111-1111-1111-1111-111111111111'

describe('hkLocalDateString', () => {
  it('formats a UTC instant to the HK-local calendar day (YYYY-MM-DD)', () => {
    // 2026-06-09T12:00:00Z == 2026-06-09 20:00 HKT → same day
    expect(hkLocalDateString(new Date('2026-06-09T12:00:00.000Z'))).toBe(
      '2026-06-09'
    )
  })

  it('rolls to the next HK day for a late-evening UTC instant', () => {
    // 2026-06-09T17:00:00Z == 2026-06-10 01:00 HKT → next HK day
    expect(hkLocalDateString(new Date('2026-06-09T17:00:00.000Z'))).toBe(
      '2026-06-10'
    )
  })

  it('keeps 23:30 and 23:45 HKT on the same HK day', () => {
    // 2026-06-09 23:30 HKT == 2026-06-09T15:30:00Z
    // 2026-06-09 23:45 HKT == 2026-06-09T15:45:00Z
    const a = hkLocalDateString(new Date('2026-06-09T15:30:00.000Z'))
    const b = hkLocalDateString(new Date('2026-06-09T15:45:00.000Z'))
    expect(a).toBe('2026-06-09')
    expect(b).toBe('2026-06-09')
    expect(a).toBe(b)
  })

  it('splits 23:00 HKT and next-day 01:00 HKT into different HK days', () => {
    // 2026-06-09 23:00 HKT == 2026-06-09T15:00:00Z
    // 2026-06-10 01:00 HKT == 2026-06-09T17:00:00Z
    const day1 = hkLocalDateString(new Date('2026-06-09T15:00:00.000Z'))
    const day2 = hkLocalDateString(new Date('2026-06-09T17:00:00.000Z'))
    expect(day1).toBe('2026-06-09')
    expect(day2).toBe('2026-06-10')
    expect(day1).not.toBe(day2)
  })

  it('does not call Date.now (pure on its argument)', () => {
    const fixed = new Date('2026-01-01T00:00:00.000Z')
    expect(hkLocalDateString(fixed)).toBe(hkLocalDateString(fixed))
  })
})

describe('buildStampDedupKey', () => {
  it('builds campaignId:date for the default (cap=1) case', () => {
    expect(
      buildStampDedupKey({ campaignId: CAMPAIGN, stampDate: '2026-06-09' })
    ).toBe(`${CAMPAIGN}:2026-06-09`)
  })

  it('omits the sequence suffix when sequence is undefined', () => {
    const key = buildStampDedupKey({
      campaignId: CAMPAIGN,
      stampDate: '2026-06-09',
    })
    expect(key.split(':').length).toBe(2)
  })

  it('appends :N when a sequence is supplied (cap>1)', () => {
    expect(
      buildStampDedupKey({
        campaignId: CAMPAIGN,
        stampDate: '2026-06-09',
        sequence: 2,
      })
    ).toBe(`${CAMPAIGN}:2026-06-09:2`)
  })

  it('treats sequence 1 as an explicit first in-day slot', () => {
    expect(
      buildStampDedupKey({
        campaignId: CAMPAIGN,
        stampDate: '2026-06-09',
        sequence: 1,
      })
    ).toBe(`${CAMPAIGN}:2026-06-09:1`)
  })

  it('is deterministic for identical inputs', () => {
    const args = { campaignId: CAMPAIGN, stampDate: '2026-06-09', sequence: 3 }
    expect(buildStampDedupKey(args)).toBe(buildStampDedupKey(args))
  })

  it('rejects an empty campaignId', () => {
    expect(() =>
      buildStampDedupKey({ campaignId: '', stampDate: '2026-06-09' })
    ).toThrow(/campaignId/)
  })

  it('rejects an empty stampDate', () => {
    expect(() =>
      buildStampDedupKey({ campaignId: CAMPAIGN, stampDate: '' })
    ).toThrow(/stampDate/)
  })

  it('rejects a non-positive sequence', () => {
    expect(() =>
      buildStampDedupKey({
        campaignId: CAMPAIGN,
        stampDate: '2026-06-09',
        sequence: 0,
      })
    ).toThrow(/sequence/)
  })
})
