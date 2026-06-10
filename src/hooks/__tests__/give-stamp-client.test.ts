import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { postStamp, lookupMemberByPhone } from '@/hooks/give-stamp-client'

function fetchMock() {
  return globalThis.fetch as unknown as ReturnType<typeof vi.fn>
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

describe('give-stamp-client', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('postStamp', () => {
    it('POSTs rawScan UN-STRIPPED to the scan/stamp route', async () => {
      fetchMock().mockResolvedValueOnce(
        jsonResponse({ outcome: 'stamped', stampsCount: 7, stampsRequired: 10, completed: false })
      )

      const result = await postStamp({ rawScan: 'LOYALTY:abc123' })

      expect(fetchMock()).toHaveBeenCalledWith(
        '/api/dashboard/scan/stamp',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ rawScan: 'LOYALTY:abc123' }) })
      )
      expect(result).toEqual({ outcome: 'stamped', stampsCount: 7, stampsRequired: 10, completed: false })
    })

    it('routes a memberId payload to the by-member backstop route', async () => {
      fetchMock().mockResolvedValueOnce(
        jsonResponse({ outcome: 'stamped', stampsCount: 1, stampsRequired: 5, completed: false })
      )

      await postStamp({ memberId: 'm-9' })

      expect(fetchMock()).toHaveBeenCalledWith(
        '/api/dashboard/scan/stamp/by-member',
        expect.objectContaining({ body: JSON.stringify({ memberId: 'm-9' }) })
      )
    })

    it('normalizes a no_active_campaign error body into an outcome', async () => {
      fetchMock().mockResolvedValueOnce(jsonResponse({ error: 'no_active_campaign' }))

      const result = await postStamp({ rawScan: 'X' })

      expect(result.outcome).toBe('no_active_campaign')
      expect(result.completed).toBe(false)
    })

    it('normalizes a not_resolved error body into an outcome', async () => {
      fetchMock().mockResolvedValueOnce(jsonResponse({ error: 'not_resolved' }))

      const result = await postStamp({ rawScan: 'junk' })

      expect(result.outcome).toBe('not_resolved')
    })

    it('maps an unknown error body to not_resolved', async () => {
      fetchMock().mockResolvedValueOnce(jsonResponse({ error: 'server_error' }))

      const result = await postStamp({ rawScan: 'X' })

      expect(result.outcome).toBe('not_resolved')
    })

    it('falls back to not_resolved on a network failure', async () => {
      fetchMock().mockRejectedValueOnce(new Error('offline'))

      const result = await postStamp({ rawScan: 'X' })

      expect(result.outcome).toBe('not_resolved')
    })

    it('preserves a completed outcome', async () => {
      fetchMock().mockResolvedValueOnce(
        jsonResponse({ outcome: 'completed', stampsCount: 0, stampsRequired: 10, completed: true })
      )

      const result = await postStamp({ rawScan: 'X' })

      expect(result.completed).toBe(true)
      expect(result.outcome).toBe('completed')
    })
  })

  describe('lookupMemberByPhone', () => {
    it('returns the memberId on a hit', async () => {
      fetchMock().mockResolvedValueOnce(jsonResponse({ memberId: 'm-1' }))

      const result = await lookupMemberByPhone('+85291234567')

      expect(fetchMock()).toHaveBeenCalledWith(
        '/api/dashboard/members/lookup?phone=%2B85291234567'
      )
      expect(result).toBe('m-1')
    })

    it('returns null when the phone matches nobody', async () => {
      fetchMock().mockResolvedValueOnce(jsonResponse({ error: 'not_found' }))

      expect(await lookupMemberByPhone('000')).toBeNull()
    })

    it('returns null on a network failure', async () => {
      fetchMock().mockRejectedValueOnce(new Error('offline'))

      expect(await lookupMemberByPhone('000')).toBeNull()
    })
  })
})
