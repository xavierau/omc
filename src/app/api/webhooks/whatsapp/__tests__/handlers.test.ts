import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/whatsapp/messaging')
vi.mock('@/infrastructure/supabase/repositories/member-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/infrastructure/supabase/repositories/receipt-repository')
vi.mock('@/infrastructure/supabase/repositories/reward-repository')
vi.mock('@/infrastructure/supabase/repositories/consent-record-repository', () => ({
  insertConsentRecord: vi.fn(),
  revokeConsent: vi.fn(),
  upgradeToOptedIn: vi.fn(),
  findActiveConsent: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/conversation-window-repository', () => ({
  upsertOpenWindow: vi.fn(),
  isWindowOpen: vi.fn(),
}))
vi.mock('@/application/prompt-marketing-optin', () => ({
  promptMarketingOptin: vi.fn(async () => ({ promptSent: false, reason: 'no_member' })),
}))
vi.mock('@/application/confirm-marketing-optin', () => ({
  confirmMarketingOptin: vi.fn(async () => ({ upgraded: false })),
}))
vi.mock('@/application/reject-marketing-optin', () => ({
  rejectMarketingOptin: vi.fn(async () => ({ revoked: false })),
}))
vi.mock('../my-card-handler', () => ({
  handleMyCard: vi.fn(),
}))
vi.mock('../claim-handler', () => ({
  handleClaim: vi.fn(),
}))
vi.mock('../contact-handler', () => ({
  handleContact: vi.fn(),
}))
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
import { getRestaurantPhoneNumberId, getRestaurantName, getRestaurantRedirect, getReplyConfig } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { resolveReplyConfig } from '@/domain/services/reply-config'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { findPendingReceipt, updateReceipt } from '@/infrastructure/supabase/repositories/receipt-repository'
import { listActiveRewards, hasActiveRewards } from '@/infrastructure/supabase/repositories/reward-repository'
import {
  insertConsentRecord,
  revokeConsent,
} from '@/infrastructure/supabase/repositories/consent-record-repository'
import { upsertOpenWindow } from '@/infrastructure/supabase/repositories/conversation-window-repository'
import { ConsentImportError } from '@/domain/repositories/consent-record-repository'
import { ConversationWindow } from '@/domain/entities/conversation-window'
import { registerMember } from '@/application/register-member'
import { redeemCouponUseCase } from '@/application/redeem-coupon'
import { redeemRewardUseCase } from '@/application/redeem-reward'
import { confirmReceipt } from '@/application/process-receipt'
import { enqueueReceiptProcessing } from '@/infrastructure/gcp/queue-client'
import { handleMyCard } from '../my-card-handler'
import { handleClaim } from '../claim-handler'
import { handleContact } from '../contact-handler'
import { routeMessage } from '../handlers'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'
import { okResult } from '@/test-utils/send-result'

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
    vi.mocked(getRestaurantName).mockResolvedValue('Demo Cafe')
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: null,
      redirectLabel: 'Contact us',
    })
    vi.mocked(hasActiveRewards).mockResolvedValue(true)
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
    vi.mocked(sendTextMessage).mockResolvedValue(okResult())
    vi.mocked(sendInteractiveButtons).mockResolvedValue(okResult())
    vi.mocked(findMemberByPhone).mockResolvedValue(null)
    vi.mocked(updateReceipt).mockResolvedValue(undefined)
    vi.mocked(insertConsentRecord).mockResolvedValue(undefined)
    vi.mocked(revokeConsent).mockResolvedValue(0)
    vi.mocked(upsertOpenWindow).mockImplementation(async (w) => w)
  })

  describe('REPLY-003 function gating (disabled function → fallback)', () => {
    const disabled = (key: 'points' | 'rewards' | 'redeem' | 'card') =>
      resolveReplyConfig({ features: { [key]: false } })

    it('POINTS disabled → member gets the fallback menu (no balance reply)', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b', pointsBalance: 20, preferredLanguage: 'en',
      })
      vi.mocked(getReplyConfig).mockResolvedValue(disabled('points'))

      await routeMessage(makeMessage({ text: 'POINTS' }), RESTAURANT_B)

      expect(sendTextMessage).not.toHaveBeenCalled()
      const [, , , buttons] = vi.mocked(sendInteractiveButtons).mock.calls[0]
      expect(buttons.map((b: { id: string }) => b.id)).not.toContain('POINTS')
    })

    it('REWARDS disabled → non-member gets the Join fallback, not "not a member yet"', async () => {
      vi.mocked(getReplyConfig).mockResolvedValue(disabled('rewards'))

      await routeMessage(makeMessage({ text: 'REWARDS' }), RESTAURANT_B)

      expect(listActiveRewards).not.toHaveBeenCalled()
      expect(sendTextMessage).not.toHaveBeenCalled()
      expect(sendInteractiveButtons).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('Welcome!'),
        [{ id: 'JOIN', title: 'Join Rewards' }]
      )
    })

    it('REDEEM <code> disabled (redeem) → coupon redemption is not attempted', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b', pointsBalance: 0, preferredLanguage: 'en',
      })
      vi.mocked(getReplyConfig).mockResolvedValue(disabled('redeem'))

      await routeMessage(makeMessage({ text: 'REDEEM ABC123' }), RESTAURANT_B)

      expect(redeemCouponUseCase).not.toHaveBeenCalled()
      expect(sendInteractiveButtons).toHaveBeenCalled()
    })

    it('bare REDEEM disabled (rewards) → view-rewards is not shown', async () => {
      vi.mocked(getReplyConfig).mockResolvedValue(disabled('rewards'))

      await routeMessage(makeMessage({ text: 'REDEEM' }), RESTAURANT_B)

      expect(listActiveRewards).not.toHaveBeenCalled()
      expect(sendInteractiveButtons).toHaveBeenCalled()
    })

    it('CARD disabled (card) → handleMyCard is not called', async () => {
      vi.mocked(getReplyConfig).mockResolvedValue(disabled('card'))

      await routeMessage(makeMessage({ text: 'CARD' }), RESTAURANT_A)

      expect(handleMyCard).not.toHaveBeenCalled()
      expect(sendInteractiveButtons).toHaveBeenCalled()
    })

    it('CARD enabled → still dispatches to handleMyCard (gate passes through)', async () => {
      vi.mocked(getReplyConfig).mockResolvedValue(resolveReplyConfig(undefined))

      await routeMessage(makeMessage({ text: 'CARD' }), RESTAURANT_A)

      expect(handleMyCard).toHaveBeenCalledWith(PHONE_NUMBER_ID, PHONE, RESTAURANT_A)
    })
  })

  describe('CLAIM dispatch wiring (CAMP-001)', () => {
    it('routes a CLAIM_<id> button payload to handleClaim with the parsed campaignId', async () => {
      await routeMessage(
        makeMessage({ text: 'CLAIM_camp-xyz', type: 'button' }),
        RESTAURANT_A
      )

      expect(handleClaim).toHaveBeenCalledWith(
        expect.objectContaining({ campaignId: 'camp-xyz', restaurantId: RESTAURANT_A })
      )
    })

    it('preserves campaignId case (UUIDs are not upper-cased)', async () => {
      await routeMessage(
        makeMessage({ text: 'CLAIM_AbC-123', type: 'button' }),
        RESTAURANT_A
      )

      expect(handleClaim).toHaveBeenCalledWith(
        expect.objectContaining({ campaignId: 'AbC-123' })
      )
    })
  })

  describe('CONTACT dispatch wiring (REPLY-001)', () => {
    it('routes text "CONTACT" to handleContact with (phoneNumberId, phone, restaurantId)', async () => {
      await routeMessage(makeMessage({ text: 'CONTACT' }), RESTAURANT_A)

      expect(handleContact).toHaveBeenCalledWith(PHONE_NUMBER_ID, PHONE, RESTAURANT_A)
    })

    it('routes a Chinese synonym 客服 to handleContact', async () => {
      await routeMessage(makeMessage({ text: '客服' }), RESTAURANT_A)

      expect(handleContact).toHaveBeenCalledWith(PHONE_NUMBER_ID, PHONE, RESTAURANT_A)
    })
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

  describe('JOIN keyword writes a consent_records row (WAQ-004)', () => {
    it('writes a marketing/opted_in/strong consent for new members, sourced whatsapp_join_keyword', async () => {
      vi.mocked(registerMember).mockResolvedValue({
        isNew: true,
        memberId: 'm-new',
        pointsBalance: 0,
      })

      await routeMessage(
        makeMessage({ text: 'JOIN', messageId: 'wamid.join.1' }),
        RESTAURANT_B
      )

      expect(insertConsentRecord).toHaveBeenCalledTimes(1)
      const arg = vi.mocked(insertConsentRecord).mock.calls[0][0]
      expect(arg.snapshot).toMatchObject({
        restaurantId: RESTAURANT_B,
        memberId: 'm-new',
        phoneE164: PHONE,
        category: 'marketing',
        status: 'opted_in',
        consentGrade: 'strong',
        source: 'whatsapp_join_keyword',
        sourceReference: 'wamid.join.1',
        businessNameShown: 'Demo Cafe',
      })
    })

    it('also writes a consent record for returning members (isNew=false) — covers Kapso retry after a partial first attempt', async () => {
      // Why isNew=false isn't a guard against writing: the FIRST attempt may
      // have created the member but then crashed before insertConsentRecord
      // committed. On retry, registerMember finds the existing member and
      // returns isNew=false; if we skip the consent write here, we'd leave
      // the member permanently stranded with no consent record. The partial
      // unique index on consent_records makes the write idempotent
      // (duplicate_active is swallowed by the JOIN handler).
      vi.mocked(registerMember).mockResolvedValue({
        isNew: false,
        memberId: 'm-existing',
        pointsBalance: 100,
      })

      await routeMessage(makeMessage({ text: 'JOIN' }), RESTAURANT_B)

      expect(insertConsentRecord).toHaveBeenCalledTimes(1)
    })

    it('swallows duplicate_active errors silently (re-join is idempotent)', async () => {
      vi.mocked(registerMember).mockResolvedValue({
        isNew: true,
        memberId: 'm-new',
        pointsBalance: 0,
      })
      vi.mocked(insertConsentRecord).mockRejectedValueOnce(
        new ConsentImportError('duplicate_active', 'already exists')
      )

      await expect(
        routeMessage(makeMessage({ text: 'JOIN' }), RESTAURANT_B)
      ).resolves.not.toThrow()
    })

    it('JOIN: when consent write fails for an unexpected reason, the JOIN handler throws so Kapso can retry the webhook', async () => {
      // Previously this error was swallowed and logged, leaving the member
      // permanently without a consent record (and no retry signal back to
      // Kapso). Surface the error: the route turns it into 500, Kapso
      // retries, and on retry duplicate_active is swallowed as success.
      vi.mocked(registerMember).mockResolvedValue({
        isNew: true,
        memberId: 'm-new',
        pointsBalance: 0,
      })
      vi.mocked(insertConsentRecord).mockRejectedValueOnce(
        new Error('connection lost')
      )

      await expect(
        routeMessage(makeMessage({ text: 'JOIN' }), RESTAURANT_B)
      ).rejects.toThrow(/connection lost/)
    })

    it('JOIN retry after first-attempt consent failure succeeds via duplicate_active swallow', async () => {
      // First attempt: member created, consent write rejects (the bug).
      // Second attempt (Kapso retry): registerMember returns isNew=false,
      // recordJoinConsent runs again, the partial unique index trips and
      // raises ConsentImportError('duplicate_active') — which the handler
      // swallows. End state: a single consent row exists, no exception.
      vi.mocked(registerMember).mockResolvedValueOnce({
        isNew: true,
        memberId: 'm-new',
        pointsBalance: 0,
      })
      vi.mocked(insertConsentRecord).mockRejectedValueOnce(
        new Error('connection lost')
      )

      await expect(
        routeMessage(makeMessage({ text: 'JOIN' }), RESTAURANT_B)
      ).rejects.toThrow(/connection lost/)

      // Retry. registerMember is now idempotent (member exists) → isNew=false.
      // The DB-side unique index would convert a real second insert into a
      // 23505, surfaced as ConsentImportError(duplicate_active).
      vi.mocked(registerMember).mockResolvedValueOnce({
        isNew: false,
        memberId: 'm-new',
        pointsBalance: 0,
      })
      vi.mocked(insertConsentRecord).mockRejectedValueOnce(
        new ConsentImportError('duplicate_active', 'already exists')
      )

      await expect(
        routeMessage(makeMessage({ text: 'JOIN' }), RESTAURANT_B)
      ).resolves.not.toThrow()
    })
  })

  describe('STOP keyword revokes consent_records (WAQ-005)', () => {
    beforeEach(() => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'en',
      })
    })

    it('EN "STOP": flips member to unsubscribed AND revokes all active consents (no category arg)', async () => {
      vi.mocked(revokeConsent).mockResolvedValue(2)

      await routeMessage(makeMessage({ text: 'STOP' }), RESTAURANT_B)

      expect(revokeConsent).toHaveBeenCalledTimes(1)
      // No category passed → repo revokes EVERY active category for this contact.
      expect(revokeConsent).toHaveBeenCalledWith({
        restaurantId: RESTAURANT_B,
        phoneE164: PHONE,
      })
    })

    it('ZH "退訂": same revoke-all behaviour as STOP', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(revokeConsent).mockResolvedValue(1)

      await routeMessage(makeMessage({ text: '退訂' }), RESTAURANT_B)

      expect(revokeConsent).toHaveBeenCalledWith({
        restaurantId: RESTAURANT_B,
        phoneE164: PHONE,
      })
    })

    it('ZH "停止": same revoke-all behaviour as STOP', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue({
        id: 'm-b',
        pointsBalance: 0,
        preferredLanguage: 'zh_hk',
      })
      vi.mocked(revokeConsent).mockResolvedValue(1)

      await routeMessage(makeMessage({ text: '停止' }), RESTAURANT_B)

      expect(revokeConsent).toHaveBeenCalledWith({
        restaurantId: RESTAURANT_B,
        phoneE164: PHONE,
      })
    })

    it('STOP for a member with no active consents: revokeConsent returns 0, handler still acks the unsubscribe', async () => {
      vi.mocked(revokeConsent).mockResolvedValue(0)

      await routeMessage(makeMessage({ text: 'STOP' }), RESTAURANT_B)

      expect(revokeConsent).toHaveBeenCalledTimes(1)
      // Goodbye reply still goes out.
      expect(sendTextMessage).toHaveBeenCalledWith(
        PHONE_NUMBER_ID,
        PHONE,
        expect.stringContaining('unsubscribed')
      )
    })

    it('repeat STOP is idempotent: second call still calls revokeConsent (returns 0) and does not throw', async () => {
      vi.mocked(revokeConsent).mockResolvedValueOnce(2).mockResolvedValueOnce(0)

      await routeMessage(makeMessage({ text: 'STOP' }), RESTAURANT_B)
      await expect(
        routeMessage(makeMessage({ text: 'STOP' }), RESTAURANT_B)
      ).resolves.not.toThrow()

      expect(revokeConsent).toHaveBeenCalledTimes(2)
    })

    it('if revokeConsent throws transient error, the handler propagates so Kapso retries', async () => {
      vi.mocked(revokeConsent).mockRejectedValueOnce(
        new Error('connection lost')
      )

      await expect(
        routeMessage(makeMessage({ text: 'STOP' }), RESTAURANT_B)
      ).rejects.toThrow(/connection lost/)
    })

    it('STOP from a non-member: revokeConsent is NOT called (no member to scope to)', async () => {
      vi.mocked(findMemberByPhone).mockResolvedValue(null)

      await routeMessage(makeMessage({ text: 'STOP' }), RESTAURANT_B)

      expect(revokeConsent).not.toHaveBeenCalled()
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
      // HELP copy nudges toward the card keyword (plan §8 step 6).
      const zhBody = vi.mocked(sendTextMessage).mock.calls.at(-1)?.[2] ?? ''
      expect(zhBody).toContain('會員碼')
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
      // HELP copy nudges toward the card keyword (plan §8 step 6).
      const enBody = vi.mocked(sendTextMessage).mock.calls.at(-1)?.[2] ?? ''
      expect(enBody).toContain('CARD')
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

describe('conversation window upsert on inbound (WAQ-008)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue(PHONE_NUMBER_ID)
    vi.mocked(getRestaurantName).mockResolvedValue('Demo Cafe')
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: null,
      redirectLabel: 'Contact us',
    })
    vi.mocked(hasActiveRewards).mockResolvedValue(true)
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
    vi.mocked(sendTextMessage).mockResolvedValue(okResult())
    vi.mocked(sendInteractiveButtons).mockResolvedValue(okResult())
    vi.mocked(findMemberByPhone).mockResolvedValue(null)
    vi.mocked(upsertOpenWindow).mockImplementation(async (w) => w)
  })

  it('upserts a window for an inbound text message', async () => {
    await routeMessage(makeMessage({ text: 'POINTS' }), RESTAURANT_B)

    expect(upsertOpenWindow).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(upsertOpenWindow).mock.calls[0][0] as ConversationWindow
    expect(arg).toBeInstanceOf(ConversationWindow)
    expect(arg.snapshot.restaurantId).toBe(RESTAURANT_B)
    expect(arg.snapshot.phoneE164).toBe(PHONE)
  })

  it('upserts a window for an interactive button reply', async () => {
    await routeMessage(
      makeMessage({ type: 'interactive', text: 'JOIN' }),
      RESTAURANT_B
    )

    expect(upsertOpenWindow).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(upsertOpenWindow).mock.calls[0][0] as ConversationWindow
    expect(arg.snapshot.restaurantId).toBe(RESTAURANT_B)
    expect(arg.snapshot.phoneE164).toBe(PHONE)
  })

  it('upserts a window even when the inbound is a LANG command (short-circuit path)', async () => {
    // Locks the placement invariant: bumpServiceWindow MUST run BEFORE
    // maybeHandleLanguageCommand short-circuits the handler. Future refactor
    // that moves the bump after the LANG short-circuit will fail here.
    await routeMessage(makeMessage({ text: 'LANG EN' }), RESTAURANT_B)
    expect(upsertOpenWindow).toHaveBeenCalledTimes(1)
  })

  it('upserts a window for an inbound image message', async () => {
    await routeMessage(
      makeMessage({ type: 'image', imageUrl: 'https://x/y.jpg' }),
      RESTAURANT_B
    )

    expect(upsertOpenWindow).toHaveBeenCalledTimes(1)
  })

  // Fix 1 (Gemini r1): Meta calculates the customer-service window from
  // the user's original message timestamp. If our webhook is delayed/retried
  // and we anchor on `new Date()`, our tracked window extends past Meta's
  // enforced deadline → outbound replies silently get blocked. The window
  // MUST be opened at the webhook `timestamp`, not server-receive time.
  it('uses the inbound webhook timestamp (Meta seconds-since-epoch) instead of server time', async () => {
    // Webhook timestamp = 2026-05-04T10:00:00Z (1777888800s since epoch).
    const webhookSeconds = '1777888800'
    const expectedOpenedAt = '2026-05-04T10:00:00.000Z'
    const expectedExpiresAt = '2026-05-05T10:00:00.000Z'

    await routeMessage(
      makeMessage({ text: 'POINTS', timestamp: webhookSeconds }),
      RESTAURANT_B
    )

    const arg = vi.mocked(upsertOpenWindow).mock.calls[0][0] as ConversationWindow
    expect(arg.snapshot.openedAt).toBe(expectedOpenedAt)
    expect(arg.snapshot.lastInboundAt).toBe(expectedOpenedAt)
    expect(arg.snapshot.expiresAt).toBe(expectedExpiresAt)
  })

  it('falls back gracefully when the webhook timestamp is unparseable', async () => {
    await routeMessage(
      makeMessage({ text: 'POINTS', timestamp: 'not-a-timestamp' }),
      RESTAURANT_B
    )
    expect(upsertOpenWindow).toHaveBeenCalledTimes(1)
    const arg = vi.mocked(upsertOpenWindow).mock.calls[0][0] as ConversationWindow
    // Still produces a valid ISO string opened_at (server-time fallback).
    expect(arg.snapshot.openedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
    )
  })

  it('accepts ISO-8601 timestamps too (Kapso parser fallback path)', async () => {
    await routeMessage(
      makeMessage({ text: 'POINTS', timestamp: '2026-05-04T10:00:00.000Z' }),
      RESTAURANT_B
    )
    const arg = vi.mocked(upsertOpenWindow).mock.calls[0][0] as ConversationWindow
    expect(arg.snapshot.openedAt).toBe('2026-05-04T10:00:00.000Z')
    expect(arg.snapshot.expiresAt).toBe('2026-05-05T10:00:00.000Z')
  })

  it('upsert failure is logged but does NOT break the inbound flow', async () => {
    vi.mocked(upsertOpenWindow).mockRejectedValueOnce(new Error('db down'))
    const log = vi.fn()

    // Reaches the route handler; reply still goes out.
    await expect(
      routeMessage(makeMessage({ text: 'HELP' }), RESTAURANT_B, log)
    ).resolves.not.toThrow()

    expect(log).toHaveBeenCalledWith(
      'error',
      'webhook.window_upsert_failed',
      expect.objectContaining({ error: expect.stringContaining('db down') })
    )
    // The downstream HELP reply still ran (non-member -> JOIN invite via
    // interactive buttons).
    expect(sendInteractiveButtons).toHaveBeenCalled()
  })
})

describe('MY_CARD routing (plan §8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue(PHONE_NUMBER_ID)
    vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('en')
    vi.mocked(findMemberByPhone).mockResolvedValue(null)
    vi.mocked(upsertOpenWindow).mockImplementation(async (w) => w)
    vi.mocked(handleMyCard).mockResolvedValue(undefined)
  })

  it('dispatches a CARD keyword to handleMyCard', async () => {
    await routeMessage(makeMessage({ text: 'CARD' }), RESTAURANT_A)
    expect(handleMyCard).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      PHONE,
      RESTAURANT_A
    )
  })

  it('dispatches the CJK 我的會員碼 keyword to handleMyCard', async () => {
    await routeMessage(makeMessage({ text: '我的會員碼' }), RESTAURANT_A)
    expect(handleMyCard).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      PHONE,
      RESTAURANT_A
    )
  })
})
