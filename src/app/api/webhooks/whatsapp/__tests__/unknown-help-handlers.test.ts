import { describe, it, expect, vi, beforeEach } from 'vitest'
import { okResult } from '@/test-utils/send-result'
import { Language } from '@/domain/value-objects/language'

vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendTextMessage: vi.fn(),
  sendInteractiveButtons: vi.fn(),
  sendInteractiveList: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/member-repository', () => ({
  findMemberByPhone: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getRestaurantRedirect: vi.fn(),
}))
vi.mock('../resolve-language', () => ({
  resolveLanguageForMember: vi.fn(),
}))

import { handleUnknown } from '../unknown-help-handlers'
import {
  sendInteractiveButtons,
  sendInteractiveList,
} from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { getRestaurantRedirect } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { resolveLanguageForMember } from '../resolve-language'

const PHONE_NUMBER_ID = 'pn-1'
const PHONE = '85291234567'
const RESTAURANT_ID = 'r-1'
const MEMBER = { id: 'm-1', pointsBalance: 10, preferredLanguage: 'en' }

describe('handleUnknown — fallback menu (REPLY-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendInteractiveButtons).mockResolvedValue(okResult())
    vi.mocked(sendInteractiveList).mockResolvedValue(okResult())
    vi.mocked(resolveLanguageForMember).mockResolvedValue(Language.EN)
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: null,
      redirectLabel: 'Contact us',
    })
  })

  it('(a) member + redirect set → interactive LIST with 4 rows, Contact last', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: '+85291234567',
      redirectLabel: 'Call Us',
    })

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendInteractiveButtons).not.toHaveBeenCalled()
    expect(sendInteractiveList).toHaveBeenCalledTimes(1)
    const [pnId, to, , buttonText, sections] =
      vi.mocked(sendInteractiveList).mock.calls[0]
    expect(pnId).toBe(PHONE_NUMBER_ID)
    expect(to).toBe(PHONE)
    expect(buttonText).toBe('Options')
    expect(sections[0].title).toBeUndefined()
    expect(sections[0].rows).toEqual([
      { id: 'POINTS', title: 'Check Points' },
      { id: 'REWARDS', title: 'View Rewards' },
      { id: 'HELP', title: 'Help' },
      { id: 'CONTACT', title: 'Call Us' },
    ])
  })

  it('(b) member + redirect unset → 3 reply buttons (regression guard)', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendInteractiveList).not.toHaveBeenCalled()
    expect(sendInteractiveButtons).toHaveBeenCalledTimes(1)
    const [, , , buttons] = vi.mocked(sendInteractiveButtons).mock.calls[0]
    expect(buttons).toEqual([
      { id: 'POINTS', title: 'Check Points' },
      { id: 'REWARDS', title: 'View Rewards' },
      { id: 'HELP', title: 'Help' },
    ])
  })

  it('(c) member + invalid stored number → 3 buttons, Contact row omitted', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: 'not-a-number',
      redirectLabel: 'Bad',
    })

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendInteractiveList).not.toHaveBeenCalled()
    const [, , , buttons] = vi.mocked(sendInteractiveButtons).mock.calls[0]
    expect(buttons).toHaveLength(3)
    expect(buttons.map((b) => b.id)).not.toContain('CONTACT')
  })

  it('(d) non-member + redirect set → 2 buttons [Join, Contact]', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(null)
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: '+85291234567',
      redirectLabel: 'Call Us',
    })

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendInteractiveList).not.toHaveBeenCalled()
    const [pnId, to, body, buttons] =
      vi.mocked(sendInteractiveButtons).mock.calls[0]
    expect(pnId).toBe(PHONE_NUMBER_ID)
    expect(to).toBe(PHONE)
    expect(body).toContain('Welcome!')
    expect(buttons).toEqual([
      { id: 'JOIN', title: 'Join Rewards' },
      { id: 'CONTACT', title: 'Call Us' },
    ])
  })

  it('(e) non-member + redirect unset → single Join button (sendJoinInvite preserved)', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(null)

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendInteractiveList).not.toHaveBeenCalled()
    expect(sendInteractiveButtons).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      PHONE,
      expect.stringContaining('Welcome!'),
      [{ id: 'JOIN', title: 'Join Rewards' }]
    )
  })

  it('member + redirect set, ZH → list uses ZH member titles + 選項', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)
    vi.mocked(resolveLanguageForMember).mockResolvedValue(Language.ZH_HK)
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: '+85291234567',
      redirectLabel: '聯絡我們',
    })

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    const [, , , buttonText, sections] =
      vi.mocked(sendInteractiveList).mock.calls[0]
    expect(buttonText).toBe('選項')
    expect(sections[0].rows).toEqual([
      { id: 'POINTS', title: '查詢積分' },
      { id: 'REWARDS', title: '查看獎賞' },
      { id: 'HELP', title: '幫助' },
      { id: 'CONTACT', title: '聯絡我們' },
    ])
  })
})
