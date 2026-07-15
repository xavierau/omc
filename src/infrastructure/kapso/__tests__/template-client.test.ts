import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockCreate = vi.fn()
const mockClientCtor = vi.fn()

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
