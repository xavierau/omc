import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockSendInteractiveFlow = vi.fn()

vi.mock('@kapso/whatsapp-cloud-api', () => ({
  WhatsAppClient: class {
    messages = {
      sendInteractiveFlow: mockSendInteractiveFlow,
    }
  },
}))

const OLD_ENV = process.env

async function importClient() {
  vi.resetModules()
  return import('../client')
}

const FLOW_PARAMS = {
  flowId: 'flow-1',
  flowCta: '填寫表格',
  flowToken: 'cf.v1.r-1.abc',
  screen: 'CONTACT_FORM',
  data: {
    topics: [{ id: '訂座查詢', title: '訂座查詢' }],
    wa_number: '85291234567',
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env = { ...OLD_ENV }
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  process.env = OLD_ENV
})

describe('sendInteractiveFlow (kapso client)', () => {
  it('returns skipResult when no API key', async () => {
    delete process.env.KAPSO_API_KEY
    const { sendInteractiveFlow } = await importClient()
    const result = await sendInteractiveFlow(
      'phone1', '+1234', 'body', FLOW_PARAMS
    )
    expect(result).toEqual({
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'kapso_no_api_key' },
    })
    expect(mockSendInteractiveFlow).not.toHaveBeenCalled()
  })

  it('returns skipResult when phoneNumberId is empty', async () => {
    process.env.KAPSO_API_KEY = 'key'
    const { sendInteractiveFlow } = await importClient()
    const result = await sendInteractiveFlow(
      '', '+1234', 'body', FLOW_PARAMS
    )
    expect(result).toEqual({
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'kapso_no_phone_number_id' },
    })
    expect(mockSendInteractiveFlow).not.toHaveBeenCalled()
  })

  it('maps SDK success and sends flowAction:navigate with exact flowActionPayload shape', async () => {
    process.env.KAPSO_API_KEY = 'key'
    mockSendInteractiveFlow.mockResolvedValue({
      messages: [{ id: 'wamid.flow' }],
    })
    const { sendInteractiveFlow } = await importClient()
    const result = await sendInteractiveFlow(
      'phone1', '+1234', 'body', FLOW_PARAMS, 'footer'
    )
    expect(mockSendInteractiveFlow).toHaveBeenCalledWith({
      phoneNumberId: 'phone1',
      to: '+1234',
      bodyText: 'body',
      footerText: 'footer',
      parameters: {
        flowId: 'flow-1',
        flowCta: '填寫表格',
        flowToken: 'cf.v1.r-1.abc',
        flowAction: 'navigate',
        flowActionPayload: {
          screen: 'CONTACT_FORM',
          data: FLOW_PARAMS.data,
        },
      },
    })
    expect(result).toEqual({
      ok: true,
      kapsoMessageId: 'wamid.flow',
      raw: { messages: [{ id: 'wamid.flow' }] },
    })
  })

  it('omits footerText when not provided', async () => {
    process.env.KAPSO_API_KEY = 'key'
    mockSendInteractiveFlow.mockResolvedValue({
      messages: [{ id: 'wamid.flow2' }],
    })
    const { sendInteractiveFlow } = await importClient()
    await sendInteractiveFlow('phone1', '+1234', 'body', FLOW_PARAMS)
    expect(mockSendInteractiveFlow).toHaveBeenCalledWith(
      expect.objectContaining({ footerText: undefined })
    )
  })

  it('returns errorResult when the SDK throws', async () => {
    process.env.KAPSO_API_KEY = 'key'
    mockSendInteractiveFlow.mockRejectedValue(new Error('boom'))
    const { sendInteractiveFlow } = await importClient()
    const result = await sendInteractiveFlow(
      'phone1', '+1234', 'body', FLOW_PARAMS
    )
    expect(result).toEqual({
      ok: false,
      kapsoMessageId: null,
      raw: null,
      error: { title: 'kapso_send_error', details: 'boom' },
    })
  })
})
