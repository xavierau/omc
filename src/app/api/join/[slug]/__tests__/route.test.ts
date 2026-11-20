import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/application/register-member-web')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')

import { registerMemberWeb } from '@/application/register-member-web'
import { findBySlug } from '@/infrastructure/supabase/repositories/restaurant-repository'
import { POST } from '../route'

const RESTAURANT = {
  id: 'rest-1',
  name: 'Poppy',
  slug: 'poppy',
  kapso_phone_number_id: 'pn-1',
  meta_business_account_id: 'waba-1',
  status: 'active',
  plan: 'starter',
  trial_expires_at: null,
  referrer_id: null,
}

function post(body: unknown): Promise<Response> {
  const req = new NextRequest('http://localhost/api/join/poppy', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
  return POST(req, { params: Promise.resolve({ slug: 'poppy' }) })
}

describe('POST /api/join/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(findBySlug).mockResolvedValue(RESTAURANT as never)
  })

  it('new member -> {couponCode}', async () => {
    vi.mocked(registerMemberWeb).mockResolvedValueOnce({ isNew: true, memberId: 'm-new', couponCode: 'WLCM01' })

    const res = await post({ phone: '+85291234567', name: 'Bob' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ couponCode: 'WLCM01' })
  })

  // WONB-020 r2 G5: the use case answers every existing member the same way,
  // so the route body is identical whoever the member is.
  it('r2 AC-5: any existing member -> {existing:true, claimOnWhatsApp:true, whatsappClaimUrl}, no couponCode', async () => {
    const linked = { isNew: false, memberId: 'm-imp', whatsappClaimUrl: 'https://wa.me/85261234567?text=JOIN' }
    vi.mocked(registerMemberWeb).mockResolvedValueOnce(linked).mockResolvedValueOnce({ ...linked, memberId: 'm-welcomed' })

    const first = await (await post({ phone: '+85291234567', name: 'Ivy' })).json()
    const second = await (await post({ phone: '+85291234568', name: 'Wen' })).json()

    expect(first).toEqual({
      existing: true,
      claimOnWhatsApp: true,
      whatsappClaimUrl: 'https://wa.me/85261234567?text=JOIN',
    })
    expect(second).toEqual(first)
  })

  it('existing member and no usable WhatsApp number -> {existing:true}', async () => {
    vi.mocked(registerMemberWeb).mockResolvedValueOnce({ isNew: false, memberId: 'm-imp' })

    const res = await post({ phone: '+85291234567', name: 'Ivy' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ existing: true })
  })
})
