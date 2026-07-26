import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  getContactFlowId: vi.fn(),
  getRestaurantSlug: vi.fn(),
  // Not imported by contact-handler.ts, but mocked here so test (g2) can
  // assert the send path never writes to the repository — a real write
  // import would fail loudly (undefined is not a function) rather than
  // silently no-op if this guard weren't in place.
  updateContactFlowId: vi.fn(),
  updateContactConfig: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/contact-form-token-repository', () => ({
  createContactFormToken: vi.fn(),
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

import flow from '@/infrastructure/whatsapp/flows/contact-form-flow.json'
import { handleContact, FLOW_LABEL_DATA_KEYS } from '../contact-handler'
import { sendCtaUrlButton, sendInteractiveFlow } from '@/infrastructure/whatsapp/messaging'
import {
  getRestaurantRedirect,
  getContactConfig,
  getContactFlowId,
  getRestaurantSlug,
  updateContactFlowId,
  updateContactConfig,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { createContactFormToken } from '@/infrastructure/supabase/repositories/contact-form-token-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { resolveLanguageForMember } from '../resolve-language'
import { handleHelp } from '../unknown-help-handlers'

const PHONE_NUMBER_ID = 'pn-1'
// Code review M3: production always dispatches E.164 WITH the leading `+`
// (`PhoneNumber.create(message.from).value` in handlers.ts) — matching that
// here keeps the `params.data.phone` assertion in test (f) meaningful rather
// than self-fulfilling on a value production never emits.
const PHONE = '+85291234567'
const RESTAURANT_ID = 'r-1'

const REDIRECT_CONFIG = resolveContactConfig(undefined)
// Mix of custom (title, nameLabel) and default (phoneLabel, topicLabel,
// submitLabel — omitted here so the resolver falls back to DEFAULT_LABELS)
// labels, so test (f) exercises both branches of the resolver in one config.
const FORM_CONFIG = resolveContactConfig({
  mode: 'form',
  notificationEmail: 'owner@example.com',
  topics: ['訂座查詢', '外賣及自取', '會員及積分查詢', '意見及投訴', '其他查詢'],
  ackText: null,
  labels: {
    title: '歡迎查詢',
    nameLabel: '您的姓名',
  },
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
    vi.mocked(getContactFlowId).mockResolvedValue('flow-123')
    // Web-form rung (REPLY-008) off by default: these tests predate it and
    // assert the Flow/redirect rungs. Its own describe block below opts in.
    vi.mocked(getRestaurantSlug).mockResolvedValue(null)
    vi.mocked(createContactFormToken).mockResolvedValue(null)
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
      expect(getContactFlowId).toHaveBeenCalledWith(RESTAURANT_ID)

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

    it('(f2) always sends all five label keys, mixing tenant-custom and resolver-default values', async () => {
      await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

      const [, , , params] = vi.mocked(sendInteractiveFlow).mock.calls[0]
      // FORM_CONFIG customises title + nameLabel only; phone/topic/submit
      // labels fall through resolveContactConfig to DEFAULT_LABELS — this
      // asserts the send payload reflects that same mix, not just defaults.
      expect(FORM_CONFIG.labels.title).toBe('歡迎查詢')
      expect(FORM_CONFIG.labels.nameLabel).toBe('您的姓名')
      expect(params.data[FLOW_LABEL_DATA_KEYS.title]).toBe(FORM_CONFIG.labels.title)
      expect(params.data[FLOW_LABEL_DATA_KEYS.nameLabel]).toBe(FORM_CONFIG.labels.nameLabel)
      expect(params.data[FLOW_LABEL_DATA_KEYS.phoneLabel]).toBe(FORM_CONFIG.labels.phoneLabel)
      expect(params.data[FLOW_LABEL_DATA_KEYS.topicLabel]).toBe(FORM_CONFIG.labels.topicLabel)
      expect(params.data[FLOW_LABEL_DATA_KEYS.submitLabel]).toBe(FORM_CONFIG.labels.submitLabel)
    })

    it('(f3) the outbound data key set equals the Flow JSON screen data key set (M3 — pins the payload, not just the JSON, to the contract)', async () => {
      await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

      const [, , , params] = vi.mocked(sendInteractiveFlow).mock.calls[0]
      expect(new Set(Object.keys(params.data))).toEqual(new Set(Object.keys(flow.screens[0].data)))
    })

    it('(g) falls back to redirect when the tenant has no deployed flow id', async () => {
      vi.mocked(getContactFlowId).mockResolvedValue(null)

      await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

      expect(sendInteractiveFlow).not.toHaveBeenCalled()
      expect(sendCtaUrlButton).toHaveBeenCalledTimes(1)
      expect(handleHelp).not.toHaveBeenCalled()
    })

    it('(g2) the send path never writes to the repository', async () => {
      await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

      expect(updateContactFlowId).not.toHaveBeenCalled()
      expect(updateContactConfig).not.toHaveBeenCalled()
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

// REPLY-007 AD-5: the global env scheme this file used to mock
// (`resolveContactFlowId` / `WHATSAPP_CONTACT_FLOW_ID`) is hard-removed, not
// deprecated — a fallback to it would ship a guaranteed-failing foreign flow
// id for every tenant except the one that env var happened to target. This
// guards the removal mechanically rather than relying on humans to notice a
// stray reference creep back in.
//
// Scoped to `src/` — `scripts/deploy-contact-flow.ts` is Stream B3's own env
// scheme rework (out of this task's boundaries) and is expected to still
// reference the var until that stream lands.
describe('WHATSAPP_CONTACT_FLOW_ID removal (AD-5)', () => {
  it('no file under src/ references the retired env var or its module', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const srcRoot = path.resolve(__dirname, '../../../../../')
    // This file itself documents the removal (comments + assertion strings
    // below) and must not flag itself.
    const selfPath = path.resolve(__filename)
    const offenders: string[] = []

    function walk(dir: string) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
          continue
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue
        if (full === selfPath) continue
        const contents = fs.readFileSync(full, 'utf8')
        if (
          contents.includes('WHATSAPP_CONTACT_FLOW_ID') ||
          contents.includes('resolveContactFlowId') ||
          contents.includes("flows/contact-flow-id")
        ) {
          offenders.push(full)
        }
      }
    }

    walk(srcRoot)

    expect(offenders).toEqual([])
  })

  it('the deleted contact-flow-id module and its test no longer exist', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')

    const moduleFile = path.resolve(__dirname, '../../../../../infrastructure/whatsapp/flows/contact-flow-id.ts')
    const testFile = path.resolve(
      __dirname,
      '../../../../../infrastructure/whatsapp/flows/__tests__/contact-flow-id.test.ts'
    )

    expect(fs.existsSync(moduleFile)).toBe(false)
    expect(fs.existsSync(testFile)).toBe(false)
  })
})

/**
 * REPLY-008: the web-form rung sits between the Flow and the wa.me redirect.
 * These tests pin the ladder ORDER, because that ordering is the whole design:
 * the Flow must still win when available (so the rung disappears by itself the
 * day Meta approves), and the redirect must still catch everything below.
 */
describe('handleContact — web form fallback (REPLY-008)', () => {
  const APP_URL = 'https://app.ohmyclient.io'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_URL', APP_URL)
    vi.mocked(sendCtaUrlButton).mockResolvedValue(okResult())
    vi.mocked(sendInteractiveFlow).mockResolvedValue(okResult())
    vi.mocked(handleHelp).mockResolvedValue(okResult())
    vi.mocked(findMemberByPhone).mockResolvedValue(null)
    vi.mocked(resolveLanguageForMember).mockResolvedValue(Language.EN)
    vi.mocked(getContactConfig).mockResolvedValue(FORM_CONFIG)
    vi.mocked(getRestaurantSlug).mockResolvedValue('kushiro')
    vi.mocked(createContactFormToken).mockResolvedValue('tok-abc')
    vi.mocked(getRestaurantRedirect).mockResolvedValue({
      redirectNumber: '+85298765432',
      redirectLabel: 'Call Us',
    })
    // No deployed Flow — the state every tenant is in while publishing is
    // blocked account-side (issue #78).
    vi.mocked(getContactFlowId).mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('sends a token-bearing form link when no Flow is deployed', async () => {
    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(createContactFormToken).toHaveBeenCalledWith(RESTAURANT_ID, PHONE)
    expect(sendCtaUrlButton).toHaveBeenCalledTimes(1)
    const [, to, , displayText, url] = vi.mocked(sendCtaUrlButton).mock.calls[0]
    expect(to).toBe(PHONE)
    expect(url).toBe(`${APP_URL}/contact/kushiro?t=tok-abc`)
    // CTA label is the tenant's own title, so the button reads the same as the
    // Flow it stands in for.
    expect(displayText).toBe(FORM_CONFIG.labels.title)
  })

  it('tells the customer up front that the link expires', async () => {
    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    const footer = vi.mocked(sendCtaUrlButton).mock.calls[0][5]
    expect(footer).toContain('30')
  })

  // The rung must be invisible once Flows work again — no config change, no
  // migration back.
  it('never reaches the web form when a Flow is deployed and sends', async () => {
    vi.mocked(getContactFlowId).mockResolvedValue('flow-123')

    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendInteractiveFlow).toHaveBeenCalledTimes(1)
    expect(createContactFormToken).not.toHaveBeenCalled()
    expect(sendCtaUrlButton).not.toHaveBeenCalled()
  })

  it('falls to the web form when a deployed Flow fails to send', async () => {
    vi.mocked(getContactFlowId).mockResolvedValue('flow-123')
    vi.mocked(sendInteractiveFlow).mockResolvedValue(failResult('flow send failed'))

    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(createContactFormToken).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendCtaUrlButton).mock.calls[0][4]).toContain('/contact/kushiro')
  })

  it.each([
    ['the token cannot be minted', () => vi.mocked(createContactFormToken).mockResolvedValue(null)],
    ['the tenant has no slug', () => vi.mocked(getRestaurantSlug).mockResolvedValue(null)],
    ['no app url is configured', () => vi.stubEnv('NEXT_PUBLIC_APP_URL', '')],
  ])('degrades to the wa.me redirect when %s', async (_label, arrange) => {
    arrange()

    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendCtaUrlButton).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendCtaUrlButton).mock.calls[0][4]).toContain('wa.me/85298765432')
  })

  it('degrades to the wa.me redirect when the form link itself fails to send', async () => {
    vi.mocked(sendCtaUrlButton)
      .mockResolvedValueOnce(failResult('cta send failed'))
      .mockResolvedValueOnce(okResult())

    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(sendCtaUrlButton).toHaveBeenCalledTimes(2)
    expect(vi.mocked(sendCtaUrlButton).mock.calls[1][4]).toContain('wa.me/85298765432')
  })

  // A tenant in redirect mode never opted into collecting form submissions.
  it('is not offered to a tenant in redirect mode', async () => {
    vi.mocked(getContactConfig).mockResolvedValue(REDIRECT_CONFIG)

    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(createContactFormToken).not.toHaveBeenCalled()
    expect(vi.mocked(sendCtaUrlButton).mock.calls[0][4]).toContain('wa.me/')
  })

  // Without a notification address the submission has nowhere to go, so
  // offering the form would collect an enquiry no one ever reads.
  it('is not offered to a form-mode tenant with no notification email', async () => {
    vi.mocked(getContactConfig).mockResolvedValue(
      resolveContactConfig({ mode: 'form', notificationEmail: null })
    )

    await handleContact(PHONE_NUMBER_ID, PHONE, RESTAURANT_ID)

    expect(createContactFormToken).not.toHaveBeenCalled()
  })
})
