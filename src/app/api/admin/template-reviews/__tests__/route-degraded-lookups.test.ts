// WAQ-011-DETAIL r1 (F4/F5): display-only lookups must never take the queue
// down. Real enrichTemplateReviews + real admin-identity-lookups; only the
// Supabase client underneath fails.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/platform-admin-guard')
vi.mock('@/infrastructure/rate-limit/admin-rate-limit')
vi.mock('@/infrastructure/supabase/repositories/template-review-repository', () => ({
  listTemplateReviewsByStatus: vi.fn(),
  findTemplateReviewById: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { assertPlatformAdmin } from '@/infrastructure/supabase/guards/platform-admin-guard'
import { checkAdminRateLimit } from '@/infrastructure/rate-limit/admin-rate-limit'
import { listTemplateReviewsByStatus } from '@/infrastructure/supabase/repositories/template-review-repository'
import { createServerSupabaseClient } from '@/infrastructure/supabase/client'
import { TemplateReview } from '@/domain/entities/template-review'
import { GET } from '../route'

const RESTAURANT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SUBMITTER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function failingClient() {
  const from = vi.fn(() => {
    const chain: Record<string, unknown> = {}
    chain.select = vi.fn(() => chain)
    chain.in = vi.fn(() => chain)
    chain.then = (ok: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: { message: 'relation unavailable' } }).then(ok)
    return chain
  })
  const listUsers = vi.fn(async () => { throw new Error('auth admin down') })
  const getUserById = vi.fn()
  return { from, auth: { admin: { listUsers, getUserById } } }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.mocked(assertPlatformAdmin).mockResolvedValue({ userId: 'admin-1' })
  vi.mocked(checkAdminRateLimit).mockReturnValue({ success: true, remaining: 59 })
})

describe('GET /api/admin/template-reviews — degraded lookups', () => {
  it('returns 200 with null names/emails when the restaurant and user lookups fail', async () => {
    const client = failingClient()
    vi.mocked(createServerSupabaseClient).mockReturnValue(client as never)
    vi.mocked(listTemplateReviewsByStatus).mockResolvedValue([
      TemplateReview.submit({
        id: 'rev-1',
        restaurantId: RESTAURANT,
        templateName: 'nov_promo_2026',
        contentPreview: 'Hello',
        submittedBy: SUBMITTER,
      }),
    ])

    const res = await GET(new NextRequest('http://localhost/api/admin/template-reviews'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.reviews).toHaveLength(1)
    expect(body.reviews[0]).toMatchObject({
      id: 'rev-1',
      restaurantId: RESTAURANT,
      restaurantName: null,
      submitterEmail: null,
    })
    expect(client.auth.admin.listUsers).toHaveBeenCalledTimes(1)
    expect(client.auth.admin.getUserById).not.toHaveBeenCalled()
  })
})
