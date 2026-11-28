// BOOK-014 W5 (spec AC-10; threat R62): what a personal agent reads of a deposit hold.
import { describe, it, expect } from 'vitest'
import { agentBookingStatus } from '../agent-booking'
import { agentDepositView, majorUnits } from '../agent-booking-deposit'
import type { BookingDeposit } from '@/domain/entities/booking-deposit'

const NOW = new Date('2026-11-19T02:00:00Z')

const deposit = (over: Partial<BookingDeposit> = {}): BookingDeposit => ({
  id: 'd1', restaurantId: 'r', bookingId: 'b', providerCode: 'test', accountId: 'a', providerAccountId: 'acct', amount: { amountMinor: 40000, currency: 'HKD' },
  status: 'awaiting', holdExpiresAt: '2026-11-19T02:30:00.000Z', providerSessionId: 's', sessionUrl: 'https://pay.test.invalid/s/1',
  providerPaymentRef: null, paidAt: null, refundRef: null, refundReason: null, refundAttempts: 0, decidedBy: null, decidedAt: null,
  createdAt: '2026-11-19T02:00:00.000Z', ...over,
})

describe('agent booking status with deposits', () => {
  it('awaiting_deposit -> awaiting_deposit; lapsed -> expired (the W1 interim mapping is gone)', () => {
    expect(agentBookingStatus('awaiting_deposit', null, NOW)).toBe('awaiting_deposit')
    expect(agentBookingStatus('lapsed', null, NOW)).toBe('expired')
    expect(agentBookingStatus('pending', null, NOW)).toBe('pending')
  })

  it('majorUnits: decimal string, never a float', () => {
    expect(majorUnits({ amountMinor: 40000, currency: 'HKD' })).toBe('400')
    expect(majorUnits({ amountMinor: 1250, currency: 'USD' })).toBe('12.50')
    expect(majorUnits({ amountMinor: 500, currency: 'JPY' })).toBe('500')
  })

  it('R62: payment_url only when the stored URL passes the allow-list; only an awaiting deposit is shown', () => {
    const allow = (url: string) => new URL(url).hostname === 'pay.test.invalid'
    expect(agentDepositView(deposit(), allow)).toEqual({
      payment_url: 'https://pay.test.invalid/s/1',
      deposit: { amount: '400', currency: 'HKD', expires_at: '2026-11-19T02:30:00.000Z' },
    })
    expect(agentDepositView(deposit({ sessionUrl: 'https://evil.example/x' }), allow)).toEqual({
      deposit: { amount: '400', currency: 'HKD', expires_at: '2026-11-19T02:30:00.000Z' },
    })
    expect(agentDepositView(deposit({ status: 'paid' }), allow)).toBeNull()
  })
})
