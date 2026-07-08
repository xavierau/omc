import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { updateReplyConfig } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { REPLY_TEXT_MAX } from '@/domain/services/reply-config'
import { PATCH } from '../reply-config/route'

const RESTAURANT_ID = 'rest-1'

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/settings/reply-config', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function tenantOk() {
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'u-1',
    restaurantId: RESTAURANT_ID,
    role: 'admin',
    tenantStatus: 'active',
  })
}

describe('PATCH /api/dashboard/settings/reply-config', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists a normalized config, tenant-scoped', async () => {
    tenantOk()
    vi.mocked(updateReplyConfig).mockResolvedValue()

    const res = await PATCH(
      req({
        features: { points: false, card: false },
        text: { unknown: { en: '  Try MENU  ', zh: '' } },
      })
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ success: true })
    expect(updateReplyConfig).toHaveBeenCalledWith(RESTAURANT_ID, {
      features: { points: false, rewards: true, redeem: true, card: false },
      text: {
        unknown: { en: 'Try MENU', zh: null },
        help: { en: null, zh: null },
        join: { en: null, zh: null },
      },
    })
  })

  it('coerces a non-boolean feature flag to enabled', async () => {
    tenantOk()
    vi.mocked(updateReplyConfig).mockResolvedValue()

    await PATCH(req({ features: { points: 'nope' } }))

    const [, config] = vi.mocked(updateReplyConfig).mock.calls[0]
    expect(config.features.points).toBe(true)
  })

  it('rejects over-length text with 400 and does not touch the repo', async () => {
    tenantOk()

    const res = await PATCH(
      req({ text: { help: { en: 'a'.repeat(REPLY_TEXT_MAX.help + 1) } } })
    )

    expect(res.status).toBe(400)
    expect(updateReplyConfig).not.toHaveBeenCalled()
  })

  it('propagates the AuthError status when there is no tenant context', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden', 403))

    const res = await PATCH(req({ features: {} }))

    expect(res.status).toBe(403)
    expect(updateReplyConfig).not.toHaveBeenCalled()
  })

  it('returns 500 when the repository write fails', async () => {
    tenantOk()
    vi.mocked(updateReplyConfig).mockRejectedValue(new Error('db down'))

    const res = await PATCH(req({ features: {} }))

    expect(res.status).toBe(500)
  })
})
