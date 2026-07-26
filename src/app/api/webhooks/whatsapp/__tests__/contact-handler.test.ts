import { describe, it, expect, vi, beforeEach } from 'vitest'
import { okResult, failResult } from '@/test-utils/send-result'
import { Language } from '@/domain/value-objects/language'
import { resolveContactConfig } from '@/domain/services/contact-config'

vi.mock('@/infrastructure/whatsapp/messaging', () => ({
  sendCtaUrlButton: vi.fn(),
  sendInteractiveFlow: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository', () => ({
  getRestaurantRedirect: vi.fn(),
  getContactConfig: vi.fn(),
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
vi.mock('@/infrastructure/whatsapp/flows/contact-flow-id', () => ({
  resolveContactFlowId: vi.fn(),
}))

import { handleContact } from '../contact-handler'
import { sendCtaUrlButton, sendInteractiveFlow } from '@/infrastructure/whatsapp/messaging'
import {
  getRestaurantRedirect,
  getContactConfig,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { resolveLanguageForMember } from '../resolve-language'
import { handleHelp } from '../unknown-help-handlers'
import { resolveContactFlowId } from '@/infrastructure/whatsapp/flows/contact-flow-id'

const PHONE_NUMBER_ID = 'pn-1'
// Code review M3: production always dispatches E.164 WITH the leading `+`
// (`PhoneNumber.create(message.from).value` in handlers.ts) — matching that
// here keeps the `params.data.phone` assertion in test (f) meaningful rather
// than self-fulfilling on a value production never emits.
const PHONE = '+85291234567'
const RESTAURANT_ID = 'r-1'

const REDIRECT_CONFIG = resolveContactConfig(undefined)
const FORM_CONFIG = resolveContactConfig({
  mode: 'form',
  notificationEmail: 'owner@example.com',
  topics: ['訂座查詢', '外賣及自取', '會員及積分查詢', '意見及投訴', '其他查詢'],
  ackText: null,
})

describe('handleContact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(sendCtaUrlButton).mockResolvedValue(okResult())
    vi.mocked(sendInteractiveFlow).mockResolvedValue(okResult())
    vi.mocked(handleHelp).mockResolvedValue(okResult())
    vi.mocked(findMemberByPhone).mockResolvedValue({
      id: 'm-1',
      pointsBalance: 0,
      preferredLanguage: 'en',
    })
    vi.mocked(resolveLanguageForMember).mockResolvedValue(Language.EN)
    vi.mocked(getContactConfig).mockResolvedValue(REDIRECT_CONFIG)
    vi.mocked(resolveContactFlowId).mockReturnValue('flow-123')
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
    expect(sendInteractiveFlow).not.toHaveBeenCalled()
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

  describe('form mode', () => {
    beforeEach(() => {
      vi.mocked(getContactConfig).mockResolvedValue(FORM_CONFIG)
      vi.mocked(getRestaurantRedirect).mockResolvedValue({
        redirectNumber: '+85291234567',
        redirectLabel: 'Contact us',
      })
    })

    it('(f) sends the flow with the tenant topics, phone prefill, and a cf.v1.<restaurantId>. token', async () => {
      await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

      expect(sendInteractiveFlow).toHaveBeenCalledTimes(1)
      expect(sendCtaUrlButton).not.toHaveBeenCalled()
      expect(handleHelp).not.toHaveBeenCalled()

      const [pnId, to, body, params] = vi.mocked(sendInteractiveFlow).mock.calls[0]
      expect(pnId).toBe(PHONE_NUMBER_ID)
      expect(to).toBe(PHONE)
      expect(body).toBe('請填寫以下表格,我們會盡快回覆您。')
      expect(params.flowId).toBe('flow-123')
      expect(params.flowCta).toBe('填寫表格')
      expect(params.screen).toBe('CONTACT_FORM')
      expect(params.flowToken).toMatch(new RegExp(`^cf\\.v1\\.${RESTAURANT_ID}\\.`))
      // Wire key must be `phone`, not `wa_number`/`waNumber`/`phoneNumber` —
      // see the comment in contact-handler.ts on the key-casing bug this pins.
      expect(params.data.phone).toBe(PHONE)
      expect(params.data.topics).toEqual(
        FORM_CONFIG.topics.map((t) => ({ id: t, title: t }))
      )
    })

    it('(g) falls back to redirect when the flow id env is unset', async () => {
      vi.mocked(resolveContactFlowId).mockReturnValue(null)

      await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

      expect(sendInteractiveFlow).not.toHaveBeenCalled()
      expect(sendCtaUrlButton).toHaveBeenCalledTimes(1)
      expect(handleHelp).not.toHaveBeenCalled()
    })

    it('(h) falls back to redirect when notificationEmail is null', async () => {
      vi.mocked(getContactConfig).mockResolvedValue(
        resolveContactConfig({ ...FORM_CONFIG, notificationEmail: null })
      )

      await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

      expect(sendInteractiveFlow).not.toHaveBeenCalled()
      expect(sendCtaUrlButton).toHaveBeenCalledTimes(1)
      expect(handleHelp).not.toHaveBeenCalled()
    })

    it('(i) falls back to redirect when the flow send returns ok:false', async () => {
      vi.mocked(sendInteractiveFlow).mockResolvedValue(failResult('flow_send_failed'))

      await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

      expect(sendInteractiveFlow).toHaveBeenCalledTimes(1)
      expect(sendCtaUrlButton).toHaveBeenCalledTimes(1)
      expect(handleHelp).not.toHaveBeenCalled()
    })

    it('(j) falls back to handleHelp when the flow send fails and no redirect is configured either', async () => {
      vi.mocked(sendInteractiveFlow).mockResolvedValue(failResult('flow_send_failed'))
      vi.mocked(getRestaurantRedirect).mockResolvedValue({
        redirectNumber: null,
        redirectLabel: 'Contact us',
      })

      await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

      expect(sendInteractiveFlow).toHaveBeenCalledTimes(1)
      expect(sendCtaUrlButton).not.toHaveBeenCalled()
      expect(handleHelp).toHaveBeenCalledWith(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)
    })
  })
})
