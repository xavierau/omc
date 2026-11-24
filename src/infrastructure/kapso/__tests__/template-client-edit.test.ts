// TPL-012: editMetaTemplate is asserted at the wire (real SDK client, stubbed
// fetch), not against a mocked SDK method — the SDK has no templates.edit, so
// the raw request IS the contract: POST /<template id>, routed by the WABA.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const fetchMock = vi.fn()

async function importClient() {
  vi.resetModules()
  return import('../template-client')
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function lastRequest() {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit]
  return { url: new URL(url), init, body: JSON.parse(String(init.body)) }
}

const COMPONENTS = [
  {
    type: 'BODY',
    text: 'Hi {{customer_name}}',
    example: { bodyTextNamedParams: [{ paramName: 'customer_name', example: 'John' }] },
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('editMetaTemplate', () => {
  it('returns kapso_no_api_key and sends nothing when no API key', async () => {
    vi.stubEnv('KAPSO_API_KEY', '')
    const { editMetaTemplate } = await importClient()

    const result = await editMetaTemplate('waba1', '1234567890', { components: COMPONENTS })

    expect(result).toEqual({
      ok: false,
      templateId: null,
      status: null,
      error: { title: 'kapso_no_api_key' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('POSTs {components} to /<template id> with the WABA as the proxy routing key', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }))
    const { editMetaTemplate } = await importClient()

    const result = await editMetaTemplate('waba1', '1234567890', { components: COMPONENTS })

    expect(result).toEqual({ ok: true, templateId: '1234567890', status: null })
    const { url, init, body } = lastRequest()
    expect(init.method).toBe('POST')
    expect(url.origin + url.pathname).toBe('https://api.kapso.ai/meta/whatsapp/v23.0/1234567890')
    // Without a routing key the proxy answers 404 "WhatsApp configuration not found"
    // (live probe, TPL-012 AC-8).
    expect(url.searchParams.get('business_account_id')).toBe('waba1')
    // Same wire encoding as templates.create: snake_case, and no category unless given.
    expect(body).toEqual({
      components: [
        {
          type: 'BODY',
          text: 'Hi {{customer_name}}',
          example: { body_text_named_params: [{ param_name: 'customer_name', example: 'John' }] },
        },
      ],
    })
    expect(new Headers(init.headers).get('X-API-Key')).toBe('test-key')
  })

  it('sends category only when given', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true }))
    const { editMetaTemplate } = await importClient()

    await editMetaTemplate('waba1', '1234567890', { components: [], category: 'UTILITY' })

    expect(lastRequest().body).toEqual({ components: [], category: 'UTILITY' })
  })

  it('maps a Graph error to meta_rejected with Meta’s own words and codes', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    fetchMock.mockResolvedValue(
      jsonResponse(400, {
        error: {
          message: 'Invalid parameter',
          type: 'OAuthException',
          code: 100,
          error_subcode: 2388299,
          error_user_title: 'Edit limit reached',
          error_user_msg: 'This template can be edited once in 24 hours.',
          fbtrace_id: 'trace',
        },
      })
    )
    const { editMetaTemplate } = await importClient()

    const result = await editMetaTemplate('waba1', '1234567890', { components: [] })

    expect(result.ok).toBe(false)
    expect(result.templateId).toBeNull()
    expect(result.error?.title).toBe('meta_rejected')
    expect(result.error?.details).toContain('Invalid parameter')
    expect(result.error?.details).toContain('This template can be edited once in 24 hours.')
    expect(result.error?.details).toContain('code 100')
    expect(result.error?.details).toContain('2388299')
  })

  it('maps a proxy route error (non-Graph body) to a provider error, not a rejection', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'WhatsApp configuration not found' }))
    const { editMetaTemplate } = await importClient()

    const result = await editMetaTemplate('waba1', '1234567890', { components: [] })

    expect(result.ok).toBe(false)
    expect(result.error?.title).toBe('template_create_error')
    expect(result.error?.details).toContain('WhatsApp configuration not found')
  })

  it('maps a network failure to a provider error', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    fetchMock.mockRejectedValue(new Error('socket hang up'))
    const { editMetaTemplate } = await importClient()

    const result = await editMetaTemplate('waba1', '1234567890', { components: [] })

    expect(result).toEqual({
      ok: false,
      templateId: null,
      status: null,
      error: { title: 'template_create_error', details: 'socket hang up' },
    })
  })

  it('treats a 200 without success:true as a provider error', async () => {
    vi.stubEnv('KAPSO_API_KEY', 'test-key')
    fetchMock.mockResolvedValue(jsonResponse(200, { success: false }))
    const { editMetaTemplate } = await importClient()

    const result = await editMetaTemplate('waba1', '1234567890', { components: [] })

    expect(result.ok).toBe(false)
    expect(result.error?.title).toBe('template_create_error')
  })
})
