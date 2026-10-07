import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/supabase/repositories/member-repository')
vi.mock('@/infrastructure/supabase/repositories/contact-form-token-repository')
vi.mock('@/infrastructure/email/provider-factory')
vi.mock('@/infrastructure/whatsapp/messaging')

import { submitContactWebForm } from '../submit-contact-web-form'
import {
  getContactConfig,
  getRestaurantPhoneNumberId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { findMemberByPhone } from '@/infrastructure/supabase/repositories/member-repository'
import { consumeContactFormToken } from '@/infrastructure/supabase/repositories/contact-form-token-repository'
import { getEmailProvider } from '@/infrastructure/email/provider-factory'
import { sendTextMessage } from '@/infrastructure/whatsapp/messaging'

const TOKEN = 'tok-123'
const RESTAURANT_ID = 'rest-1'
const PHONE = '+85291234567'
const BODY = { clientName: '陳大文', topic: '訂座查詢' }

const mockSend = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(consumeContactFormToken).mockResolvedValue({ restaurantId: RESTAURANT_ID, phone: PHONE })
  vi.mocked(getContactConfig).mockResolvedValue({
    mode: 'form',
    notificationEmail: 'owner@example.com',
    topics: ['訂座查詢', '其他查詢'],
    ackText: null,
    labels: {
      title: '聯絡我們',
      nameLabel: '姓名',
      phoneLabel: 'WhatsApp 號碼',
      topicLabel: '查詢主題',
      submitLabel: '提交',
    },
  })
  vi.mocked(findMemberByPhone).mockResolvedValue({
    id: 'm-1',
    name: 'Xavier',
    pointsBalance: 0,
    preferredLanguage: null,
  })
  vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('phone-num-id')
  mockSend.mockResolvedValue({ ok: true })
  vi.mocked(getEmailProvider).mockReturnValue({ send: mockSend } as never)
  vi.mocked(sendTextMessage).mockResolvedValue({ ok: true } as never)
})

describe('submitContactWebForm', () => {
  it('emails the restaurant and acks the customer on success', async () => {
    const result = await submitContactWebForm(TOKEN, BODY)

    expect(result).toEqual({ ok: true })
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend.mock.calls[0][0].to).toBe('owner@example.com')
    expect(sendTextMessage).toHaveBeenCalledWith('phone-num-id', PHONE, expect.any(String))
  })

  // The whole point of the one-off token: the claim must happen before any
  // work, so a second concurrent submit does nothing at all.
  it('claims the token before doing anything else', async () => {
    vi.mocked(consumeContactFormToken).mockResolvedValue(null)

    const result = await submitContactWebForm(TOKEN, BODY)

    expect(result).toEqual({ ok: false, reason: 'token_unusable' })
    expect(getContactConfig).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  // Two sections describing two people: the form carries whoever the enquiry
  // is about, the sender section carries the authenticated handset. A member
  // enquiring for someone else is ordinary and is never flagged.
  it('reports the typed number in the form and the token phone as the sender', async () => {
    await submitContactWebForm(TOKEN, { ...BODY, clientWhatsapp: '+85299999999' })

    const emailText = mockSend.mock.calls[0][0].text as string
    const [form, sender] = emailText.split('提交查詢的會員:')
    expect(form).toContain('+85299999999')
    expect(sender).toContain(PHONE)
    expect(emailText).not.toContain('⚠️')
  })

  // A web submission carries no WhatsApp profile name, but the sender is
  // usually a known member — "(未提供)" about someone we have on file is wrong.
  it('names the customer from the member record', async () => {
    await submitContactWebForm(TOKEN, BODY)

    expect(findMemberByPhone).toHaveBeenCalledWith(RESTAURANT_ID, PHONE)
    expect(mockSend.mock.calls[0][0].text).toContain('Xavier')
  })

  it.each([
    ['the sender is not a member', () => vi.mocked(findMemberByPhone).mockResolvedValue(null)],
    ['the lookup throws', () => vi.mocked(findMemberByPhone).mockRejectedValue(new Error('db'))],
  ])('still succeeds when %s', async (_label, arrange) => {
    arrange()

    expect(await submitContactWebForm(TOKEN, BODY)).toEqual({ ok: true })
    expect(mockSend.mock.calls[0][0].text).toContain('(未提供)')
  })

  it('rejects a body whose topic is not in the tenant configured set', async () => {
    const result = await submitContactWebForm(TOKEN, { clientName: '陳大文', topic: '任意' })

    expect(result).toEqual({ ok: false, reason: 'invalid_submission', detail: 'topic_not_allowed' })
    expect(mockSend).not.toHaveBeenCalled()
  })

  // Failing closed: the token is already burnt when the body turns out bad, so
  // a tampered client does not get a second attempt.
  it('does not re-arm the token when the body is rejected', async () => {
    await submitContactWebForm(TOKEN, { clientName: '' })

    expect(consumeContactFormToken).toHaveBeenCalledTimes(1)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('fails when the tenant has no notification email, without acking', async () => {
    vi.mocked(getContactConfig).mockResolvedValue({
      mode: 'form',
      notificationEmail: null,
      topics: ['訂座查詢'],
      ackText: null,
      labels: {
        title: 't',
        nameLabel: 'n',
        phoneLabel: 'p',
        topicLabel: 'to',
        submitLabel: 's',
      },
    })

    const result = await submitContactWebForm(TOKEN, BODY)

    expect(result).toEqual({
      ok: false,
      reason: 'email_failed',
      detail: 'no_notification_email',
    })
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  it('reports an email send failure and does not ack', async () => {
    mockSend.mockResolvedValue({ ok: false, error: 'smtp down' })

    const result = await submitContactWebForm(TOKEN, BODY)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('email_failed')
    expect(sendTextMessage).not.toHaveBeenCalled()
  })

  // The restaurant's copy of the enquiry is what matters; the customer already
  // has an on-page confirmation, so a dead 24-hour window must not undo it.
  it('still succeeds when the WhatsApp ack fails', async () => {
    vi.mocked(sendTextMessage).mockResolvedValue({ ok: false, error: 'outside 24h window' } as never)

    expect(await submitContactWebForm(TOKEN, BODY)).toEqual({ ok: true })
  })

  it('still succeeds when the ack throws', async () => {
    vi.mocked(sendTextMessage).mockRejectedValue(new Error('boom'))

    expect(await submitContactWebForm(TOKEN, BODY)).toEqual({ ok: true })
  })

  it('skips the ack when the tenant has no phone number id', async () => {
    vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('')

    expect(await submitContactWebForm(TOKEN, BODY)).toEqual({ ok: true })
    expect(sendTextMessage).not.toHaveBeenCalled()
  })
})
