import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const ORIGINAL_ENV = process.env

const MESSAGE = {
  to: 'owner@restaurant.example',
  subject: '[OhMyClient] 新客戶查詢 — Cafe Latte',
  text: 'body text',
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV }
  vi.resetModules()
})

afterEach(() => {
  process.env = ORIGINAL_ENV
  vi.restoreAllMocks()
})

function configureEnv(): void {
  process.env.RESEND_API_KEY = 'test-key'
  process.env.RESEND_FROM_EMAIL = 'noreply@ohmyclient.io'
}

async function importAdapter() {
  return import('../resend-adapter')
}

describe('resendEmailAdapter.send', () => {
  it('returns a skip result when RESEND_API_KEY is missing', async () => {
    delete process.env.RESEND_API_KEY
    process.env.RESEND_FROM_EMAIL = 'noreply@ohmyclient.io'
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { resendEmailAdapter } = await importAdapter()

    const result = await resendEmailAdapter.send(MESSAGE)

    expect(result).toEqual({
      ok: false,
      providerMessageId: null,
      raw: null,
      error: { title: 'resend_not_configured' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns a skip result when RESEND_FROM_EMAIL is missing', async () => {
    process.env.RESEND_API_KEY = 'test-key'
    delete process.env.RESEND_FROM_EMAIL
    const fetchMock = vi.spyOn(globalThis, 'fetch')
    const { resendEmailAdapter } = await importAdapter()

    const result = await resendEmailAdapter.send(MESSAGE)

    expect(result).toEqual({
      ok: false,
      providerMessageId: null,
      raw: null,
      error: { title: 'resend_not_configured' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('extracts the provider message id on success', async () => {
    configureEnv()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-msg-123' }), { status: 200 })
    )
    const { resendEmailAdapter } = await importAdapter()

    const result = await resendEmailAdapter.send(MESSAGE)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-key',
    })
    expect(JSON.parse(init?.body as string)).toMatchObject({
      from: 'noreply@ohmyclient.io',
      to: MESSAGE.to,
      subject: MESSAGE.subject,
      text: MESSAGE.text,
    })
    expect(result).toEqual({
      ok: true,
      providerMessageId: 'resend-msg-123',
      raw: { id: 'resend-msg-123' },
    })
  })

  it('passes explicit html through unchanged, not overwritten', async () => {
    configureEnv()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-msg-1' }), { status: 200 })
    )
    const { resendEmailAdapter } = await importAdapter()

    await resendEmailAdapter.send({ ...MESSAGE, html: '<p>hi</p>' })

    const [, init] = fetchMock.mock.calls[0]
    expect(JSON.parse(init?.body as string)).toMatchObject({ html: '<p>hi</p>' })
  })

  it('derives a non-empty html alternative from text when html is not supplied', async () => {
    configureEnv()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-msg-1' }), { status: 200 })
    )
    const { resendEmailAdapter } = await importAdapter()

    await resendEmailAdapter.send(MESSAGE)

    const [, init] = fetchMock.mock.calls[0]
    const payload = JSON.parse(init?.body as string)
    expect(typeof payload.html).toBe('string')
    expect(payload.html.length).toBeGreaterThan(0)
    expect(payload.html).toContain('body text')
  })

  it('HTML-escapes attacker-influenced text (<script>, &, <) in the derived html', async () => {
    configureEnv()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-msg-1' }), { status: 200 })
    )
    const { resendEmailAdapter } = await importAdapter()

    await resendEmailAdapter.send({
      ...MESSAGE,
      text: '姓名: <script>alert(1)</script> & Tom & Jerry <b>bold</b>',
    })

    const [, init] = fetchMock.mock.calls[0]
    const payload = JSON.parse(init?.body as string)
    expect(payload.html).not.toContain('<script>')
    expect(payload.html).toContain('&lt;script&gt;')
    expect(payload.html).toContain('&amp;')
    expect(payload.html).not.toContain('<b>bold</b>')
    expect(payload.html).toContain('&lt;b&gt;bold&lt;/b&gt;')
  })

  it('preserves multi-line structure in the derived html', async () => {
    configureEnv()
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'resend-msg-1' }), { status: 200 })
    )
    const { resendEmailAdapter } = await importAdapter()

    await resendEmailAdapter.send({ ...MESSAGE, text: 'line one\nline two\nline three' })

    const [, init] = fetchMock.mock.calls[0]
    const payload = JSON.parse(init?.body as string)
    expect(payload.html).toContain('line one')
    expect(payload.html).toContain('line two')
    expect(payload.html).toContain('line three')
    // line order/structure preserved: "one" precedes "two" precedes "three"
    expect(payload.html.indexOf('line one')).toBeLessThan(payload.html.indexOf('line two'))
    expect(payload.html.indexOf('line two')).toBeLessThan(payload.html.indexOf('line three'))
  })

  it('maps a non-2xx response to ok:false with details', async () => {
    configureEnv()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'invalid from address' }), { status: 422 })
    )
    const { resendEmailAdapter } = await importAdapter()

    const result = await resendEmailAdapter.send(MESSAGE)

    expect(result.ok).toBe(false)
    expect(result.providerMessageId).toBeNull()
    expect(result.error?.title).toBe('resend_non_2xx')
    expect(result.error?.details).toContain('422')
    expect(result.error?.details).toContain('invalid from address')
  })

  it('converts a fetch rejection to an error result without throwing', async () => {
    configureEnv()
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'))
    const { resendEmailAdapter } = await importAdapter()

    await expect(resendEmailAdapter.send(MESSAGE)).resolves.toEqual({
      ok: false,
      providerMessageId: null,
      raw: null,
      error: { title: 'resend_send_error', details: 'network down' },
    })
  })

  it('returns ok:false when a 2xx response has no id', async () => {
    configureEnv()
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({}), { status: 200 })
    )
    const { resendEmailAdapter } = await importAdapter()

    const result = await resendEmailAdapter.send(MESSAGE)

    expect(result).toEqual({
      ok: false,
      providerMessageId: null,
      raw: {},
      error: { title: 'resend_no_message_id' },
    })
  })
})
