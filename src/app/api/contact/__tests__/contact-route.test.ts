import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/application/submit-contact-web-form', () => ({
  submitContactWebForm: vi.fn(),
}))

import { POST } from '../[slug]/route'
import { submitContactWebForm } from '@/application/submit-contact-web-form'

function request(body: unknown, raw?: string) {
  return new Request('https://app.ohmyclient.io/api/contact/kushiro', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: raw ?? JSON.stringify(body),
  }) as never
}

const params = Promise.resolve({ slug: 'kushiro' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('POST /api/contact/[slug]', () => {
  it('returns 200 on a successful submission', async () => {
    vi.mocked(submitContactWebForm).mockResolvedValue({ ok: true })

    const res = await POST(request({ token: 'tok', clientName: 'A', topic: 'T' }), { params })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  // The tenant comes from the token, never the slug — otherwise swapping the
  // slug in the URL would redirect an enquiry into another tenant's inbox.
  it('passes only the token and body through, never the slug', async () => {
    vi.mocked(submitContactWebForm).mockResolvedValue({ ok: true })
    const body = { token: 'tok', clientName: 'A', topic: 'T' }

    await POST(request(body), { params })

    expect(submitContactWebForm).toHaveBeenCalledWith('tok', body)
  })

  // 410 is load-bearing: the client uses it to switch to the terminal recovery
  // state instead of inviting a retry that can never succeed.
  it('maps an unusable token to 410 Gone', async () => {
    vi.mocked(submitContactWebForm).mockResolvedValue({ ok: false, reason: 'token_unusable' })

    const res = await POST(request({ token: 'spent' }), { params })

    expect(res.status).toBe(410)
  })

  it('maps a rejected body to 400 with the reason', async () => {
    vi.mocked(submitContactWebForm).mockResolvedValue({
      ok: false,
      reason: 'invalid_submission',
      detail: 'topic_not_allowed',
    })

    const res = await POST(request({ token: 'tok' }), { params })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'topic_not_allowed' })
  })

  it('maps a delivery failure to 500', async () => {
    vi.mocked(submitContactWebForm).mockResolvedValue({
      ok: false,
      reason: 'email_failed',
      detail: 'smtp down',
    })

    expect((await POST(request({ token: 'tok' }), { params })).status).toBe(500)
  })

  it.each([
    ['malformed json', undefined, '{not json', 'invalid_json'],
    ['a missing token', {}, undefined, 'missing_token'],
    ['a non-string token', { token: 42 }, undefined, 'missing_token'],
    ['an empty token', { token: '' }, undefined, 'missing_token'],
  ])('rejects %s with 400 before reaching the use-case', async (_l, body, raw, error) => {
    const res = await POST(request(body, raw), { params })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error })
    expect(submitContactWebForm).not.toHaveBeenCalled()
  })
})
