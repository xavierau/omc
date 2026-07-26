import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { updateContactConfig } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { TOPIC_COUNT, TOPIC_MAX_LEN, ACK_MAX_LEN } from '@/domain/services/contact-config'
import { PATCH } from '../contact-config/route'

const RESTAURANT_ID = 'rest-1'
const VALID_TOPICS = ['訂座查詢', '外賣及自取', '會員及積分查詢', '意見及投訴', '其他查詢']

function req(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/settings/contact-config', {
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

describe('PATCH /api/dashboard/settings/contact-config', () => {
  beforeEach(() => vi.clearAllMocks())

  it('persists a normalized redirect-mode config, tenant-scoped', async () => {
    tenantOk()
    vi.mocked(updateContactConfig).mockResolvedValue()

    const res = await PATCH(req({ mode: 'redirect' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ success: true })
    expect(updateContactConfig).toHaveBeenCalledWith(RESTAURANT_ID, {
      mode: 'redirect',
      notificationEmail: null,
      topics: VALID_TOPICS,
      ackText: null,
    })
  })

  it('persists a normalized form-mode config', async () => {
    tenantOk()
    vi.mocked(updateContactConfig).mockResolvedValue()

    const res = await PATCH(
      req({
        mode: 'form',
        notificationEmail: '  owner@example.com  ',
        topics: VALID_TOPICS,
        ackText: '  Thanks!  ',
      })
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json).toEqual({ success: true })
    expect(updateContactConfig).toHaveBeenCalledWith(RESTAURANT_ID, {
      mode: 'form',
      notificationEmail: 'owner@example.com',
      topics: VALID_TOPICS,
      ackText: 'Thanks!',
    })
  })

  it('ignores a body-supplied restaurant/tenant id and uses the session id', async () => {
    tenantOk()
    vi.mocked(updateContactConfig).mockResolvedValue()

    await PATCH(
      req({
        mode: 'redirect',
        restaurantId: 'attacker-rest',
        tenantId: 'attacker-rest',
      })
    )

    expect(updateContactConfig).toHaveBeenCalledWith(
      RESTAURANT_ID,
      expect.any(Object)
    )
  })

  it('rejects form mode without a notification email with 400', async () => {
    tenantOk()

    const res = await PATCH(req({ mode: 'form', topics: VALID_TOPICS }))
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/notificationEmail/)
    expect(updateContactConfig).not.toHaveBeenCalled()
  })

  it('rejects a topic list with the wrong count with 400', async () => {
    tenantOk()

    const res = await PATCH(
      req({
        mode: 'form',
        notificationEmail: 'owner@example.com',
        topics: VALID_TOPICS.slice(0, TOPIC_COUNT - 1),
      })
    )

    expect(res.status).toBe(400)
    expect(updateContactConfig).not.toHaveBeenCalled()
  })

  it('rejects an over-length topic entry with 400', async () => {
    tenantOk()

    const res = await PATCH(
      req({
        mode: 'form',
        notificationEmail: 'owner@example.com',
        topics: [
          'a'.repeat(TOPIC_MAX_LEN + 1),
          ...VALID_TOPICS.slice(1),
        ],
      })
    )

    expect(res.status).toBe(400)
    expect(updateContactConfig).not.toHaveBeenCalled()
  })

  it('rejects an over-length ackText with 400', async () => {
    tenantOk()

    const res = await PATCH(
      req({
        mode: 'form',
        notificationEmail: 'owner@example.com',
        topics: VALID_TOPICS,
        ackText: 'a'.repeat(ACK_MAX_LEN + 1),
      })
    )

    expect(res.status).toBe(400)
    expect(updateContactConfig).not.toHaveBeenCalled()
  })

  it('propagates the AuthError status when there is no tenant context', async () => {
    vi.mocked(getTenantContext).mockRejectedValue(new AuthError('Forbidden', 403))

    const res = await PATCH(req({ mode: 'redirect' }))

    expect(res.status).toBe(403)
    expect(updateContactConfig).not.toHaveBeenCalled()
  })

  it('returns 500 when the repository write fails', async () => {
    tenantOk()
    vi.mocked(updateContactConfig).mockRejectedValue(new Error('db down'))

    const res = await PATCH(req({ mode: 'redirect' }))

    expect(res.status).toBe(500)
  })
})
