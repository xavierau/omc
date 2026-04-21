import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/whatsapp/messaging')
vi.mock('@/infrastructure/supabase/repositories/member-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/receipt-repository')
vi.mock('@/infrastructure/supabase/repositories/reward-repository')
vi.mock('@/application/register-member')
vi.mock('@/application/redeem-coupon')
vi.mock('@/application/redeem-reward')
vi.mock('@/application/process-receipt')
vi.mock('@/application/emit-event')
vi.mock('@/infrastructure/gcp/queue-client')
vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(() => ({
    from: vi.fn(() => ({
      update: vi.fn(() => ({ eq: vi.fn().mockResolvedValue({ error: null }) })),
    })),
  })),
}))

import { sendTextMessage, sendInteractiveButtons } from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { findPendingReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { listActiveRewards } from '@/infrastructure/supabase/repositories/reward-repository'
import { registerMember } from '@/application/register-member'
import { redeemCouponUseCase } from '@/application/redeem-coupon'
import { redeemRewardUseCase } from '@/application/redeem-reward'
import { confirmReceipt } from '@/application/process-receipt'
import { enqueueReceiptProcessing } from '@/infrastructure/gcp/queue-client'
import { routeMessage } from '../handlers'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'

const RESTAURANT_A = 'rest-a-uuid'
const RESTAURANT_B = 'rest-b-uuid'
const PHONE = '+85296283521'
const PHONE_NUMBER_ID = 'pn-a'

function makeMessage(partial: Partial<KapsoMessage> & { text?: string }): KapsoMessage {
  return {
    messageId: 'wamid.test',
    from: PHONE,
    type: 'text',
    text: partial.text,
    contactName: 'Tester',
    timestamp: new Date().toISOString(),
    ...partial,
  } as KapsoMessage
}

describe('webhook handlers — tenant-scoped member lookups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue(PHONE_NUMBER_ID)
    vi.mocked(sendTextMessage).mockResolvedValue(undefined)
    vi.mocked(sendInteractiveButtons).mockResolvedValue(undefined)
    vi.mocked(findMemberByPhone).mockResolvedValue(null)
  })

  describe('cross-tenant isolation (regression: a member of tenant A must NOT be treated as a member of tenant B)', () => {
    it('unknown text: shows JOIN prompt to tenant B, even if phone is a member of tenant A', async () => {
      // Simulate: the same phone is a member of RESTAURANT_A but not RESTAURANT_B.
      // The lookup must be scoped, so calling for RESTAURANT_B returns null.
      vi.mocked(findMemberByPhone).mockImplementation(async (rid) =>
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 50 } : null
      )

      await routeMessage(makeMessage({ text: 'Hey' }), RESTAURANT_B)

      expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_B, PHONE)
      expect(findMemberByPhone).not.toHaveBeenCalledWith(RESTAURANT_A, PHONE)
      expect(sendInteractiveButtons).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('Welcome!'),
        [{ id: 'JOIN', title: 'Join Rewards' }]
      )
    })

    it('POINTS: replies "not a member yet" to tenant B, even if phone is a member of tenant A', async () => {
      vi.mocked(findMemberByPhone).mockImplementation(async (rid) =>
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 50 } : null
      )

      await routeMessage(makeMessage({ text: 'POINTS' }), RESTAURANT_B)

      expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_B, PHONE)
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('not a member yet')
      )
    })

    it('REDEEM: replies "not a member yet" when the phone is only a member of another tenant', async () => {
      vi.mocked(findMemberByPhone).mockImplementation(async (rid) =>
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 50 } : null
      )

      await routeMessage(makeMessage({ text: 'REDEEM ABC123' }), RESTAURANT_B)

      expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_B, PHONE)
      expect(redeemCouponUseCase).not.toHaveBeenCalled()
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('not a member yet')
      )
    })

    it('REWARDS: replies "not a member yet" when the phone is only a member of another tenant', async () => {
      vi.mocked(findMemberByPhone).mockImplementation(async (rid) =>
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 500 } : null
      )

      await routeMessage(makeMessage({ text: 'REWARDS' }), RESTAURANT_B)

      expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_B, PHONE)
      expect(listActiveRewards).not.toHaveBeenCalled()
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('not a member yet')
      )
    })

    it('REWARD_<id>: replies "not a member yet" when the phone is only a member of another tenant', async () => {
      vi.mocked(findMemberByPhone).mockImplementation(async (rid) =>
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 500 } : null
      )

      await routeMessage(makeMessage({ text: 'REWARD_xyz' }), RESTAURANT_B)

      expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_B, PHONE)
      expect(redeemRewardUseCase).not.toHaveBeenCalled()
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('not a member yet')
      )
    })

    it('STOP: silently ignores when the phone is only a member of another tenant (no unsubscribe of other tenant)', async () => {
      vi.mocked(findMemberByPhone).mockImplementation(async (rid) =>
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 0 } : null
      )

      await routeMessage(makeMessage({ text: 'STOP' }), RESTAURANT_B)

      expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_B, PHONE)
      expect(sendTextMessage).not.toHaveBeenCalled()
    })

    it('receipt image: replies "not a member yet" when the phone is only a member of another tenant', async () => {
      vi.mocked(findMemberByPhone).mockImplementation(async (rid) =>
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 0 } : null
      )

      await routeMessage(
        makeMessage({ type: 'image', imageUrl: 'https://example.test/img.jpg' }),
        RESTAURANT_B
      )

      expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_B, PHONE)
      expect(enqueueReceiptProcessing).not.toHaveBeenCalled()
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('not a member yet')
      )
    })

    it('receipt confirmation (YES / numeric): ignored when the phone is only a member of another tenant', async () => {
      vi.mocked(findMemberByPhone).mockImplementation(async (rid) =>
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 0 } : null
      )

      await routeMessage(makeMessage({ text: 'YES' }), RESTAURANT_B)

      expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_B, PHONE)
      expect(findPendingReceipt).not.toHaveBeenCalled()
      expect(confirmReceipt).not.toHaveBeenCalled()
    })
  })

  describe('positive paths (member belongs to the current tenant)', () => {
    it('unknown text: shows member menu when the phone is a member of the current tenant', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({ id: 'm-b', pointsBalance: 10 })

      await routeMessage(makeMessage({ text: 'Hey' }), RESTAURANT_B)

      expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_B, PHONE)
      expect(sendInteractiveButtons).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('How can I help?'),
        [
          { id: 'POINTS', title: 'Check Points' },
          { id: 'REWARDS', title: 'View Rewards' },
        ]
      )
    })

    it('POINTS: returns the member balance', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({ id: 'm-b', pointsBalance: 123 })

      await routeMessage(makeMessage({ text: 'POINTS' }), RESTAURANT_B)

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('123 points')
      )
    })

    it('receipt image: enqueues processing with the current tenant id', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({ id: 'm-b', pointsBalance: 0 })
      vi.mocked(enqueueReceiptProcessing).mockResolvedValue(undefined as never)

      await routeMessage(
        makeMessage({ type: 'image', imageUrl: 'https://example.test/img.jpg' }),
        RESTAURANT_B
      )

      expect(enqueueReceiptProcessing).toHaveBeenCalledWith(
        expect.objectContaining({ restaurantId: RESTAURANT_B, memberId: 'm-b' })
      )
    })
  })

  describe('JOIN is delegated to registerMember and is scoped by restaurantId', () => {
    it('passes the current tenant into registerMember', async () => {
      vi.mocked(registerMember).mockResolvedValue({
        isNew: true,
        memberId: 'm-new',
        pointsBalance: 0,
      })

      await routeMessage(makeMessage({ text: 'JOIN' }), RESTAURANT_B)

      expect(registerMember).toHaveBeenCalledWith(RESTAURANT_B, PHONE, 'Tester')
    })
  })

  describe('every member lookup is tenant-scoped (guard against regressions)', () => {
    const cases: Array<{ name: string; message: KapsoMessage }> = [
      { name: 'unknown text', message: makeMessage({ text: 'hi there' }) },
      { name: 'POINTS', message: makeMessage({ text: 'POINTS' }) },
      { name: 'REDEEM', message: makeMessage({ text: 'REDEEM ABC' }) },
      { name: 'REWARDS', message: makeMessage({ text: 'REWARDS' }) },
      { name: 'REWARD_id', message: makeMessage({ text: 'REWARD_xyz' }) },
      { name: 'STOP', message: makeMessage({ text: 'STOP' }) },
      { name: 'YES (confirmation)', message: makeMessage({ text: 'YES' }) },
      {
        name: 'image',
        message: makeMessage({ type: 'image', imageUrl: 'https://example.test/x.jpg' }),
      },
    ]

    for (const { name, message } of cases) {
      it(`${name}: findMemberByPhone is called with (restaurantId, phone) — never phone alone`, async () => {
        vi.mocked(findMemberByPhone).mockResolvedValue(null)

        await routeMessage(message, RESTAURANT_B)

        // Every call must include the restaurant id as the first arg.
        for (const call of vi.mocked(findMemberByPhone).mock.calls) {
          expect(call[0]).toBe(RESTAURANT_B)
          expect(call[1]).toBe(PHONE)
        }
      })
    }
  })
})
