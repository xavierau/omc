import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockCreate = vi.fn()
const mockClientCtor = vi.fn()
const mockFetch = vi.fn()
const mockSendTemplate = vi.fn()

// The real GraphApiError is kept (spread from actual) so `instanceof` in
// template-client.ts matches the instances thrown below.
vi.mock('@kapso/whatsapp-cloud-api', async () => {
  const actual = await vi.importActual<typeof import('@kapso/whatsapp-cloud-api')>(
    '@kapso/whatsapp-cloud-api'
  )
  return {
    ...actual,
    WhatsAppClient: class {
      constructor(config: unknown) {
        mockClientCtor(config)
      }
      templates = { create: mockCreate }
      messages = { sendTemplate: mockSendTemplate }
      fetch = mockFetch
    },
  }
})

import { GraphApiError } from '@kapso/whatsapp-cloud-api'

// `cachedClient` is module-level, so every test needs a fresh module registry.
async function importClient() {
  vi.resetModules()
  return import('../template-client')
}

const PARAMS = {
  name: 'tpl',
  language: 'en',
  category: 'MARKETING',
  components: [{ type: 'BODY', text: 'Hi' }],
}

function graphApiError(
  message: string,
  code: number,
  errorSubcode?: number,
  raw: unknown = null
) {
  return new GraphApiError({
    message,
    code: code as never,
    type: 'OAuthException',
    errorSubcode,
    httpStatus: 400,
    category: 'invalid_request' as never,
    retry: { action: 'none' } as never,
    raw,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createMetaTemplate', () => {
  it('returns kapso_no_api_key without constructing a client when no API key', async () => {
    vi.stubEnv('KAPSO_API_KEY', '')
    const { createMetaTemplate } = await importClient()

    const result = await createMetaTemplate('waba1', PARAMS)

    expect(result).toEqual({
      ok: false,
      templateId: null,
      status: null,
      error: { title: 'kapso_no_api_key' },
    })
    expect(mockClientCtor).not.toHaveBeenCalled()
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('returns ok with the Meta template id and status on success', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockResolvedValue({ id: 'tpl-123', status: 'PENDING' })
    const { createMetaTemplate } = await importClient()

    const result = await createMetaTemplate('waba1', PARAMS)

    expect(result).toEqual({ ok: true, templateId: 'tpl-123', status: 'PENDING' })
    expect(mockCreate).toHaveBeenCalledWith({ businessAccountId: 'waba1', ...PARAMS })
  })

  it('propagates a Meta rejection with code and subcode in the details', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockRejectedValue(
      graphApiError(
        'Invalid parameter: BODY is missing expected field(s) (example)',
        100,
        2388043
      )
    )
    const { createMetaTemplate } = await importClient()

    const result = await createMetaTemplate('waba1', PARAMS)

    expect(result.ok).toBe(false)
    expect(result.templateId).toBeNull()
    expect(result.error?.title).toBe('meta_rejected')
    expect(result.error?.details).toContain(
      'BODY is missing expected field(s) (example)'
    )
    expect(result.error?.details).toContain('100')
    expect(result.error?.details).toContain('2388043')
  })

  // #97: Meta names the offending field in error_user_title / error_user_msg.
  // Dropping them left operators with a bare "Invalid parameter (code 100...)".
  it('surfaces Meta\'s own explanation of the rejection', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockRejectedValue(
      graphApiError('Invalid parameter', 100, 2388050, {
        error: {
          message: 'Invalid parameter',
          errorUserTitle: 'Message template button is missing field(s)',
          errorUserMsg: 'Button at index 1 is missing expected field(s) (phone_number)',
        },
      })
    )
    const { createMetaTemplate } = await importClient()

    const result = await createMetaTemplate('waba1', PARAMS)

    expect(result.error?.title).toBe('meta_rejected')
    expect(result.error?.details).toContain('Message template button is missing field(s)')
    expect(result.error?.details).toContain(
      'Button at index 1 is missing expected field(s) (phone_number)'
    )
    expect(result.error?.details).toContain('2388050')
  })

  it('falls back to the bare message when Meta sends no user-facing text', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockRejectedValue(
      graphApiError('Invalid parameter', 100, 2388050, 'not a json body')
    )
    const { createMetaTemplate } = await importClient()

    const result = await createMetaTemplate('waba1', PARAMS)

    expect(result.error?.details).toBe('Invalid parameter (code 100, subcode 2388050)')
  })

  it('reports a generic thrown error as template_create_error', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockCreate.mockRejectedValue(new Error('boom'))
    const { createMetaTemplate } = await importClient()

    const result = await createMetaTemplate('waba1', PARAMS)

    expect(result).toEqual({
      ok: false,
      templateId: null,
      status: null,
      error: { title: 'template_create_error', details: 'boom' },
    })
  })
})

// Regression cover for issue #74: `resolveWabaId` used to ask the Graph API
// for a `account` field that does not exist on a phone-number node, so it
// could only ever return null — silently, because a 400 body parses fine.
describe('resolveWabaId', () => {
  function configsPage(
    configs: Array<{ phone_number_id: string; business_account_id: string }>,
    meta?: { page: number; total_pages: number }
  ) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: configs, meta }),
    } as unknown as Response
  }

  it('returns null without a request when there is no API key', async () => {
    vi.stubEnv('KAPSO_API_KEY', '')
    const { resolveWabaId } = await importClient()

    expect(await resolveWabaId('phone-1')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns null without a request for an empty phone number id', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    const { resolveWabaId } = await importClient()

    expect(await resolveWabaId('')).toBeNull()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns the business account id of the matching whatsapp_config', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockFetch.mockResolvedValue(
      configsPage(
        [
          { phone_number_id: 'other', business_account_id: 'waba-other' },
          { phone_number_id: 'phone-1', business_account_id: 'waba-1' },
        ],
        { page: 1, total_pages: 1 }
      )
    )
    const { resolveWabaId } = await importClient()

    expect(await resolveWabaId('phone-1')).toBe('waba-1')
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(mockFetch.mock.calls[0][0]).toContain(
      'https://app.kapso.ai/api/v1/whatsapp_configs'
    )
  })

  it('pages until the phone number is found', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockFetch
      .mockResolvedValueOnce(
        configsPage([{ phone_number_id: 'other', business_account_id: 'waba-other' }], {
          page: 1,
          total_pages: 2,
        })
      )
      .mockResolvedValueOnce(
        configsPage([{ phone_number_id: 'phone-1', business_account_id: 'waba-1' }], {
          page: 2,
          total_pages: 2,
        })
      )
    const { resolveWabaId } = await importClient()

    expect(await resolveWabaId('phone-1')).toBe('waba-1')
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[1][0]).toContain('page=2')
  })

  it('stops at the last page and returns null when nothing matches', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockFetch.mockResolvedValue(
      configsPage([{ phone_number_id: 'other', business_account_id: 'waba-other' }], {
        page: 1,
        total_pages: 1,
      })
    )
    const { resolveWabaId } = await importClient()

    expect(await resolveWabaId('phone-1')).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('no whatsapp_config for phone number phone-1')
    )
  })

  it('logs the status and body on an HTTP error instead of failing silently', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"error":"unauthorized"}',
    } as unknown as Response)
    const { resolveWabaId } = await importClient()

    expect(await resolveWabaId('phone-1')).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('whatsapp_configs returned 401'),
      expect.stringContaining('unauthorized')
    )
  })

  it('returns null when the request throws', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockFetch.mockRejectedValue(new Error('network down'))
    const { resolveWabaId } = await importClient()

    expect(await resolveWabaId('phone-1')).toBeNull()
    expect(console.warn).toHaveBeenCalledWith(
      '[Kapso] Error resolving WABA ID:',
      'network down'
    )
  })
})

// #127 / CAMP-007: headerParams must survive the trip through the REAL
// buildTemplateSendPayload (spread from actual above) — this is the layer
// whose zod schema would reject a malformed media parameter, so passing
// here proves the shape Meta receives carries the header component.
describe('sendTemplateMessage — media header passthrough', () => {
  it('threads an image headerParam into a header component of the wire payload', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockSendTemplate.mockResolvedValue({ messages: [{ id: 'wamid.hdr' }] })
    const { sendTemplateMessage } = await importClient()

    const result = await sendTemplateMessage('pn-1', '+85291234567', {
      templateName: 'fifth_anniversary',
      language: 'zh_HK',
      bodyParams: [],
      headerParams: [
        { type: 'image', image: { link: 'https://cdn.example.com/h.jpg' } },
      ],
    })

    expect(result.ok).toBe(true)
    expect(result.kapsoMessageId).toBe('wamid.hdr')
    expect(mockSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        phoneNumberId: 'pn-1',
        to: '+85291234567',
        template: expect.objectContaining({
          name: 'fifth_anniversary',
          components: [
            {
              type: 'header',
              parameters: [
                { type: 'image', image: { link: 'https://cdn.example.com/h.jpg' } },
              ],
            },
          ],
        }),
      })
    )
  })

  it('keeps text headerParams working through the same path', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    mockSendTemplate.mockResolvedValue({ messages: [{ id: 'wamid.txt' }] })
    const { sendTemplateMessage } = await importClient()

    const result = await sendTemplateMessage('pn-1', '+85291234567', {
      templateName: 'text_header_tpl',
      language: 'en',
      headerParams: [{ type: 'text', text: 'Big News' }],
    })

    expect(result.ok).toBe(true)
    expect(mockSendTemplate).toHaveBeenCalledWith(
      expect.objectContaining({
        template: expect.objectContaining({
          components: [
            { type: 'header', parameters: [{ type: 'text', text: 'Big News' }] },
          ],
        }),
      })
    )
  })
})
