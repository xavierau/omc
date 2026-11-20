import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { reverseStamp } from '@/hooks/reverse-stamp-client'

function fetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>
}

describe('reverse-stamp-client', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('POSTs the memberId and returns the reversed outcome + new count', async () => {
    fetchMock().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ outcome: 'reversed', stampsCount: 4, stampsRequired: 10 }),
    })

    const result = await reverseStamp('m-1')

    expect(fetchMock()).toHaveBeenCalledWith(
      '/api/dashboard/scan/stamp/reverse',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ memberId: 'm-1' }) })
    )
    expect(result).toEqual({ outcome: 'reversed', stampsCount: 4, stampsRequired: 10 })
  })

  it('surfaces at_zero when the count is already zero', async () => {
    fetchMock().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ outcome: 'at_zero', stampsCount: 0, stampsRequired: 10 }),
    })

    const result = await reverseStamp('m-1')

    expect(result.outcome).toBe('at_zero')
  })

  it('maps a no_active_campaign error body to its outcome', async () => {
    fetchMock().mockResolvedValueOnce({ ok: true, json: async () => ({ error: 'no_active_campaign' }) })

    expect((await reverseStamp('m-1')).outcome).toBe('no_active_campaign')
  })

  it('maps any other error body to error', async () => {
    fetchMock().mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'server_error' }) })

    expect((await reverseStamp('m-1')).outcome).toBe('error')
  })

  it('returns error on a network failure', async () => {
    fetchMock().mockRejectedValueOnce(new Error('offline'))

    expect((await reverseStamp('m-1')).outcome).toBe('error')
  })
})
