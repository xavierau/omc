// BOOK-001 F2 (re-review N-1): a booking-template draft stored while the
// restaurant had no WABA id reaches Meta on a later Simple save, once the WABA
// can be resolved from the linked number. Runs the real composition root
// (provisionBookingTemplatesFor → updateWhatsAppTemplate) over mocked infra.
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/booking-config-repository')
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-repository')
vi.mock('@/infrastructure/whatsapp/templates')
vi.mock('@/infrastructure/kapso/template-media-upload')

import { getBookingConfig, saveBookingTemplateIds } from '@/infrastructure/supabase/repositories/booking-config-repository'
import {
  findManyByIdsForRestaurant,
  findTemplateByIdForRestaurant,
  updateTemplate,
} from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import {
  getMetaBusinessAccountId,
  getRestaurantPhoneNumberId,
  updateMetaBusinessAccountId,
} from '@/infrastructure/supabase/repositories/restaurant-repository'
import { createMetaTemplate, resolveWabaId } from '@/infrastructure/whatsapp/templates'
import { provisionBookingTemplatesFor } from '../booking/booking-template-deps'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import { buildWhatsAppTemplate } from '@/test-utils/builders'
import { okSubmit } from '@/test-utils/template-submit-result'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

const RID = 'rest-1'
const DRAFT = 'tpl-draft'
let rows: Map<string, WhatsAppTemplate>

/** Every booking template pending on Meta except received/en, a stored draft that never reached Meta. */
function seed(): BookingConfig {
  rows = new Map()
  const ids = structuredClone(DEFAULT_BOOKING_CONFIG.templateIds)
  for (const kind of Object.keys(ids) as (keyof typeof ids)[]) {
    for (const lang of ['en', 'zh_hk'] as const) {
      const id = `tpl-${kind}-${lang}`
      ids[kind][lang] = id
      rows.set(id, buildWhatsAppTemplate({ id, restaurantId: RID, status: 'pending', metaTemplateId: `m-${id}` }))
    }
  }
  ids.received.en = DRAFT
  rows.set(DRAFT, buildWhatsAppTemplate({
    id: DRAFT, restaurantId: RID, name: 'booking_received_abc123', language: 'en', category: 'UTILITY', status: 'draft', metaTemplateId: null,
  }))
  return { ...DEFAULT_BOOKING_CONFIG, mode: 'simple', templateIds: ids }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBookingConfig).mockResolvedValue(seed())
  vi.mocked(saveBookingTemplateIds).mockResolvedValue()
  vi.mocked(findManyByIdsForRestaurant).mockImplementation(async (ids) => ids.map((id) => rows.get(id)).filter((t): t is WhatsAppTemplate => !!t))
  vi.mocked(findTemplateByIdForRestaurant).mockImplementation(async (id) => rows.get(id) ?? null)
  vi.mocked(updateTemplate).mockImplementation(async (id, changes) => {
    const t = { ...(rows.get(id) as WhatsAppTemplate), ...changes } as WhatsAppTemplate
    rows.set(id, t)
    return t
  })
  // The restaurant row's WABA column: unset ('') until something stores it.
  let storedWaba = ''
  vi.mocked(getMetaBusinessAccountId).mockImplementation(async () => storedWaba)
  vi.mocked(updateMetaBusinessAccountId).mockImplementation(async (_rid, waba) => { storedWaba = waba })
  vi.mocked(getRestaurantPhoneNumberId).mockResolvedValue('pn-1')
  vi.mocked(resolveWabaId).mockResolvedValue('waba-1')
  vi.mocked(createMetaTemplate).mockResolvedValue(okSubmit('meta-new'))
})

describe('provisionBookingTemplatesFor: WABA unknown when the draft was stored', () => {
  it('resolves and stores the WABA, then submits the draft to Meta in place', async () => {
    const statuses = await provisionBookingTemplatesFor(RID)
    expect(updateMetaBusinessAccountId).toHaveBeenCalledWith(RID, 'waba-1')
    expect(createMetaTemplate).toHaveBeenCalledTimes(1)
    expect(createMetaTemplate).toHaveBeenCalledWith('waba-1', expect.objectContaining({ name: 'booking_received_abc123', language: 'en' }))
    expect(rows.get(DRAFT)).toMatchObject({ status: 'pending', metaTemplateId: 'meta-new' })
    expect(statuses.received.en).toBe('pending')
  })

  it('still unresolvable: the draft stays failed, nothing reaches Meta, ids are kept', async () => {
    vi.mocked(resolveWabaId).mockResolvedValue(null)
    const statuses = await provisionBookingTemplatesFor(RID)
    expect(createMetaTemplate).not.toHaveBeenCalled()
    expect(updateMetaBusinessAccountId).not.toHaveBeenCalled()
    expect(statuses.received.en).toBe('failed')
    expect(vi.mocked(saveBookingTemplateIds).mock.calls[0][1].received.en).toBe(DRAFT)
  })

  it('a stored WABA is used as is, with no resolution call', async () => {
    vi.mocked(getMetaBusinessAccountId).mockResolvedValue('waba-stored')
    await provisionBookingTemplatesFor(RID)
    expect(resolveWabaId).not.toHaveBeenCalled()
    expect(createMetaTemplate).toHaveBeenCalledWith('waba-stored', expect.anything())
  })
})
