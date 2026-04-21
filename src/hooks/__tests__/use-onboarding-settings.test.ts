import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  fetchOnboardingSettings,
  patchOnboardingSettings,
  ONBOARDING_SETTINGS_ENDPOINT,
} from '@/hooks/onboarding-settings-api'

describe('onboarding-settings-api', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('fetchOnboardingSettings', () => {
    it('calls the admin endpoint with GET', async () => {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ welcomeCampaignId: null, returningMemberTemplate: null }),
      })

      const result = await fetchOnboardingSettings()

      expect(fetchMock).toHaveBeenCalledWith(ONBOARDING_SETTINGS_ENDPOINT)
      expect(result).toEqual({ welcomeCampaignId: null, returningMemberTemplate: null })
    })

    it('returns parsed data on success', async () => {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ welcomeCampaignId: 'uuid-1', returningMemberTemplate: 'hi' }),
      })

      const result = await fetchOnboardingSettings()

      expect(result.welcomeCampaignId).toBe('uuid-1')
      expect(result.returningMemberTemplate).toBe('hi')
    })

    it('throws on non-OK response', async () => {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({ ok: false, status: 403 })

      await expect(fetchOnboardingSettings()).rejects.toThrow(/403/)
    })
  })

  describe('patchOnboardingSettings', () => {
    it('sends PATCH with JSON body and returns updated state', async () => {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ welcomeCampaignId: 'uuid-1', returningMemberTemplate: null }),
      })

      const result = await patchOnboardingSettings({ welcomeCampaignId: 'uuid-1' })

      expect(fetchMock).toHaveBeenCalledWith(ONBOARDING_SETTINGS_ENDPOINT, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ welcomeCampaignId: 'uuid-1' }),
      })
      expect(result.welcomeCampaignId).toBe('uuid-1')
    })

    it('throws with status and message on validation error', async () => {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: async () => ({ error: 'Template too long' }),
      })

      await expect(patchOnboardingSettings({ returningMemberTemplate: 'x' })).rejects.toThrow(/400/)
    })

    it('handles PATCH responses without a JSON body gracefully on error', async () => {
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => { throw new Error('not json') },
      })

      await expect(patchOnboardingSettings({ welcomeCampaignId: null })).rejects.toThrow(/500/)
    })
  })
})
