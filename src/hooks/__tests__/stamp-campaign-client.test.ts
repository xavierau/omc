import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createStampCampaign, transitionStampCampaign } from '@/hooks/stamp-campaign-client'

function fetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>
}

const BODY = {
  name: 'Coffee Card',
  nameZh: '咖啡卡',
  stampsRequired: 10,
  rewardId: 'rw-1',
  maxStampsPerDay: 1,
}

describe('stamp-campaign-client', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('createStampCampaign', () => {
    it('POSTs the body and returns ok on success', async () => {
      fetchMock().mockResolvedValueOnce({ ok: true, json: async () => ({ campaign: { id: 'c-1' } }) })

      const out = await createStampCampaign(BODY)

      expect(fetchMock()).toHaveBeenCalledWith(
        '/api/dashboard/campaigns/stamps',
        expect.objectContaining({ method: 'POST', body: JSON.stringify(BODY) })
      )
      expect(out).toEqual({ ok: true, warning: undefined })
    })

    it('surfaces the cap warning when the API returns one', async () => {
      fetchMock().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ campaign: { id: 'c-1' }, warning: 'cap risk' }),
      })

      const out = await createStampCampaign({ ...BODY, maxStampsPerDay: 3 })

      expect(out).toEqual({ ok: true, warning: 'cap risk' })
    })

    it('surfaces the zero-rewards block error', async () => {
      fetchMock().mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Add a reward before creating a stamp card.' }),
      })

      const out = await createStampCampaign(BODY)

      expect(out.ok).toBe(false)
      expect(out.error).toContain('reward')
    })

    it('falls back to save_error when the body has no error string', async () => {
      fetchMock().mockResolvedValueOnce({ ok: false, json: async () => ({}) })

      const out = await createStampCampaign(BODY)

      expect(out).toEqual({ ok: false, error: 'save_error' })
    })
  })

  describe('transitionStampCampaign', () => {
    it('PATCHes id + action and returns ok', async () => {
      fetchMock().mockResolvedValueOnce({ ok: true, json: async () => ({}) })

      const out = await transitionStampCampaign('c-1', 'activate')

      expect(fetchMock()).toHaveBeenCalledWith(
        '/api/dashboard/campaigns/stamps',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ id: 'c-1', action: 'activate' }) })
      )
      expect(out).toEqual({ ok: true })
    })

    it('surfaces the one-active 409 error', async () => {
      fetchMock().mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: 'Pause the running card first.' }),
      })

      const out = await transitionStampCampaign('c-2', 'activate')

      expect(out.ok).toBe(false)
      expect(out.error).toBe('Pause the running card first.')
    })

    it('falls back to transition_error on an unparseable failure', async () => {
      fetchMock().mockResolvedValueOnce({ ok: false, json: async () => ({}) })

      const out = await transitionStampCampaign('c-2', 'end')

      expect(out).toEqual({ ok: false, error: 'transition_error' })
    })
  })
})
