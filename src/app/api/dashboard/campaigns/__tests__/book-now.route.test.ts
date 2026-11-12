// BOOK-001 W3-02 (AC-16/AC-17, R14): the campaign API stores the Book now
// toggle and booking URL override, and refuses a toggle that disagrees with
// the template, an unsafe URL, or External mode with no link at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository', async () => {
  const actual = await vi.importActual<typeof import('@/infrastructure/supabase/repositories/campaign-repository')>(
    '@/infrastructure/supabase/repositories/campaign-repository'
  )
  return { ...actual, createCampaign: vi.fn(), getCampaignById: vi.fn(), updateCampaign: vi.fn() }
})
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository', () => ({
  findByIdForRestaurant: vi.fn(),
  findManyByIdsForRestaurant: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/infrastructure/supabase/repositories/booking-config-repository')
vi.mock('@/application/cascade-campaign-type-change', () => ({ cascadeCampaignTypeChange: vi.fn() }))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { createCampaign, getCampaignById, updateCampaign } from '@/infrastructure/supabase/repositories/campaign-repository'
import { getRestaurantDefaultLanguage } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { findByIdForRestaurant } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { getBookingConfig } from '@/infrastructure/supabase/repositories/booking-config-repository'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'
import { buildCampaign, buildWhatsAppTemplate } from '@/test-utils/builders'
import type { TemplateButton, WhatsAppTemplate } from '@/domain/entities/whatsapp-template'
import { POST } from '../route'
import { PATCH } from '../[id]/route'

const RID = 'rest-1'
const APP = 'https://app.ohmyclient.io'
const BOOK_NOW: TemplateButton = { type: 'URL', text: 'Book now', url: `${APP}/b/{{1}}` }

const tpl = (buttons: TemplateButton[], id = 'tpl-1'): WhatsAppTemplate =>
  buildWhatsAppTemplate({ id, restaurantId: RID, components: [{ type: 'BODY', text: 'Hi' }, { type: 'BUTTONS', buttons }] })

const base = { name: 'Friday promo', type: 'promo', whatsappTemplateId: 'tpl-1', status: 'active' }

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/dashboard/campaigns', { method: 'POST', body: JSON.stringify(body) }))
const patch = (body: unknown) =>
  PATCH(new NextRequest('http://localhost/api/dashboard/campaigns/c-1', { method: 'PATCH', body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: 'c-1' }),
  })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('NEXT_PUBLIC_APP_URL', APP)
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId: RID, role: 'admin', tenantStatus: 'active' })
  vi.mocked(getRestaurantDefaultLanguage).mockResolvedValue('zh_hk')
  vi.mocked(createCampaign).mockImplementation(async (p) => buildCampaign({ restaurantId: RID, bookNowEnabled: p.bookNowEnabled, bookingUrl: p.bookingUrl }))
  vi.mocked(updateCampaign).mockImplementation(async (_id, c) => buildCampaign({ id: 'c-1', restaurantId: RID, ...c }))
  vi.mocked(getCampaignById).mockResolvedValue(buildCampaign({ id: 'c-1', restaurantId: RID, whatsappTemplateId: 'tpl-1' }))
  vi.mocked(findByIdForRestaurant).mockResolvedValue(tpl([BOOK_NOW]))
  vi.mocked(getBookingConfig).mockResolvedValue({ ...DEFAULT_BOOKING_CONFIG, mode: 'simple' })
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/dashboard/campaigns with Book now', () => {
  it('persists book_now_enabled and booking_url', async () => {
    const res = await post({ ...base, bookNowEnabled: true, bookingUrl: 'https://inline.app/booking/kushiro' })
    expect(res.status).toBe(201)
    expect(vi.mocked(createCampaign).mock.calls[0][0]).toMatchObject({
      bookNowEnabled: true,
      bookingUrl: 'https://inline.app/booking/kushiro',
    })
  })

  it('looks the template up scoped to the session restaurant', async () => {
    await post({ ...base, bookNowEnabled: true })
    expect(findByIdForRestaurant).toHaveBeenCalledWith('tpl-1', RID)
  })

  it('toggle on with a template that has no Book now button → 400 with the inline error, nothing stored', async () => {
    vi.mocked(findByIdForRestaurant).mockResolvedValue(tpl([{ type: 'URL', text: 'Menu', url: 'https://x.example/menu' }]))
    const res = await post({ ...base, bookNowEnabled: true })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Book now button/)
    expect(createCampaign).not.toHaveBeenCalled()
  })

  it('another tenant\'s template counts as no button (scoped lookup returns null) → 400', async () => {
    vi.mocked(findByIdForRestaurant).mockResolvedValue(null)
    expect((await post({ ...base, bookNowEnabled: true })).status).toBe(400)
    expect(createCampaign).not.toHaveBeenCalled()
  })

  it('a template with the Book now button and the toggle off → 400', async () => {
    const res = await post({ ...base, bookNowEnabled: false })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/turn on Book now/i)
    expect(createCampaign).not.toHaveBeenCalled()
  })

  it('an inline campaign with the toggle on → 400', async () => {
    const res = await post({ name: 'n', type: 'promo', templateEn: 'Hi', bookNowEnabled: true })
    expect(res.status).toBe(400)
    expect(createCampaign).not.toHaveBeenCalled()
  })

  it.each(['javascript:alert(1)', 'http://inline.app/x', 'data:text/html,<b>x</b>', 'inline.app/x', 'https://', `https://x.example/${'a'.repeat(2049)}`, 42])(
    'R14: booking URL %s → 400 and nothing stored',
    async (bookingUrl) => {
      const res = await post({ ...base, bookNowEnabled: true, bookingUrl })
      expect(res.status).toBe(400)
      expect((await res.json()).error).toMatch(/bookingUrl/)
      expect(createCampaign).not.toHaveBeenCalled()
    }
  )

  it('External mode with no restaurant URL and no campaign URL → 400 "Add a booking link in settings"', async () => {
    vi.mocked(getBookingConfig).mockResolvedValue({ ...DEFAULT_BOOKING_CONFIG, mode: 'external', externalUrl: null })
    const res = await post({ ...base, bookNowEnabled: true })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Add a booking link in settings/)
  })

  it('External mode with only a campaign URL is accepted (AC-17)', async () => {
    vi.mocked(getBookingConfig).mockResolvedValue({ ...DEFAULT_BOOKING_CONFIG, mode: 'external', externalUrl: null })
    expect((await post({ ...base, bookNowEnabled: true, bookingUrl: 'https://inline.app/b/x' })).status).toBe(201)
  })

  it('a campaign without Book now fields and a plain template creates as before (defaults off, no URL)', async () => {
    vi.mocked(findByIdForRestaurant).mockResolvedValue(tpl([]))
    expect((await post(base)).status).toBe(201)
    expect(vi.mocked(createCampaign).mock.calls[0][0]).toMatchObject({ bookNowEnabled: false, bookingUrl: null })
  })
})

// F2 (review S-2): the welcome send (partner API, onboarding) has no booking
// token to put on a Book now button, so Meta would refuse every welcome.
describe('Book now is refused on welcome campaigns', () => {
  it('POST welcome with the toggle on → 400, nothing stored', async () => {
    const res = await post({ ...base, type: 'welcome', bookNowEnabled: true })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/welcome/i)
    expect(createCampaign).not.toHaveBeenCalled()
  })

  it('POST welcome on a template with the Book now button, toggle off → 400', async () => {
    const res = await post({ ...base, type: 'welcome', bookNowEnabled: false })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/welcome/i)
    expect(createCampaign).not.toHaveBeenCalled()
  })

  it('POST welcome on a plain template with the toggle off is accepted as before', async () => {
    vi.mocked(findByIdForRestaurant).mockResolvedValue(tpl([]))
    expect((await post({ ...base, type: 'welcome' })).status).toBe(201)
  })

  it('PATCH changing a Book now campaign to welcome → 400, nothing written', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign({ id: 'c-1', restaurantId: RID, whatsappTemplateId: 'tpl-1', bookNowEnabled: true }))
    const res = await patch({ type: 'welcome' })
    expect(res.status).toBe(400)
    expect(updateCampaign).not.toHaveBeenCalled()
  })

  it('PATCH turning Book now on for a stored welcome campaign → 400', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign({ id: 'c-1', restaurantId: RID, type: 'welcome', whatsappTemplateId: 'tpl-1' }))
    expect((await patch({ bookNowEnabled: true })).status).toBe(400)
    expect(updateCampaign).not.toHaveBeenCalled()
  })
})

// F4 (threat model R14, ruling 2026-11-12, review S-3): every recipient is
// redirected to the campaign booking URL, so setting or changing it is
// admin-only. Staff may still toggle Book now and edit everything else.
describe('campaign booking URL is admin-only (R14)', () => {
  const asStaff = () =>
    vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-2', restaurantId: RID, role: 'staff', tenantStatus: 'active' })
  const stored = (bookingUrl: string | null) =>
    vi.mocked(getCampaignById).mockResolvedValue(
      buildCampaign({ id: 'c-1', restaurantId: RID, whatsappTemplateId: 'tpl-1', bookNowEnabled: true, bookingUrl })
    )

  it('staff POST with a booking URL → 403, nothing stored', async () => {
    asStaff()
    const res = await post({ ...base, bookNowEnabled: true, bookingUrl: 'https://phish.example/x' })
    expect(res.status).toBe(403)
    expect(createCampaign).not.toHaveBeenCalled()
  })

  it('staff POST with Book now on and no booking URL is accepted', async () => {
    asStaff()
    expect((await post({ ...base, bookNowEnabled: true, bookingUrl: null })).status).toBe(201)
  })

  it('staff PATCH setting or changing the booking URL → 403, nothing written', async () => {
    asStaff()
    stored(null)
    expect((await patch({ bookingUrl: 'https://phish.example/x' })).status).toBe(403)
    stored('https://inline.app/a')
    expect((await patch({ bookingUrl: 'https://phish.example/x' })).status).toBe(403)
    expect((await patch({ bookingUrl: null })).status).toBe(403)
    expect(updateCampaign).not.toHaveBeenCalled()
  })

  it('staff PATCH that resends the stored URL with other edits is accepted', async () => {
    asStaff()
    stored('https://inline.app/a')
    const res = await patch({ name: 'Renamed', bookNowEnabled: true, bookingUrl: ' https://inline.app/a ' })
    expect(res.status).toBe(200)
  })

  it('admin PATCH changing the booking URL is accepted', async () => {
    stored('https://inline.app/a')
    expect((await patch({ bookingUrl: 'https://inline.app/b' })).status).toBe(200)
  })
})

describe('PATCH /api/dashboard/campaigns/[id] with Book now', () => {
  it('persists the toggle and URL', async () => {
    const res = await patch({ bookNowEnabled: true, bookingUrl: 'https://inline.app/booking/kushiro' })
    expect(res.status).toBe(200)
    expect(vi.mocked(updateCampaign).mock.calls[0][1]).toMatchObject({
      bookNowEnabled: true,
      bookingUrl: 'https://inline.app/booking/kushiro',
    })
  })

  it('switching to a template without the button while the stored toggle is on → 400, nothing written', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign({ id: 'c-1', restaurantId: RID, whatsappTemplateId: 'tpl-1', bookNowEnabled: true }))
    vi.mocked(findByIdForRestaurant).mockResolvedValue(tpl([], 'tpl-2'))
    const res = await patch({ whatsappTemplateId: 'tpl-2' })
    expect(res.status).toBe(400)
    expect(findByIdForRestaurant).toHaveBeenCalledWith('tpl-2', RID)
    expect(updateCampaign).not.toHaveBeenCalled()
  })

  it('turning the toggle off on a Book now template → 400', async () => {
    const res = await patch({ bookNowEnabled: false })
    expect(res.status).toBe(400)
    expect(updateCampaign).not.toHaveBeenCalled()
  })

  it('R14: an unsafe booking URL → 400', async () => {
    const res = await patch({ bookingUrl: 'javascript:alert(1)' })
    expect(res.status).toBe(400)
    expect(updateCampaign).not.toHaveBeenCalled()
  })

  it('a patch that touches no Book now field reads no template or config', async () => {
    expect((await patch({ name: 'Renamed' })).status).toBe(200)
    expect(findByIdForRestaurant).not.toHaveBeenCalled()
    expect(getBookingConfig).not.toHaveBeenCalled()
  })

  it('another tenant\'s campaign → 403 before any Book now check', async () => {
    vi.mocked(getCampaignById).mockResolvedValue(buildCampaign({ id: 'c-1', restaurantId: 'rest-other' }))
    expect((await patch({ bookNowEnabled: true })).status).toBe(403)
    expect(findByIdForRestaurant).not.toHaveBeenCalled()
  })
})
