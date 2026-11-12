// BOOK-001 W3-05 (AC-1 templates): saving Simple booking provisions the
// booking templates; settings stay saved when submission fails; the PUT body
// can never set templateIds; GET returns the mode and each template status.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/booking-config-repository')
vi.mock('@/application/booking/booking-template-deps', () => ({
  provisionBookingTemplatesFor: vi.fn(),
  bookingTemplateStatusesFor: vi.fn(),
  bookingTemplateOverviewFor: vi.fn(),
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getBookingConfig, updateBookingConfig } from '@/infrastructure/supabase/repositories/booking-config-repository'
import {
  provisionBookingTemplatesFor,
  bookingTemplateStatusesFor,
  bookingTemplateOverviewFor,
} from '@/application/booking/booking-template-deps'
import type { BookingTemplateSlotViews } from '@/application/booking/booking-template-statuses'
import { DEFAULT_BOOKING_CONFIG } from '@/domain/value-objects/booking-config'
import type { BookingTemplateStatuses } from '@/domain/services/booking-templates'
import { GET, PUT } from '../route'

const RID = 'rest-1'
const all = (status: string) =>
  Object.fromEntries(['received', 'confirmed', 'declined', 'reminder'].map((k) => [k, { en: status, zh_hk: status }])) as BookingTemplateStatuses

const SLOTS = { received: {} } as unknown as BookingTemplateSlotViews

const put = (body: unknown) =>
  PUT(new NextRequest('http://localhost/api/dashboard/settings/booking', { method: 'PUT', body: JSON.stringify(body) }))

function as(role: string) {
  vi.mocked(getTenantContext).mockResolvedValue({ userId: 'u-1', restaurantId: RID, role, tenantStatus: 'active' })
}

beforeEach(() => {
  vi.clearAllMocks()
  as('admin')
  vi.mocked(getBookingConfig).mockResolvedValue({ ...DEFAULT_BOOKING_CONFIG })
  vi.mocked(updateBookingConfig).mockResolvedValue()
  vi.mocked(provisionBookingTemplatesFor).mockResolvedValue(all('pending'))
  vi.mocked(bookingTemplateStatusesFor).mockResolvedValue(all('not_submitted'))
  vi.mocked(bookingTemplateOverviewFor).mockResolvedValue({ templates: all('not_submitted'), slots: SLOTS })
})

describe('PUT booking settings → template provisioning', () => {
  it('saving Simple booking saves first, then provisions, and returns the statuses', async () => {
    const res = await put({ mode: 'simple' })
    expect(res.status).toBe(200)
    expect(provisionBookingTemplatesFor).toHaveBeenCalledWith(RID)
    expect(vi.mocked(updateBookingConfig).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(provisionBookingTemplatesFor).mock.invocationCallOrder[0]
    )
    expect((await res.json()).templates).toEqual(all('pending'))
  })

  it.each(['off', 'external'])('saving %s mode submits nothing', async (mode) => {
    await put({ mode, externalUrl: mode === 'external' ? 'https://inline.app/x' : null })
    expect(provisionBookingTemplatesFor).not.toHaveBeenCalled()
  })

  it('a provisioning crash leaves the settings saved (200) and reports the stored statuses', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(provisionBookingTemplatesFor).mockRejectedValue(new Error('kapso down'))
    vi.mocked(bookingTemplateStatusesFor).mockResolvedValue(all('failed'))
    const res = await put({ mode: 'simple' })
    expect(res.status).toBe(200)
    expect(updateBookingConfig).toHaveBeenCalledTimes(1)
    expect((await res.json()).templates).toEqual(all('failed'))
  })

  it('the PUT body cannot set templateIds', async () => {
    const res = await put({ mode: 'simple', templateIds: { received: { en: 'evil', zh_hk: 'evil' } } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid', fields: { form: 'unknown_field:templateIds' } })
    expect(updateBookingConfig).not.toHaveBeenCalled()
    expect(provisionBookingTemplatesFor).not.toHaveBeenCalled()
  })

  it('staff cannot trigger provisioning (403)', async () => {
    as('staff')
    expect((await put({ mode: 'simple' })).status).toBe(403)
    expect(provisionBookingTemplatesFor).not.toHaveBeenCalled()
  })
})

describe('GET booking settings', () => {
  it('returns mode, external URL and template statuses for the session restaurant (any member)', async () => {
    as('staff')
    vi.mocked(getBookingConfig).mockResolvedValue({ ...DEFAULT_BOOKING_CONFIG, mode: 'external', externalUrl: 'https://inline.app/x' })
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      mode: 'external', externalUrl: 'https://inline.app/x', templates: all('not_submitted'), canEditBookingUrl: false,
      templateEditor: { canEdit: false, slots: SLOTS },
    })
    expect(getBookingConfig).toHaveBeenCalledWith(RID)
    expect(bookingTemplateOverviewFor).toHaveBeenCalledWith(RID)
  })

  // F4 (R14 ruling 2026-11-12): the campaign form shows the booking URL
  // override read-only to anyone the API would refuse.
  it('tells an admin they may edit a campaign booking URL', async () => {
    as('admin')
    expect((await (await GET()).json()).canEditBookingUrl).toBe(true)
  })
})
