import { describe, it, expect, vi, beforeEach } from 'vitest'
import { performMemberDelete } from '@/components/dashboard/member-delete-helpers'

const MEMBER_ID = 'mem-1'

describe('performMemberDelete', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('calls DELETE /api/dashboard/members/:id and resolves on success', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }) as never)

    await expect(performMemberDelete(MEMBER_ID)).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledWith(
      `/api/dashboard/members/${MEMBER_ID}`,
      { method: 'DELETE' }
    )
  })

  it('accepts 200 as success (server may return JSON body)', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), { status: 200 }) as never
    )

    await expect(performMemberDelete(MEMBER_ID)).resolves.toBeUndefined()
  })

  it('throws when the response is not ok', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('forbidden', { status: 403 }) as never
    )

    await expect(performMemberDelete(MEMBER_ID)).rejects.toThrow()
  })

  it('surfaces the JSON error body when the server returns { error }', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }) as never
    )

    await expect(performMemberDelete(MEMBER_ID)).rejects.toThrow(
      /Member not found/
    )
  })

  it('falls back to a status-based message when the body is not JSON', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>503</html>', { status: 503 }) as never
    )

    await expect(performMemberDelete(MEMBER_ID)).rejects.toThrow(/503/)
  })

  it('throws when fetch itself rejects (network error)', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))

    await expect(performMemberDelete(MEMBER_ID)).rejects.toThrow(/network/)
  })
})
