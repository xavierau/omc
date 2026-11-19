// CAMP-016 r3 (F8): the "N flagged" pill needs a number, not receipt rows —
// no image URLs or member phones leave the database for it.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/client', () => ({ createServerSupabaseClient: vi.fn() }))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { GET } from '../route'

function client(result: { count: number | null; error: { message: string } | null }) {
  const filters: Array<[string, unknown]> = []
  const query = {
    eq: vi.fn((col: string, val: unknown) => {
      filters.push([col, val])
      return filters.length === 2 ? Promise.resolve(result) : query
    }),
  }
  const select = vi.fn(() => query)
  const from = vi.fn(() => ({ select }))
  vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as never)
  return { from, select, filters }
}

beforeEach(() => {
  vi.mocked(getTenantContext).mockReset()
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u', restaurantId: 'rest-1', role: 'staff', tenantStatus: 'active' } as never)
})

describe('GET /api/dashboard/receipts/flagged/count', () => {
  it('returns a head count of the session tenant\'s flagged receipts, reading no rows', async () => {
    const c = client({ count: 73, error: null })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ count: 73 })
    expect(c.from).toHaveBeenCalledWith('receipts')
    expect(c.select).toHaveBeenCalledWith('id', { count: 'exact', head: true })
    expect(c.filters).toEqual([['restaurant_id', 'rest-1'], ['status', 'flagged']])
  })

  it('a database error is a 500, not a zero', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    client({ count: null, error: { message: 'down' } })
    expect((await GET()).status).toBe(500)
  })

  it('no session is the auth status', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Unauthorized', 401))
    expect((await GET()).status).toBe(401)
  })
})
