import { describe, it, expect, vi, beforeEach } from 'vitest'
import { okResult } from '@/test-utils/send-result'

vi.mock('@/infrastructure/supabase/repositories/member-loyalty-repository', () => ({
  findMemberLoyaltyTokenByPhone: vi.fn(),
}))
vi.mock('@/application/check-marketing-consent', () => ({
  checkMarketingConsent: vi.fn(),
}))
vi.mock('@/application/prompt-marketing-optin', () => ({
  promptMarketingOptin: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/storage', () => ({
  uploadLoyaltyQr: vi.fn(),
}))
vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendImageMessage: vi.fn(),
  sendTextMessage: vi.fn(),
}))

import { handleMyCard } from '../my-card-handler'
import { findMemberLoyaltyTokenByPhone } from '@/infrastructure/supabase/repositories/member-loyalty-repository'
import { checkMarketingConsent } from '@/application/check-marketing-consent'
import { promptMarketingOptin } from '@/application/prompt-marketing-optin'
import { uploadLoyaltyQr } from '@/infrastructure/supabase/storage'
import { sendImageMessage, sendTextMessage } from '@/infrastructure/whatsapp/messaging'

const PHONE_NUMBER_ID = 'pn-1'
const PHONE = '85291234567'
const RESTAURANT_ID = 'r-1'

describe('handleMyCard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(uploadLoyaltyQr).mockResolvedValue('https://cdn/qr.png')
    vi.mocked(sendImageMessage).mockResolvedValue(okResult())
    vi.mocked(sendTextMessage).mockResolvedValue(okResult())
    vi.mocked(promptMarketingOptin).mockResolvedValue({ promptSent: true })
  })

  it('sends the loyalty QR image when the member is opted in', async () => {
    vi.mocked(findMemberLoyaltyTokenByPhone).mockResolvedValue({
      memberId: 'm-1',
      loyaltyToken: 'abc123',
    })
    vi.mocked(checkMarketingConsent).mockResolvedValue({ allowed: true })

    await handleMyCard(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(uploadLoyaltyQr).toHaveBeenCalledWith('abc123')
    expect(sendImageMessage).toHaveBeenCalledTimes(1)
    const [pnId, to, url, caption] = vi.mocked(sendImageMessage).mock.calls[0]
    expect(pnId).toBe(PHONE_NUMBER_ID)
    expect(to).toBe(PHONE)
    expect(url).toBe('https://cdn/qr.png')
    expect(caption).toContain('出示此碼儲印花')
    expect(caption).toContain('Show this to collect stamps')
    expect(promptMarketingOptin).not.toHaveBeenCalled()
  })

  it('routes a NOT opted-in member (pending) into the opt-in flow, sends NO card', async () => {
    vi.mocked(findMemberLoyaltyTokenByPhone).mockResolvedValue({
      memberId: 'm-1',
      loyaltyToken: 'abc123',
    })
    vi.mocked(checkMarketingConsent).mockResolvedValue({
      allowed: false,
      reason: 'pending',
    })

    await handleMyCard(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(promptMarketingOptin).toHaveBeenCalledWith({
      restaurantId: RESTAURANT_ID,
      phoneE164: PHONE,
      source: expect.stringContaining('my_card'),
    })
    expect(uploadLoyaltyQr).not.toHaveBeenCalled()
    expect(sendImageMessage).not.toHaveBeenCalled()
  })

  it('routes an absent-consent member (no_consent) into the opt-in flow', async () => {
    vi.mocked(findMemberLoyaltyTokenByPhone).mockResolvedValue({
      memberId: 'm-1',
      loyaltyToken: 'abc123',
    })
    vi.mocked(checkMarketingConsent).mockResolvedValue({
      allowed: false,
      reason: 'no_consent',
    })

    await handleMyCard(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(promptMarketingOptin).toHaveBeenCalledTimes(1)
    expect(sendImageMessage).not.toHaveBeenCalled()
  })

  // #127 / CAMP-007: promptMarketingOptin can now throw a typed error (e.g.
  // the opt-in template fails the media-header gate). A throw here lands
  // after the webhook's idempotency claim — a 500 makes Meta's retry hit
  // `duplicate` and the event is dropped (issue #45 class) — so the handler
  // must swallow and log, mirroring optin-prompt.ts's never-throws contract.
  it('does not propagate an opt-in prompt failure (never-throws contract)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(findMemberLoyaltyTokenByPhone).mockResolvedValue({
      memberId: 'm-1',
      loyaltyToken: 'abc123',
    })
    vi.mocked(checkMarketingConsent).mockResolvedValue({
      allowed: false,
      reason: 'pending',
    })
    vi.mocked(promptMarketingOptin).mockRejectedValue(
      new Error('WhatsApp template optin_tpl declares a media header but has no usable public media URL stored')
    )

    await expect(
      handleMyCard(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)
    ).resolves.toBeUndefined()

    expect(sendImageMessage).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does nothing destructive for an unknown phone (no member) — no QR, no opt-in', async () => {
    vi.mocked(findMemberLoyaltyTokenByPhone).mockResolvedValue(null)

    await handleMyCard(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(checkMarketingConsent).not.toHaveBeenCalled()
    expect(uploadLoyaltyQr).not.toHaveBeenCalled()
    expect(promptMarketingOptin).not.toHaveBeenCalled()
  })

  it('does not send a card when the member has no loyalty token yet', async () => {
    vi.mocked(findMemberLoyaltyTokenByPhone).mockResolvedValue({
      memberId: 'm-1',
      loyaltyToken: null,
    })
    vi.mocked(checkMarketingConsent).mockResolvedValue({ allowed: true })

    await handleMyCard(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(uploadLoyaltyQr).not.toHaveBeenCalled()
    expect(sendImageMessage).not.toHaveBeenCalled()
  })
})
