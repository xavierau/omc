import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchMemberDetail } from '@/components/dashboard/member-detail-helpers'

const MEMBER_ID = 'mem-1'

describe('fetchMemberDetail', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('calls GET /api/dashboard/members?id= and resolves the payload on 200', async () => {
    const payload = { id: MEMBER_ID, name: 'Alice', receipts: [], coupons: [], visitCount: 0 }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as never
    )

    await expect(fetchMemberDetail(MEMBER_ID)).resolves.toEqual(payload)
    expect(fetchMock).toHaveBeenCalledWith(`/api/dashboard/members?id=${MEMBER_ID}`)
  })

  it('resolves null on 404 instead of treating the error body as a member', async () => {
    // The 404 body is { error: 'Member not found' } — truthy, and it used
    // to be handed to the panel as a "member", crashing the receipts
    // renderer (#111 review finding). Null renders the not-found state.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: 'Member not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      }) as never
    )

    await expect(fetchMemberDetail(MEMBER_ID)).resolves.toBeNull()
  })

  it('resolves null on a 5xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('oops', { status: 500 }) as never
    )

    await expect(fetchMemberDetail(MEMBER_ID)).resolves.toBeNull()
  })

  it('rejects when fetch itself rejects (network error) — the panel catch handles it', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'))

    await expect(fetchMemberDetail(MEMBER_ID)).rejects.toThrow(/network/)
  })
})
