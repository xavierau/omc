// BOOK-002 F1 C10: the settings save reports statuses only; the editor's slot
// views (placeholders, default text) are built only for the overview.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/domain/services/booking-template-body', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/services/booking-template-body')>()
  return { ...actual, allowedBookingPlaceholders: vi.fn(actual.allowedBookingPlaceholders) }
})

import { allowedBookingPlaceholders } from '@/domain/services/booking-template-body'
import { bookingTemplateOverview, bookingTemplateStatuses } from '../booking/booking-template-statuses'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import { buildWhatsAppTemplate } from '@/test-utils/builders'

const RID = 'rest-1'
let config: BookingConfig

const deps = () => ({
  getConfig: vi.fn(async () => config),
  findTemplates: vi.fn(async () => [buildWhatsAppTemplate({ id: 'tpl-1', restaurantId: RID, status: 'approved' })]),
})

beforeEach(() => {
  vi.clearAllMocks()
  config = structuredClone(DEFAULT_BOOKING_CONFIG)
  config.templateIds.confirmed.en = 'tpl-1'
})

describe('bookingTemplateStatuses (statuses only)', () => {
  it('returns each status without building the editor slot views', async () => {
    const d = deps()
    const statuses = await bookingTemplateStatuses(RID, d)
    expect(statuses.confirmed).toEqual({ en: 'approved', zh_hk: 'not_submitted' })
    expect(d.getConfig).toHaveBeenCalledTimes(1)
    expect(allowedBookingPlaceholders).not.toHaveBeenCalled()
  })

  it('the overview does build them', async () => {
    const overview = await bookingTemplateOverview(RID, deps())
    expect(overview.slots.confirmed.en.placeholders).toContain('date')
    expect(allowedBookingPlaceholders).toHaveBeenCalled()
  })

  it('the overview can use a config the caller already read', async () => {
    const d = deps()
    const overview = await bookingTemplateOverview(RID, d, config)
    expect(d.getConfig).not.toHaveBeenCalled()
    expect(overview.templates.confirmed.en).toBe('approved')
  })
})
