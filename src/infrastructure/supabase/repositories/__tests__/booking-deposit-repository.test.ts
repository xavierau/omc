// BOOK-014 W4 (found on the local walk, real PostgREST): the deposit RPCs return
// snake_case rows; the store hands back BookingDeposit with every field mapped
// (the payment ref and the refund attempt drive the provider refund, R56).
// The fakes never went through this mapping, so a row mapped twice (all fields
// but id/status undefined) reached the refund as `not_refundable`.
import { describe, it, expect, vi } from 'vitest'
import { recordingSupabase } from '@/test-utils/recording-supabase'

vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { bookingDepositStore } from '../booking-deposit-repository'

const ROW = {
  id: 'd-1', restaurant_id: 'r-a', booking_id: 'b-1', account_id: 'a-1', provider_code: 'stripe', provider_account_id: 'acct_1',
  amount_minor: 40000, currency: 'HKD', status: 'refund_pending', hold_expires_at: 'h', provider_session_id: 'cs_1',
  session_url: 'https://checkout.stripe.com/c/pay/cs_1', link_token_hash: 'f'.repeat(64), provider_payment_ref: 'pi_1',
  paid_at: 'p', refund_ref: null, refund_reason: 'declined', refund_attempts: 1, decided_by: 'u', decided_at: 'd', created_at: 'c',
}

const store = (data: unknown) => {
  const rec = recordingSupabase([{ data }])
  vi.mocked(createServerSupabaseClient).mockReturnValue(rec.client as never)
  return rec
}

describe('bookingDepositStore: RPC rows -> BookingDeposit (mapped once)', () => {
  it('beginRefund returns the payment ref and the attempt the refund needs', async () => {
    store([ROW])
    const begun = await bookingDepositStore.beginRefund({
      depositId: 'd-1', restaurantId: 'r-a', from: 'paid', reason: 'declined', bookingStatuses: ['declined'], actor: { kind: 'user', userId: 'u' }, at: new Date(),
    })
    expect(begun).toMatchObject({ id: 'd-1', status: 'refund_pending', providerPaymentRef: 'pi_1', refundAttempts: 1, providerAccountId: 'acct_1', amount: { amountMinor: 40000, currency: 'HKD' } })
  })

  it('finishRefund sends the attempt and maps the row', async () => {
    const rec = store([{ ...ROW, status: 'refunded', refund_ref: 're_1' }])
    const done = await bookingDepositStore.finishRefund({ depositId: 'd-1', attempt: 1, outcome: 'refunded', refundRef: 're_1', actor: 'provider' })
    expect(rec.queries[0].calls[0][1]).toMatchObject({ p_attempt: 1 })
    expect(done).toMatchObject({ status: 'refunded', refundRef: 're_1', refundReason: 'declined', bookingId: 'b-1' })
  })

  it('keep and attach map the row; no row -> null', async () => {
    store([{ ...ROW, status: 'kept', refund_reason: null }])
    expect(await bookingDepositStore.keep({ depositId: 'd-1', restaurantId: 'r-a', bookingStatuses: ['cancelled'], actorUserId: 'u', at: new Date() })).toMatchObject({ status: 'kept', decidedBy: 'u', bookingId: 'b-1' })
    store([{ ...ROW, status: 'awaiting' }])
    expect(await bookingDepositStore.attachSession('d-1', { sessionRef: 'cs_1', url: 'https://checkout.stripe.com/c/pay/cs_1' })).toMatchObject({ sessionUrl: 'https://checkout.stripe.com/c/pay/cs_1', providerSessionId: 'cs_1' })
    store([])
    expect(await bookingDepositStore.finishRefund({ depositId: 'd-1', attempt: 1, outcome: 'refunded', refundRef: null, actor: 'provider' })).toBeNull()
  })
})

describe('W6-fix store methods (F2, F4, F7)', () => {
  it('F7 settleProviderRefund calls settle_provider_refunded_booking_deposit and maps the row', async () => {
    const rec = store([{ ...ROW, status: 'refunded', refund_reason: 'provider_dashboard', refund_attempts: 0 }])
    expect(await bookingDepositStore.settleProviderRefund({ depositId: 'd-1' })).toMatchObject({ status: 'refunded', refundReason: 'provider_dashboard', bookingId: 'b-1' })
    expect(rec.queries[0].table).toBe('rpc:settle_provider_refunded_booking_deposit')
    expect(rec.queries[0].calls[0]).toEqual(['rpc', { p_deposit_id: 'd-1' }])
    store([])
    expect(await bookingDepositStore.settleProviderRefund({ depositId: 'd-1' })).toBeNull()
  })

  it('F2 claimLateRefundRetries sends the cap, the backoff in seconds and the factor', async () => {
    const rec = store([{ ...ROW, refund_reason: 'late_payment', refund_attempts: 2 }])
    const claimed = await bookingDepositStore.claimLateRefundRetries({ limit: 50, maxAttempts: 5, baseMs: 15 * 60_000, factor: 4 })
    expect(claimed).toEqual([expect.objectContaining({ refundReason: 'late_payment', refundAttempts: 2, providerPaymentRef: 'pi_1' })])
    expect(rec.queries[0].table).toBe('rpc:claim_late_booking_deposit_refund_retries')
    expect(rec.queries[0].calls[0]).toEqual(['rpc', { p_limit: 50, p_max_attempts: 5, p_base_seconds: 900, p_factor: 4 }])
  })

  it('F4 refundAttemptOf returns the attempt, or null when never recorded', async () => {
    const rec = store(2)
    expect(await bookingDepositStore.refundAttemptOf({ depositId: 'd-1', refundRef: 're_2' })).toBe(2)
    expect(rec.queries[0].table).toBe('rpc:booking_deposit_refund_attempt_of')
    expect(rec.queries[0].calls[0]).toEqual(['rpc', { p_deposit_id: 'd-1', p_refund_ref: 're_2' }])
    store(null)
    expect(await bookingDepositStore.refundAttemptOf({ depositId: 'd-1', refundRef: 're_x' })).toBeNull()
  })
})
