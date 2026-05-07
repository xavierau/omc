import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildReconfirmationCampaignUrl,
  buildReconfirmationCreateBody,
  type CreateReconfirmationCampaignInput,
} from '@/hooks/use-reconfirmation-create'

const validInput: CreateReconfirmationCampaignInput = {
  mode: 'reconfirmation',
  name: 'Re-confirm legacy contacts (May)',
  templateId: 'tpl-utility-1',
}

describe('buildReconfirmationCampaignUrl', () => {
  it('returns the campaigns POST URL', () => {
    expect(buildReconfirmationCampaignUrl()).toBe('/api/dashboard/campaigns')
  })
})

describe('buildReconfirmationCreateBody', () => {
  it('echoes the contracted fields', () => {
    expect(buildReconfirmationCreateBody(validInput)).toEqual(validInput)
  })

  it('locks the mode to "reconfirmation"', () => {
    const body = buildReconfirmationCreateBody({
      ...validInput,
      // @ts-expect-error: hook-layer guard against caller mistakes
      mode: 'marketing',
    })
    expect(body.mode).toBe('reconfirmation')
  })
})

describe('useReconfirmationCreate fetch wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('exports the hook function symbol', async () => {
    const mod = await import('@/hooks/use-reconfirmation-create')
    expect(typeof mod.useReconfirmationCreate).toBe('function')
  })

  it('POSTs to /api/dashboard/campaigns with the contract body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ campaignId: 'c-7' }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await fetch(buildReconfirmationCampaignUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildReconfirmationCreateBody(validInput)),
    })
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/dashboard/campaigns',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(validInput),
      })
    )
  })

  it('200 response returns a campaignId payload', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ campaignId: 'c-7' }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const res = await fetch(buildReconfirmationCampaignUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildReconfirmationCreateBody(validInput)),
    })
    const json = await res.json()
    expect(json).toEqual({ campaignId: 'c-7' })
  })

  it('400 response surfaces violations from response body', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        error: 'preflight_failed',
        violations: [{ key: 'daily_cap_met', detail: '50/50' }],
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)
    const res = await fetch(buildReconfirmationCampaignUrl(), { method: 'POST' })
    const body = await res.json()
    expect(res.ok).toBe(false)
    expect(body.violations).toHaveLength(1)
    expect(body.violations[0].key).toBe('daily_cap_met')
  })
})
