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

  // F8 (review #6): the reminder text names the booking date, not "today".
  it('writes the reminder with the booking date in both languages, never "today"', () => {
    const details = { restaurantName: 'Kushiro', name: 'Chan', date: '2026-11-13', time: '00:30', partySize: 2 }
    for (const lang of ['en', 'zh_hk'] as const) {
      const text = buildBookingText('reminder', lang, details)
      expect(text, lang).toContain('2026-11-13')
      expect(text, lang).toContain('00:30')
      expect(text, lang).not.toMatch(/today|今天|今日/i)
    }
  })

  it('includes a decline reason only when given', () => {
    expect(buildBookingText('declined', 'en', details)).not.toContain('Reason')
    expect(buildBookingText('declined', 'en', { ...details, declineReason: 'Full' })).toContain('Reason: Full')
  })
})

// BOOK-001 F3: the free-form fallback says what the owner-approved
// templates say (2026-11-12).
describe('booking text fallback copy (F3)', () => {
  const d = { ...details, declineReason: 'Fully booked' }

  it.each([
    ['confirmed', 'en', 'Your table booking is confirmed. Restaurant: Kushiro. Date: 2026-11-13. Time: 19:30. Party size: 4. If your plans change, please reply to this message to let the restaurant know.'],
    ['confirmed', 'zh_hk', '你的訂座已確認。餐廳:Kushiro。日期:2026-11-13。時間:19:30。人數:4位。如行程有變,請直接回覆此訊息通知餐廳。'],
    ['declined', 'en', 'Sorry, the restaurant could not accept your booking request for 2026-11-13 at 19:30. Reason: Fully booked. You are welcome to choose another time and send a new request.'],
    ['declined', 'zh_hk', '很抱歉,餐廳未能接受你在2026-11-13 19:30的訂座要求。原因:Fully booked。歡迎選擇其他時間再次提交訂座要求。'],
    ['reminder', 'en', 'This is a reminder of your upcoming table booking at Kushiro on 2026-11-13 at 19:30. If you can no longer make it, please reply to this message to let the restaurant know.'],
    // BOOK-002 F1: the zh_HK reminder copy the owner approved on 2026-11-13.
    ['reminder', 'zh_hk', '提提你,你在Kushiro的訂座將於2026-11-13 19:30開始。如未能出席,請直接回覆此訊息通知餐廳。'],
  ] as const)('%s/%s uses the approved copy', (kind, lang, text) => {
    expect(buildBookingText(kind, lang, d)).toBe(text)
  })

  it('leaves the reason sentence out of a declined text when none is given', () => {
    expect(buildBookingText('declined', 'en', details)).toBe(
      'Sorry, the restaurant could not accept your booking request for 2026-11-13 at 19:30. You are welcome to choose another time and send a new request.'
    )
    expect(buildBookingText('declined', 'zh_hk', details)).toBe(
      '很抱歉,餐廳未能接受你在2026-11-13 19:30的訂座要求。歡迎選擇其他時間再次提交訂座要求。'
    )
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
