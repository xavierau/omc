import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockCreate = vi.fn()
const mockClientCtor = vi.fn()
const mockFetch = vi.fn()

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

function graphApiError(message: string, code: number, errorSubcode?: number) {
  return new GraphApiError({
    message,
    code: code as never,
    type: 'OAuthException',
    errorSubcode,
    httpStatus: 400,
    category: 'invalid_request' as never,
    retry: { action: 'none' } as never,
    raw: null,
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
