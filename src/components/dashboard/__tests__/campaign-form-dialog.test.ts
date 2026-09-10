import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { submitCampaign } from '@/components/dashboard/campaign-form-dialog'
import {
  buildCampaignRequestBody,
  initialCampaignForm,
  type CampaignFormState,
} from '@/components/dashboard/campaign-form-types'

function inlineForm(overrides: Partial<CampaignFormState> = {}): CampaignFormState {
  return {
    ...initialCampaignForm,
    name: 'December Win-back',
    messageType: 'inline',
    templateEn: 'Hi {{contactName}}, use {{couponCode}}',
    templateZhHk: '您好 {{contactName}}，請使用 {{couponCode}}',
    ...overrides,
  }
}

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(body),
  }
}

describe('submitCampaign (#136)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC1: create with execution "now" makes exactly one POST and never calls /execute', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'camp-1' }))

    await submitCampaign(inlineForm({ execution: 'now' }), undefined)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/dashboard/campaigns')
    expect(init).toMatchObject({ method: 'POST' })
    expect(
      fetchMock.mock.calls.some(([callUrl]) => String(callUrl).includes('/execute'))
    ).toBe(false)
  })

  it('AC2: create with execution "schedule" sends an ISO scheduledAt and never calls /execute', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'camp-2' }))

    await submitCampaign(
      inlineForm({ execution: 'schedule', scheduledAt: '2026-09-01T10:00' }),
      undefined
    )

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/dashboard/campaigns')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(typeof body.scheduledAt).toBe('string')
    expect(() => new Date(body.scheduledAt).toISOString()).not.toThrow()
    expect(body.scheduledAt).toBe(new Date('2026-09-01T10:00').toISOString())
    expect(
      fetchMock.mock.calls.some(([callUrl]) => String(callUrl).includes('/execute'))
    ).toBe(false)
  })

  it('AC3: edit path PATCHes the given campaignId and never calls /execute', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'camp-3' }))

    await submitCampaign(inlineForm({ execution: 'now' }), 'camp-3')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/dashboard/campaigns/camp-3')
    expect(init.method).toBe('PATCH')
    expect(
      fetchMock.mock.calls.some(([callUrl]) => String(callUrl).includes('/execute'))
    ).toBe(false)
  })

  it('AC4: a non-ok create response rejects with the server error message after exactly one fetch', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'boom' }, false))

    await expect(submitCampaign(inlineForm(), undefined)).rejects.toThrow('boom')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('buildCampaignRequestBody(initialCampaignForm) (#136 AC5)', () => {
  it('builds a "now" campaign as created idle, waiting for Send Now', () => {
    const body = buildCampaignRequestBody({
      ...initialCampaignForm,
      name: 'Test Campaign',
      templateEn: 'Hello {{contactName}}',
    })

    expect(body.scheduledAt).toBeNull()
    expect(body.status).toBe('active')
  })
})
