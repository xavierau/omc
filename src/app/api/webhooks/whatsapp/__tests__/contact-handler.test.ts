import { describe, it, expect, vi, beforeEach } from 'vitest'
import { okResult } from '@/test-utils/send-result'
import { Language } from '@/domain/value-objects/language'

vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendCtaUrlButton: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getRestaurantRedirect: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({
  findMemberByPhone: vi.fn(),
}))
vi.mock('../resolve-language', () => ({
  resolveLanguageForMember: vi.fn(),
}))
vi.mock('../unknown-help-handlers', () => ({
  handleHelp: vi.fn(),
}))

import { handleContact } from '../contact-handler'
import { sendCtaUrlButton } from '@/infrastructure/whatsapp/messaging'
import { getRestaurantRedirect } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { resolveLanguageForMember } from '../resolve-language'
import { handleHelp } from '../unknown-help-handlers'

const PHONE_NUMBER_ID = 'pn-1'
const PHONE = '85291234567'
const RESTAURANT_ID = 'r-1'

describe('handleContact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendCtaUrlButton).mockResolvedValue(okResult())
    vi.mocked(handleHelp).mockResolvedValue(okResult())
    vi.mocked(findMemberByPhone).mockResolvedValue({
      id: 'm-1',
      pointsBalance: 0,
      preferredLanguage: 'en',
    })
    vi.mocked(resolveLanguageForMember).mockResolvedValue(Language.EN)
  })

  it('(a) sends a CTA-URL button to wa.me with displayText = redirectLabel', async () => {
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: '+85291234567',
      redirectLabel: 'Call Us',
    })

    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendCtaUrlButton).toHaveBeenCalledTimes(1)
    const [pnId, to, , displayText, url] = vi.mocked(sendCtaUrlButton).mock.calls[0]
    expect(pnId).toBe(PHONE_NUMBER_ID)
    expect(to).toBe(PHONE)
    expect(url).toBe('https://wa.me/85291234567')
    expect(displayText).toBe('Call Us')
    expect(handleHelp).not.toHaveBeenCalled()
  })

  it('(b) falls back to handleHelp and sends no CTA when redirect is null', async () => {
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: null,
      redirectLabel: 'Contact us',
    })

    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(handleHelp).toHaveBeenCalledWith(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
  })

  it('(c) falls back to handleHelp when the stored number is invalid', async () => {
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: 'not-a-number',
      redirectLabel: 'Contact us',
    })

    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(handleHelp).toHaveBeenCalledTimes(1)
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
  })

  it('(d) still sends the CTA when the caller is not a member (membership-agnostic)', async () => {
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: '+85291234567',
      redirectLabel: 'Contact us',
    })
    vi.mocked(findMemberByPhone).mockResolvedValue(null)

    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendCtaUrlButton).toHaveBeenCalledTimes(1)
    expect(handleHelp).not.toHaveBeenCalled()
  })

  it('(e) sends the localized zh-HK body when the member prefers Chinese', async () => {
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: '+85291234567',
      redirectLabel: 'Contact us',
    })
    vi.mocked(resolveLanguageForMember).mockResolvedValue(Language.ZH_HK)

    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    const [, , body] = vi.mocked(sendCtaUrlButton).mock.calls[0]
    expect(body).toBe('點擊下方按鈕即可直接與我們聯絡。')
  })
})
