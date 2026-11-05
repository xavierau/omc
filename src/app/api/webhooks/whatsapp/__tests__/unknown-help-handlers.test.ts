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
  getReplyConfig: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/reward-repository', () => ({
  hasActiveRewards: vi.fn(),
}))
vi.mock('../resolve-language', () => ({
  resolveLanguageForMember: vi.fn(),
}))

import { handleUnknown, handleHelp } from '../unknown-help-handlers'
import {
  sendTextMessage,
  sendInteractiveButtons,
  sendInteractiveList,
} from '@/infrastructure/whatsapp/messaging'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import {
  getRestaurantRedirect,
  getReplyConfig,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { hasActiveRewards } from '@/infrastructure/supabase/repositories/reward-repository'
import { resolveReplyConfig } from '@/domain/services/reply-config'
import { resolveLanguageForMember } from '../resolve-language'

const PHONE_NUMBER_ID = 'pn-1'
const PHONE = '85291234567'
const RESTAURANT_ID = 'r-1'
const MEMBER = { id: 'm-1', name: null, pointsBalance: 10, preferredLanguage: 'en' }

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
    vi.mocked(hasActiveRewards).mockResolvedValue(true)
    // Default: all functions ON, no custom copy (today's behavior).
    vi.mocked(getReplyConfig).mockResolvedValue(resolveReplyConfig(undefined))
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

  // REPLY-002: hide "View Rewards" when the restaurant has no active rewards
  it('member + no active rewards + redirect unset → buttons omit REWARDS', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)
    vi.mocked(hasActiveRewards).mockResolvedValue(false)

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendInteractiveList).not.toHaveBeenCalled()
    const [, , , buttons] = vi.mocked(sendInteractiveButtons).mock.calls[0]
    expect(buttons).toEqual([
      { id: 'POINTS', title: 'Check Points' },
      { id: 'HELP', title: 'Help' },
    ])
    expect(buttons.map((b) => b.id)).not.toContain('REWARDS')
  })

  it('member + no active rewards + redirect set → 3 buttons [Points, Help, Contact] (not a list)', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)
    vi.mocked(hasActiveRewards).mockResolvedValue(false)
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: '+85291234567',
      redirectLabel: 'Call Us',
    })

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendInteractiveList).not.toHaveBeenCalled()
    const [, , , buttons] = vi.mocked(sendInteractiveButtons).mock.calls[0]
    expect(buttons).toEqual([
      { id: 'POINTS', title: 'Check Points' },
      { id: 'HELP', title: 'Help' },
      { id: 'CONTACT', title: 'Call Us' },
    ])
  })

  it('non-member → hasActiveRewards not consulted (no reward option in the Join menu)', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(null)

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(hasActiveRewards).not.toHaveBeenCalled()
  })

  // REPLY-003: per-restaurant function toggles + custom copy
  it('points disabled → menu omits the Check Points row', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)
    vi.mocked(getReplyConfig).mockResolvedValue(
      resolveReplyConfig({ features: { points: false } })
    )

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    const [, , , buttons] = vi.mocked(sendInteractiveButtons).mock.calls[0]
    expect(buttons).toEqual([
      { id: 'REWARDS', title: 'View Rewards' },
      { id: 'HELP', title: 'Help' },
    ])
    expect(buttons.map((b) => b.id)).not.toContain('POINTS')
  })

  it('rewards disabled → menu omits REWARDS even when active rewards exist, and skips the hasActiveRewards query', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)
    vi.mocked(hasActiveRewards).mockResolvedValue(true)
    vi.mocked(getReplyConfig).mockResolvedValue(
      resolveReplyConfig({ features: { rewards: false } })
    )

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    const [, , , buttons] = vi.mocked(sendInteractiveButtons).mock.calls[0]
    expect(buttons).toEqual([
      { id: 'POINTS', title: 'Check Points' },
      { id: 'HELP', title: 'Help' },
    ])
    expect(hasActiveRewards).not.toHaveBeenCalled()
  })

  // REPLY-004: the HELP menu button is a per-tenant feature toggle too
  it('help disabled → menu omits the Help row (button only)', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)
    vi.mocked(getReplyConfig).mockResolvedValue(
      resolveReplyConfig({ features: { help: false } })
    )

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    const [, , , buttons] = vi.mocked(sendInteractiveButtons).mock.calls[0]
    expect(buttons).toEqual([
      { id: 'POINTS', title: 'Check Points' },
      { id: 'REWARDS', title: 'View Rewards' },
    ])
    expect(buttons.map((b) => b.id)).not.toContain('HELP')
  })

  it('help disabled → non-member Join menu is unaffected (help is member-only)', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(null)
    vi.mocked(getReplyConfig).mockResolvedValue(
      resolveReplyConfig({ features: { help: false } })
    )

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    const [, , , buttons] = vi.mocked(sendInteractiveButtons).mock.calls[0]
    expect(buttons).toEqual([{ id: 'JOIN', title: 'Join Rewards' }])
  })

  it('typed HELP still replies with the command list when the help button is disabled', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)
    vi.mocked(getReplyConfig).mockResolvedValue(
      resolveReplyConfig({ features: { help: false } })
    )
    vi.mocked(sendTextMessage).mockResolvedValue(okResult())

    await handleHelp(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      PHONE,
      expect.stringContaining('Available commands')
    )
  })

  it('member with every menu function disabled + no contact → plain text body (no empty interactive)', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)
    vi.mocked(getReplyConfig).mockResolvedValue(
      resolveReplyConfig({ features: { points: false, rewards: false, help: false } })
    )
    vi.mocked(sendTextMessage).mockResolvedValue(okResult())

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendInteractiveButtons).not.toHaveBeenCalled()
    expect(sendInteractiveList).not.toHaveBeenCalled()
    expect(sendTextMessage).toHaveBeenCalledTimes(1)
    const [pnId, to, body] = vi.mocked(sendTextMessage).mock.calls[0]
    expect(pnId).toBe(PHONE_NUMBER_ID)
    expect(to).toBe(PHONE)
    expect(body).toContain("didn't understand")
  })

  it('custom "unknown" text overrides the default body for a member', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(MEMBER)
    vi.mocked(getReplyConfig).mockResolvedValue(
      resolveReplyConfig({ text: { unknown: { en: 'Type MENU for help 🙂' } } })
    )

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    const [, , body] = vi.mocked(sendInteractiveButtons).mock.calls[0]
    expect(body).toBe('Type MENU for help 🙂')
  })

  it('custom "join" text overrides the default welcome body for a non-member', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(null)
    vi.mocked(getReplyConfig).mockResolvedValue(
      resolveReplyConfig({ text: { join: { en: 'Be our VIP — reply JOIN' } } })
    )

    await handleUnknown(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    const [, , body] = vi.mocked(sendInteractiveButtons).mock.calls[0]
    expect(body).toBe('Be our VIP — reply JOIN')
  })
})
