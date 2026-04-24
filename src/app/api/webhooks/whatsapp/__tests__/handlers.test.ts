import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/whatsapp/messaging')
vi.mock('@/infrastructure/supabase/repositories/member-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
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
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { findPendingReceipt, updateReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
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
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
    vi.mocked(sendTextMessage).mockResolvedValue(undefined)
    vi.mocked(sendInteractiveButtons).mockResolvedValue(undefined)
    vi.mocked(findMemberByPhone).mockResolvedValue(null)
    vi.mocked(updateReceipt).mockResolvedValue(undefined)
  })

  describe('cross-tenant isolation (regression: a member of tenant A must NOT be treated as a member of tenant B)', () => {
    it('unknown text: shows JOIN prompt to tenant B, even if phone is a member of tenant A', async () => {
      // Simulate: the same phone is a member of RESTAURANT_A but not RESTAURANT_B.
      // The lookup must be scoped, so calling for RESTAURANT_B returns null.
      vi.mocked(findMemberByPhone).mockImplementation(async (rid) =>
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 50, preferredLanguage: null } : null
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
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 50, preferredLanguage: null } : null
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
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 50, preferredLanguage: null } : null
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
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 500, preferredLanguage: null } : null
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
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 500, preferredLanguage: null } : null
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
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 0, preferredLanguage: null } : null
      )

      await routeMessage(makeMessage({ text: 'STOP' }), RESTAURANT_B)

      expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_B, PHONE)
      expect(sendTextMessage).not.toHaveBeenCalled()
    })

    it('receipt image: replies "not a member yet" when the phone is only a member of another tenant', async () => {
      vi.mocked(findMemberByPhone).mockImplementation(async (rid) =>
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 0, preferredLanguage: null } : null
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
        rid === RESTAURANT_A ? { id: 'm-a', pointsBalance: 0, preferredLanguage: null } : null
      )

      await routeMessage(makeMessage({ text: 'YES' }), RESTAURANT_B)

      expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_B, PHONE)
      expect(findPendingReceipt).not.toHaveBeenCalled()
      expect(confirmReceipt).not.toHaveBeenCalled()
    })
  })

  describe('positive paths (member belongs to the current tenant)', () => {
    it('unknown text: shows localized member menu (EN default) when the phone is a member of the current tenant', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({ id: 'm-b', pointsBalance: 10, preferredLanguage: null })

      await routeMessage(makeMessage({ text: 'Hey' }), RESTAURANT_B)

      expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_B, PHONE)
      expect(sendInteractiveButtons).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining("didn't understand"),
        [
          { id: 'POINTS', title: 'Check Points' },
          { id: 'REWARDS', title: 'View Rewards' },
          { id: 'HELP', title: 'Help' },
        ]
      )
    })

    it('POINTS: returns the member balance', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({ id: 'm-b', pointsBalance: 123, preferredLanguage: null })

      await routeMessage(makeMessage({ text: 'POINTS' }), RESTAURANT_B)

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('123 points')
      )
    })

    it('receipt image: enqueues processing with the current tenant id', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({ id: 'm-b', pointsBalance: 0, preferredLanguage: null })
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
    it('bare "JOIN": passes inboundText=undefined to skip language detection (would always be EN otherwise)', async () => {
      vi.mocked(registerMember).mockResolvedValue({
        isNew: true,
        memberId: 'm-new',
        pointsBalance: 0,
      })

      await routeMessage(makeMessage({ text: 'JOIN' }), RESTAURANT_B)

      expect(registerMember).toHaveBeenCalledWith(
        RESTAURANT_B,
        PHONE,
        'Tester',
        undefined
      )
    })

    it('QR deep-link JOIN-{restaurantId}: passes inboundText=undefined to skip language detection (would always be EN otherwise)', async () => {
      vi.mocked(registerMember).mockResolvedValue({
        isNew: true,
        memberId: 'm-new',
        pointsBalance: 0,
      })

      await routeMessage(
        makeMessage({ text: 'JOIN-rest-b-uuid' }),
        RESTAURANT_B
      )

      expect(registerMember).toHaveBeenCalledWith(
        RESTAURANT_B,
        PHONE,
        'Tester',
        undefined
      )
    })

    it('Chinese alias 加入: passes the Chinese text through so detection sets zh_hk', async () => {
      vi.mocked(registerMember).mockResolvedValue({
        isNew: true,
        memberId: 'm-new',
        pointsBalance: 0,
      })

      await routeMessage(makeMessage({ text: '加入' }), RESTAURANT_B)

      expect(registerMember).toHaveBeenCalledWith(
        RESTAURANT_B,
        PHONE,
        'Tester',
        '加入'
      )
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

  // ONBOARD-007: bilingual inbound keywords
  describe('bilingual inbound keywords (ONBOARD-007)', () => {
    it('ZH "積分" from member → routes to POINTS (balance reply)', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 77,
        preferredLanguage: 'zh_hk',
      })

      await routeMessage(makeMessage({ text: '積分' }), RESTAURANT_B)

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('77')
      )
    })

    it('ZH "幫助" from ZH member → routes to handleHelp with ZH copy', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'zh_hk',
      })

      await routeMessage(makeMessage({ text: '幫助' }), RESTAURANT_B)

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('可用指令')
      )
    })

    it('EN "HELP" from EN member → handleHelp with EN copy', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'en',
      })

      await routeMessage(makeMessage({ text: 'HELP' }), RESTAURANT_B)

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('Available commands')
      )
    })

    it('ZH "是" with pending receipt → confirm path', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(findPendingReceipt).mockResolvedValue({
        id: 'rec-1',
        pending_amount: 99,
      } as unknown as Record<string, unknown>)
      vi.mocked(confirmReceipt).mockResolvedValue(undefined)

      await routeMessage(makeMessage({ text: '是' }), RESTAURANT_B)

      expect(confirmReceipt).toHaveBeenCalledWith(
        'm-b',
        RESTAURANT_B,
        PHONE,
        'rec-1',
        99
      )
    })

    it('ZH "否" with pending receipt → reject path (clears + localized ZH reply)', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(findPendingReceipt).mockResolvedValue({
        id: 'rec-1',
        pending_amount: 99,
      } as unknown as Record<string, unknown>)

      await routeMessage(makeMessage({ text: '否' }), RESTAURANT_B)

      expect(updateReceipt).toHaveBeenCalledWith('rec-1', { status: 'rejected' })
      expect(confirmReceipt).not.toHaveBeenCalled()
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('已取消')
      )
    })

    it('EN "NO" with pending receipt → reject path + EN reply', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'en',
      })
      vi.mocked(findPendingReceipt).mockResolvedValue({
        id: 'rec-2',
        pending_amount: 50,
      } as unknown as Record<string, unknown>)

      await routeMessage(makeMessage({ text: 'NO' }), RESTAURANT_B)

      expect(updateReceipt).toHaveBeenCalledWith('rec-2', { status: 'rejected' })
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('Receipt cancelled')
      )
    })

    it('unknown text from ZH member → ZH reply with both-language hint', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'zh_hk',
      })

      await routeMessage(makeMessage({ text: 'xyz random' }), RESTAURANT_B)

      expect(sendInteractiveButtons).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('不明白'),
        [
          { id: 'POINTS', title: '查詢積分' },
          { id: 'REWARDS', title: '查看獎賞' },
          { id: 'HELP', title: '幫助' },
        ]
      )
      // Both-language hint present
      const call = vi.mocked(sendInteractiveButtons).mock.calls[0]
      expect(call[2]).toContain('POINTS')
      expect(call[2]).toContain('積分')
    })

    it('unknown text from EN member → EN reply with both-language hint', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'en',
      })

      await routeMessage(makeMessage({ text: 'xyz random' }), RESTAURANT_B)

      expect(sendInteractiveButtons).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining("didn't understand"),
        [
          { id: 'POINTS', title: 'Check Points' },
          { id: 'REWARDS', title: 'View Rewards' },
          { id: 'HELP', title: 'Help' },
        ]
      )
      const call = vi.mocked(sendInteractiveButtons).mock.calls[0]
      expect(call[2]).toContain('POINTS')
      expect(call[2]).toContain('積分')
    })

    it('unknown text from non-member → existing English welcome (regression)', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue(null)

      await routeMessage(makeMessage({ text: 'xyz' }), RESTAURANT_B)

      expect(sendInteractiveButtons).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('Welcome!'),
        [{ id: 'JOIN', title: 'Join Rewards' }]
      )
    })

    it('unknown text from non-member (restaurant default=zh_hk) → ZH JOIN invite', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue(null)
      vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('zh_hk')

      await routeMessage(makeMessage({ text: 'xyz' }), RESTAURANT_B)

      expect(sendInteractiveButtons).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('歡迎'),
        [{ id: 'JOIN', title: '加入會員' }]
      )
    })

    it('HELP from non-member → JOIN invite (not the command list)', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue(null)

      await routeMessage(makeMessage({ text: 'HELP' }), RESTAURANT_B)

      // Must not leak the member-only command list to a non-member.
      expect(sendTextMessage).not.toHaveBeenCalled()
      expect(sendInteractiveButtons).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('Welcome!'),
        [{ id: 'JOIN', title: 'Join Rewards' }]
      )
    })

    it('HELP from non-member (restaurant default=zh_hk) → ZH JOIN invite', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue(null)
      vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('zh_hk')

      await routeMessage(makeMessage({ text: 'HELP' }), RESTAURANT_B)

      expect(sendTextMessage).not.toHaveBeenCalled()
      expect(sendInteractiveButtons).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('歡迎'),
        [{ id: 'JOIN', title: '加入會員' }]
      )
    })

    it('bare "兌換" → routes to handleRewards (not coupon redemption)', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 500,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(listActiveRewards).mockResolvedValue([])

      await routeMessage(makeMessage({ text: '兌換' }), RESTAURANT_B)

      expect(listActiveRewards).toHaveBeenCalledWith(RESTAURANT_B)
      expect(redeemCouponUseCase).not.toHaveBeenCalled()
    })

    it('"兌換項目" → routes to handleRewards', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 500,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(listActiveRewards).mockResolvedValue([])

      await routeMessage(makeMessage({ text: '兌換項目' }), RESTAURANT_B)

      expect(listActiveRewards).toHaveBeenCalledWith(RESTAURANT_B)
    })

    it('bare "REDEEM" (uppercase, no argument) → routes to handleRewards', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 500,
        preferredLanguage: 'en',
      })
      vi.mocked(listActiveRewards).mockResolvedValue([])

      await routeMessage(makeMessage({ text: 'REDEEM' }), RESTAURANT_B)

      expect(listActiveRewards).toHaveBeenCalledWith(RESTAURANT_B)
      expect(redeemCouponUseCase).not.toHaveBeenCalled()
    })

    it('"REDEEM CODE123" (with code) → still routes to coupon redemption (regression)', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'en',
      })
      vi.mocked(redeemCouponUseCase).mockResolvedValue({
        success: true,
        message: 'Coupon redeemed!',
      } as unknown as ReturnType<typeof redeemCouponUseCase> extends Promise<infer R> ? R : never)

      await routeMessage(makeMessage({ text: 'REDEEM CODE123' }), RESTAURANT_B)

      expect(redeemCouponUseCase).toHaveBeenCalledWith(
        'CODE123',
        'm-b',
        RESTAURANT_B,
        expect.objectContaining({ code: 'en' })
      )
    })

    it('"兌換 ABC123" (Chinese member) → triggers handleRedeem with the coupon code', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(redeemCouponUseCase).mockResolvedValue({
        success: true,
        message: 'Coupon redeemed!',
      } as unknown as ReturnType<typeof redeemCouponUseCase> extends Promise<infer R> ? R : never)

      await routeMessage(makeMessage({ text: '兌換 ABC123' }), RESTAURANT_B)

      expect(redeemCouponUseCase).toHaveBeenCalledWith(
        'ABC123',
        'm-b',
        RESTAURANT_B,
        expect.objectContaining({ code: 'zh_hk' })
      )
    })

    it('ZH "退訂" → routes to handleUnsubscribe with ZH goodbye reply', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'zh_hk',
      })

      await routeMessage(makeMessage({ text: '退訂' }), RESTAURANT_B)

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('取消訂閱')
      )
    })

    it('EN "STOP" → routes to handleUnsubscribe with EN goodbye reply', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'en',
      })

      await routeMessage(makeMessage({ text: 'STOP' }), RESTAURANT_B)

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('unsubscribed')
      )
    })
  })

  // ONBOARD-008: localize remaining handler reply text.
  describe('bilingual reply text (ONBOARD-008)', () => {
    it('POINTS (ZH member) → ZH balance reply with 積分', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-z',
        pointsBalance: 77,
        preferredLanguage: 'zh_hk',
      })

      await routeMessage(makeMessage({ text: 'POINTS' }), RESTAURANT_B)

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('積分')
      )
    })

    it('POINTS from non-member → nonMember reply in restaurant default language (zh_hk)', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue(null)
      vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('zh_hk')

      await routeMessage(makeMessage({ text: 'POINTS' }), RESTAURANT_B)

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('尚未成為會員')
      )
    })

    it('REWARDS (ZH member, empty list) → ZH "no rewards yet"', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-z',
        pointsBalance: 0,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(listActiveRewards).mockResolvedValue([])

      await routeMessage(makeMessage({ text: 'REWARDS' }), RESTAURANT_B)

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringMatching(/暫.*獎賞/)
      )
    })

    it('REWARDS (EN member, cannot afford) → EN "keep earning" with next reward', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-e',
        pointsBalance: 10,
        preferredLanguage: 'en',
      })
      vi.mocked(listActiveRewards).mockResolvedValue([
        {
          id: 'rw-1',
          name: 'Free Coffee',
          pointsCost: 50,
          isActive: true,
          discountType: 'percentage',
          discountValue: 100,
          couponExpiryDays: 30,
        } as unknown as Awaited<ReturnType<typeof listActiveRewards>>[number],
      ])

      await routeMessage(makeMessage({ text: 'REWARDS' }), RESTAURANT_B)

      const call = vi.mocked(sendTextMessage).mock.calls[0]
      expect(call[2]).toContain('Free Coffee')
      expect(call[2]).toContain('50 pts')
    })

    it('REWARDS (ZH member, cannot afford) → ZH "keep earning" with 積分', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-z',
        pointsBalance: 10,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(listActiveRewards).mockResolvedValue([
        {
          id: 'rw-1',
          name: 'Free Coffee',
          pointsCost: 50,
          isActive: true,
          discountType: 'percentage',
          discountValue: 100,
          couponExpiryDays: 30,
        } as unknown as Awaited<ReturnType<typeof listActiveRewards>>[number],
      ])

      await routeMessage(makeMessage({ text: 'REWARDS' }), RESTAURANT_B)

      const call = vi.mocked(sendTextMessage).mock.calls[0]
      expect(call[2]).toContain('Free Coffee')
      expect(call[2]).toContain('50 積分')
    })

    it('REWARDS (ZH member, affordable list) → interactive buttons with ZH header and ZH button labels', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-z',
        pointsBalance: 500,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(listActiveRewards).mockResolvedValue([
        {
          id: 'rw-1',
          name: 'Coffee',
          pointsCost: 50,
          isActive: true,
          discountType: 'percentage',
          discountValue: 100,
          couponExpiryDays: 30,
        } as unknown as Awaited<ReturnType<typeof listActiveRewards>>[number],
      ])

      await routeMessage(makeMessage({ text: 'REWARDS' }), RESTAURANT_B)

      const call = vi.mocked(sendInteractiveButtons).mock.calls[0]
      expect(call[2]).toContain('積分')
      expect(call[2]).toContain('500')
      expect(call[3][0].title).toContain('Coffee')
      expect(call[3][0].title).toContain('積分')
    })

    it('receipt image (ZH member) → ZH "Got your receipt" ack', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-z',
        pointsBalance: 0,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(enqueueReceiptProcessing).mockResolvedValue(undefined as never)

      await routeMessage(
        makeMessage({ type: 'image', imageUrl: 'https://img.test/r.jpg' }),
        RESTAURANT_B
      )

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('收據')
      )
    })

    it('receipt image missing (ZH restaurant default) → ZH "could not retrieve" reply', async () => {
      vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('zh_hk')
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-z',
        pointsBalance: 0,
        preferredLanguage: 'zh_hk',
      })

      await routeMessage(
        makeMessage({ type: 'image' }),
        RESTAURANT_B
      )

      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('抱歉')
      )
    })

    it('REDEEM_CODE (ZH member) → passes Language.ZH_HK to redeemCouponUseCase', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-z',
        pointsBalance: 0,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(redeemCouponUseCase).mockResolvedValue({
        success: true,
        message: '優惠券已兌換！',
      } as unknown as Awaited<ReturnType<typeof redeemCouponUseCase>>)

      await routeMessage(makeMessage({ text: 'REDEEM CODE123' }), RESTAURANT_B)

      // fourth arg is the Language — assert .code === 'zh_hk'
      const call = vi.mocked(redeemCouponUseCase).mock.calls[0]
      expect(call[0]).toBe('CODE123')
      expect(call[1]).toBe('m-z')
      const langArg = call[3] as unknown as { code: string } | undefined
      expect(langArg?.code).toBe('zh_hk')
    })

    it('REWARD_<id> (ZH member) → passes Language.ZH_HK to redeemRewardUseCase', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-z',
        pointsBalance: 500,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(redeemRewardUseCase).mockResolvedValue({
        success: true,
        couponCode: 'RWD-1',
      })

      await routeMessage(makeMessage({ text: 'REWARD_rw1' }), RESTAURANT_B)

      const call = vi.mocked(redeemRewardUseCase).mock.calls[0]
      expect(call[0]).toMatchObject({
        memberId: 'm-z',
        rewardId: 'rw1',
        restaurantId: RESTAURANT_B,
      })
      // language field on params
      expect((call[0] as unknown as { language: { code: string } }).language.code).toBe('zh_hk')
    })
  })
})
