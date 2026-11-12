import { describe, it, expect } from 'vitest'
import { buildBookingTemplateParams, buildBookingText, sanitizeTemplateParam } from '../booking-message'
import { bookingTokenExpiry, bookingTokenState, isWellFormedBookingToken } from '../booking-token'
import { normalizeDeclineReason } from '@/domain/entities/booking-request'

const details = {
  restaurantName: 'Kushiro',
  name: 'Chan\nTai\tMan',
  date: '2026-11-13',
  time: '19:30',
  partySize: 4,
}

describe('sanitizeTemplateParam (R16)', () => {
  it('flattens newlines and tabs to single spaces', () => {
    expect(sanitizeTemplateParam('a\n\n b\t\tc')).toBe('a b c')
  })

  it('caps by characters', () => {
    expect(sanitizeTemplateParam('陳'.repeat(80), 60)).toBe('陳'.repeat(60))
  })
})

describe('booking message copy', () => {
  it('builds named params without notes and with a one-line name', () => {
    const params = buildBookingTemplateParams({ ...details, notes: 'nut allergy' } as never)
    expect(params).toEqual({
      restaurant: 'Kushiro',
      name: 'Chan Tai Man',
      date: '2026-11-13',
      time: '19:30',
      party_size: '4',
      reason: '-',
    })
    expect(JSON.stringify(params)).not.toContain('allergy')
  })

  it('writes the received text in both languages', () => {
    expect(buildBookingText('received', 'en', details)).toContain('Chan Tai Man')
    expect(buildBookingText('received', 'zh_hk', details)).toContain('已收到')
  })

  it('includes a decline reason only when given', () => {
    expect(buildBookingText('declined', 'en', details)).not.toContain('Reason')
    expect(buildBookingText('declined', 'en', { ...details, declineReason: 'Full' })).toContain('Reason: Full')
  })
})

describe('booking token rules (R1)', () => {
  const now = new Date('2026-11-12T10:00:00Z')

  it('computes expiry from hours, null for no expiry', () => {
    expect(bookingTokenExpiry(now, 24)).toBe('2026-11-13T10:00:00.000Z')
    expect(bookingTokenExpiry(now, null)).toBeNull()
  })

  it('derives state: consumed before expired, null expiry stays valid', () => {
    expect(bookingTokenState(null, now)).toBe('unknown')
    expect(bookingTokenState({ expiresAt: null, consumedAt: null }, now)).toBe('valid')
    expect(bookingTokenState({ expiresAt: '2026-11-12T09:00:00Z', consumedAt: null }, now)).toBe('expired')
    expect(bookingTokenState({ expiresAt: '2026-11-12T09:00:00Z', consumedAt: '2026-11-12T08:00:00Z' }, now)).toBe(
      'consumed'
    )
  })

  it('rejects malformed tokens before any lookup', () => {
    expect(isWellFormedBookingToken('A'.repeat(43))).toBe(true)
    expect(isWellFormedBookingToken('short')).toBe(false)
    expect(isWellFormedBookingToken(`${'A'.repeat(42)}/`)).toBe(false)
  })
})

describe('normalizeDeclineReason', () => {
  it('trims, flattens and caps; empty means none', () => {
    expect(normalizeDeclineReason('  fully\nbooked ')).toBe('fully booked')
    expect(normalizeDeclineReason('   ')).toBeNull()
    expect(normalizeDeclineReason(undefined)).toBeNull()
    expect(normalizeDeclineReason('x'.repeat(300))).toHaveLength(200)
  })
})
