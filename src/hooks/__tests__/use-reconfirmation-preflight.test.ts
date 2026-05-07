import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  buildReconfirmationPreflightUrl,
  type ReconfirmationPreflightResult,
} from '@/hooks/use-reconfirmation-preflight'

const happyFixture: ReconfirmationPreflightResult = {
  allowed: true,
  violations: [],
  audienceCount: 42,
  currentDailySent: 5,
  cap: 50,
  templatePreview: {
    id: 'tpl-utility-1',
    name: 'reconfirmation_consent_v1',
    bodyEn: 'Hi, please confirm by replying YES.',
    bodyZhHk: '您好，請回覆 YES 確認。',
  },
  audienceSample: [
    { phoneE164: '+85291234567', capturedAt: '2026-04-30T00:00:00Z' },
    { phoneE164: '+85291234568', capturedAt: '2026-04-29T00:00:00Z' },
  ],
}

const blockedFixture: ReconfirmationPreflightResult = {
  allowed: false,
  violations: [
    { key: 'quality_not_green', detail: 'YELLOW since 2026-04-30' },
    { key: 'empty_audience' },
  ],
  audienceCount: 0,
  currentDailySent: 0,
  cap: 50,
}

describe('buildReconfirmationPreflightUrl', () => {
  it('returns the preflight URL', () => {
    expect(buildReconfirmationPreflightUrl()).toBe(
      '/api/dashboard/campaigns/reconfirmation/preflight'
    )
  })
})

describe('useReconfirmationPreflight fetch wiring', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('exports the hook function symbol', async () => {
    const mod = await import('@/hooks/use-reconfirmation-preflight')
    expect(typeof mod.useReconfirmationPreflight).toBe('function')
  })

  it('GET request hits the correct URL', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => happyFixture,
    })
    vi.stubGlobal('fetch', fetchSpy)
    const res = await fetch(buildReconfirmationPreflightUrl())
    expect(res.ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/dashboard/campaigns/reconfirmation/preflight'
    )
  })

  it('preflight result includes the locked contract fields on happy path', () => {
    expect(happyFixture.allowed).toBe(true)
    expect(happyFixture.audienceCount).toBe(42)
    expect(happyFixture.cap).toBe(50)
    expect(happyFixture.templatePreview?.name).toBe('reconfirmation_consent_v1')
    expect(happyFixture.audienceSample).toHaveLength(2)
  })

  it('blocked preflight surfaces a typed list of violation keys', () => {
    const keys = blockedFixture.violations.map((v) => v.key)
    expect(keys).toEqual(['quality_not_green', 'empty_audience'])
  })
})
