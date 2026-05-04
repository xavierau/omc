import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/whatsapp/messaging')
vi.mock('@/infrastructure/supabase/repositories/member-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')

import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'
import {
  findMemberByPhone,
  setMemberPreferredLanguageIfUnset,
  updateMemberPreferredLanguage,
} from '@/infrastructure/supabase/repositories/member-repository'
import { getRestaurantPhoneNumberId } from '@/infrastructure/supabase/repositories/restaurant-repository'
import {
  maybeHandleLanguageCommand,
  maybeDetectLanguageForExistingMember,
} from '../language-handler'
import type { KapsoMessage } from '@/infrastructure/whatsapp/webhooks'
import { okResult } from '@/test-utils/send-result'

const RESTAURANT_ID = 'rest-uuid'
const PHONE = '+85298765432'
const PHONE_NUMBER_ID = 'pn-1'

function makeMessage(text: string): KapsoMessage {
  return {
    messageId: 'wamid.test',
    from: PHONE,
    type: 'text',
    text,
    contactName: 'Tester',
    timestamp: new Date().toISOString(),
  } as KapsoMessage
}

describe('maybeHandleLanguageCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue(PHONE_NUMBER_ID)
    vi.mocked(sendTextMessage).mockResolvedValue(okResult())
    vi.mocked(updateMemberPreferredLanguage).mockResolvedValue(undefined)
  })

  it('returns false for non-command text', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(null)
    const handled = await maybeHandleLanguageCommand(
      makeMessage('hello world'),
      RESTAURANT_ID
    )
    expect(handled).toBe(false)
    expect(updateMemberPreferredLanguage).not.toHaveBeenCalled()
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('existing member + LANG EN → persists en + replies in EN', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue({
      id: 'm-1',
      pointsBalance: 0,
      preferredLanguage: 'zh_hk',
    })

    const handled = await maybeHandleLanguageCommand(
      makeMessage('LANG EN'),
      RESTAURANT_ID
    )

    expect(handled).toBe(true)
    expect(updateMemberPreferredLanguage).toHaveBeenCalledWith('m-1', RESTAURANT_ID, 'en')
    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      PHONE,
      expect.stringContaining('Language set to English')
    )
  })

  it('existing member + 語言 中文 → persists zh_hk + replies in ZH', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue({
      id: 'm-2',
      pointsBalance: 0,
      preferredLanguage: 'en',
    })

    const handled = await maybeHandleLanguageCommand(
      makeMessage('語言 中文'),
      RESTAURANT_ID
    )

    expect(handled).toBe(true)
    expect(updateMemberPreferredLanguage).toHaveBeenCalledWith('m-2', RESTAURANT_ID, 'zh_hk')
    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      PHONE,
      expect.stringContaining('語言已設定為繁體中文')
    )
  })

  it('non-member + LANG EN → replies (no persist), asks to JOIN first in EN', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(null)

    const handled = await maybeHandleLanguageCommand(
      makeMessage('LANG EN'),
      RESTAURANT_ID
    )

    expect(handled).toBe(true)
    expect(updateMemberPreferredLanguage).not.toHaveBeenCalled()
    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      PHONE,
      'Reply JOIN to sign up first.'
    )
  })

  it('non-member + 語言 中文 → replies (no persist), asks to JOIN first in ZH', async () => {
    vi.mocked(findMemberByPhone).mockResolvedValue(null)

    const handled = await maybeHandleLanguageCommand(
      makeMessage('語言 中文'),
      RESTAURANT_ID
    )

    expect(handled).toBe(true)
    expect(updateMemberPreferredLanguage).not.toHaveBeenCalled()
    expect(sendTextMessage).toHaveBeenCalledWith(
      PHONE_NUMBER_ID,
      PHONE,
      '請回覆 JOIN 註冊。'
    )
  })

  it('returns false for non-text message type (image)', async () => {
    const imageMessage = {
      messageId: 'wamid.test',
      from: PHONE,
      type: 'image',
      imageUrl: 'https://example.test/img.jpg',
      timestamp: new Date().toISOString(),
    } as KapsoMessage

    const handled = await maybeHandleLanguageCommand(imageMessage, RESTAURANT_ID)

    expect(handled).toBe(false)
    expect(updateMemberPreferredLanguage).not.toHaveBeenCalled()
  })
})

describe('maybeDetectLanguageForExistingMember', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(setMemberPreferredLanguageIfUnset).mockResolvedValue(undefined)
    vi.mocked(updateMemberPreferredLanguage).mockResolvedValue(undefined)
  })

  it('persists detected Chinese via guarded UPDATE when member.preferredLanguage is null', async () => {
    await maybeDetectLanguageForExistingMember(
      { id: 'm-1', preferredLanguage: null },
      RESTAURANT_ID,
      '你好 POINTS'
    )

    expect(setMemberPreferredLanguageIfUnset).toHaveBeenCalledWith('m-1', RESTAURANT_ID, 'zh_hk')
    // Silent-detect must NEVER touch the unguarded update function.
    expect(updateMemberPreferredLanguage).not.toHaveBeenCalled()
  })

  it('persists detected English via guarded UPDATE when member.preferredLanguage is null', async () => {
    await maybeDetectLanguageForExistingMember(
      { id: 'm-2', preferredLanguage: null },
      RESTAURANT_ID,
      'POINTS'
    )

    expect(setMemberPreferredLanguageIfUnset).toHaveBeenCalledWith('m-2', RESTAURANT_ID, 'en')
  })

  it('no-op when member already has preferred_language set (no DB writes)', async () => {
    await maybeDetectLanguageForExistingMember(
      { id: 'm-3', preferredLanguage: 'en' },
      RESTAURANT_ID,
      '你好'
    )

    expect(setMemberPreferredLanguageIfUnset).not.toHaveBeenCalled()
    expect(findMemberByPhone).not.toHaveBeenCalled()
  })

  it('no-op when text has no script signal (emoji/symbols)', async () => {
    await maybeDetectLanguageForExistingMember(
      { id: 'm-4', preferredLanguage: null },
      RESTAURANT_ID,
      '😀👍!!!'
    )

    expect(setMemberPreferredLanguageIfUnset).not.toHaveBeenCalled()
  })

  it('no-op when member is null — zero DB access for unknown senders', async () => {
    await maybeDetectLanguageForExistingMember(null, RESTAURANT_ID, 'hello')

    expect(findMemberByPhone).not.toHaveBeenCalled()
    expect(setMemberPreferredLanguageIfUnset).not.toHaveBeenCalled()
  })

  it('no-op when text is null (e.g. non-text message)', async () => {
    await maybeDetectLanguageForExistingMember(
      { id: 'm-5', preferredLanguage: null },
      RESTAURANT_ID,
      null
    )

    expect(setMemberPreferredLanguageIfUnset).not.toHaveBeenCalled()
  })
})
