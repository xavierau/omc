import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSendInteractiveList = vi.fn()
const mockSendInteractiveCtaUrl = vi.fn()

vi.mock('@kapso/whatsapp-cloud-api', () => ({
  WhatsAppClient: class {
    messages = {
      sendInteractiveList: mockSendInteractiveList,
      sendInteractiveCtaUrl: mockSendInteractiveCtaUrl,
    }
  },
}))

const OLD_ENV = process.env

async function importClient() {
  vi.resetModules()
  return import('../client')
}

const SECTIONS = [
  { rows: [{ id: 'CONTACT', title: 'Contact us' }] },
]

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...OLD_ENV }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  process.env = OLD_ENV
})

describe('sendInteractiveList (kapso client)', () => {
  it('returns skipResult when no API key', async () => {
    delete process.env.KAPSO_API_KEY
    const { sendInteractiveList } = await importClient()
    const result = await sendInteractiveList(
      'phone1', '+1234', 'body', 'Options', SECTIONS
    )
    expect(result).toEqual({
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'kapso_no_api_key' },
    })
    expect(mockSendInteractiveList).not.toHaveBeenCalled()
  })

  it('returns skipResult when phoneNumberId is empty', async () => {
    process.env.KAPSO_API_KEY = 'key'
    const { sendInteractiveList } = await importClient()
    const result = await sendInteractiveList(
      '', '+1234', 'body', 'Options', SECTIONS
    )
    expect(result).toEqual({
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'kapso_no_phone_number_id' },
    })
    expect(mockSendInteractiveList).not.toHaveBeenCalled()
  })

  it('maps SDK success via successFromResponse', async () => {
    process.env.KAPSO_API_KEY = 'key'
    mockSendInteractiveList.mockResolvedValue({
      messages: [{ id: 'wamid.list' }],
    })
    const { sendInteractiveList } = await importClient()
    const result = await sendInteractiveList(
      'phone1', '+1234', 'body', 'Options', SECTIONS, 'footer'
    )
    expect(mockSendInteractiveList).toHaveBeenCalledWith({
      phoneNumberId: 'phone1',
      to: '+1234',
      bodyText: 'body',
      buttonText: 'Options',
      sections: SECTIONS,
      footerText: 'footer',
    })
    expect(result).toEqual({
      ok: true,
      kapsoMessageId: 'wamid.list',
      raw: { messages: [{ id: 'wamid.list' }] },
    })
  })

  it('returns errorResult when the SDK throws', async () => {
    process.env.KAPSO_API_KEY = 'key'
    mockSendInteractiveList.mockRejectedValue(new Error('boom'))
    const { sendInteractiveList } = await importClient()
    const result = await sendInteractiveList(
      'phone1', '+1234', 'body', 'Options', SECTIONS
    )
    expect(result).toEqual({
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'kapso_send_error', details: 'boom' },
    })
  })
})

describe('sendCtaUrlButton (kapso client)', () => {
  it('returns skipResult when no API key', async () => {
    delete process.env.KAPSO_API_KEY
    const { sendCtaUrlButton } = await importClient()
    const result = await sendCtaUrlButton(
      'phone1', '+1234', 'body', 'Contact us', 'https://wa.me/85291234567'
    )
    expect(result).toEqual({
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'kapso_no_api_key' },
    })
    expect(mockSendInteractiveCtaUrl).not.toHaveBeenCalled()
  })

  it('returns skipResult when phoneNumberId is empty', async () => {
    process.env.KAPSO_API_KEY = 'key'
    const { sendCtaUrlButton } = await importClient()
    const result = await sendCtaUrlButton(
      '', '+1234', 'body', 'Contact us', 'https://wa.me/85291234567'
    )
    expect(result).toEqual({
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'kapso_no_phone_number_id' },
    })
    expect(mockSendInteractiveCtaUrl).not.toHaveBeenCalled()
  })

  it('maps SDK success and passes parameters { displayText, url }', async () => {
    process.env.KAPSO_API_KEY = 'key'
    mockSendInteractiveCtaUrl.mockResolvedValue({
      messages: [{ id: 'wamid.cta' }],
    })
    const { sendCtaUrlButton } = await importClient()
    const result = await sendCtaUrlButton(
      'phone1', '+1234', 'body', 'Contact us', 'https://wa.me/85291234567', 'footer'
    )
    expect(mockSendInteractiveCtaUrl).toHaveBeenCalledWith({
      phoneNumberId: 'phone1',
      to: '+1234',
      bodyText: 'body',
      parameters: { displayText: 'Contact us', url: 'https://wa.me/85291234567' },
      footerText: 'footer',
    })
    expect(result).toEqual({
      ok: true,
      kapsoMessageId: 'wamid.cta',
      raw: { messages: [{ id: 'wamid.cta' }] },
    })
  })

  it('returns errorResult when the SDK throws', async () => {
    process.env.KAPSO_API_KEY = 'key'
    mockSendInteractiveCtaUrl.mockRejectedValue(new Error('boom'))
    const { sendCtaUrlButton } = await importClient()
    const result = await sendCtaUrlButton(
      'phone1', '+1234', 'body', 'Contact us', 'https://wa.me/85291234567'
    )
    expect(result).toEqual({
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'kapso_send_error', details: 'boom' },
    })
  })
})
