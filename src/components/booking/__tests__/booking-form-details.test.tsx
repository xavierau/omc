// BOOK-009 F1 (review P2-1 ruling, P3-3): with the schedule switch off the
// diner page is the BOOK-001 date/time form, plus the restaurant info header,
// the table time and the terms with their required tick when set. A field
// error the page has no place for shows in the notice, and terms_required
// refreshes the page (the refresh brings the terms block).
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}:${JSON.stringify(vars)}` : `${ns}.${key}`,
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))

import { BookingPageView, type BookingPageViewModel } from '../booking-page-view'
import { BookingFormNotice, unplacedErrors } from '../booking-form'
import { needsRefresh } from '../slot-picker-model'
import { EMPTY_SLOT_FORM, sendSlotForm, type SlotFormValues } from '@/hooks/use-booking-slot-form'

const TERMS = { zh_hk: '逾時 15 分鐘。', en: 'Tables are held for 15 minutes.' }
const INFO = { address: '銅鑼灣示範街 1 號', phone: '2345 6789', mapUrl: 'https://maps.example/x' }
const NONE = { address: '', phone: '', mapUrl: '' }

function view(details?: { terms: typeof TERMS; info: typeof INFO; tableMinutes: 90 | 120 | 150 | 180 | null }): BookingPageViewModel {
  return {
    kind: 'form', restaurant: { name: 'Kushiro', logoUrl: null }, maskedPhone: '•••• 4567', maxPartySize: 8,
    today: '2026-11-20', retryUrl: null, ...(details ? { details } : {}),
  }
}
const render = (v: BookingPageViewModel) => renderToStaticMarkup(<BookingPageView view={v} token="t" />)

describe('schedule off: the BOOK-001 form with terms, info and table time', () => {
  it('terms only → legacy date/time inputs, the terms text and the required tick', () => {
    const html = render(view({ terms: TERMS, info: NONE, tableMinutes: null }))
    expect(html).toContain('data-testid="booking-form"')
    expect(html).not.toContain('data-variant="slots"')
    expect(html).toContain('id="booking-date"')
    expect(html).toContain('data-testid="booking-terms"')
    expect(html).toContain('data-testid="booking-terms-tick"')
    expect(html).toContain('逾時 15 分鐘。')
    expect(html).not.toContain('booking-restaurant-info')
  })

  it('info only → the info header above the legacy form, no terms block', () => {
    const html = render(view({ terms: { zh_hk: '', en: '' }, info: INFO, tableMinutes: null }))
    expect(html).toContain('data-testid="booking-restaurant-info"')
    expect(html.indexOf('booking-restaurant-info')).toBeLessThan(html.indexOf('data-testid="booking-form"'))
    expect(html).toContain('銅鑼灣示範街 1 號')
    expect(html).not.toContain('booking-terms')
  })

  it('table time only → the table time line on the legacy form', () => {
    const html = render(view({ terms: { zh_hk: '', en: '' }, info: NONE, tableMinutes: 120 }))
    expect(html).toContain('data-testid="booking-table-time"')
    expect(html).toContain('id="booking-time"')
  })

  it('AC-5: no details → none of the BOOK-009 blocks', () => {
    const html = render(view())
    for (const id of ['booking-terms', 'booking-restaurant-info', 'booking-table-time']) expect(html).not.toContain(id)
  })
})

describe('P3-3: refusals the page cannot place', () => {
  const fields = (errors: Record<string, string>) => ({ kind: 'fields' as const, errors })

  it('an error on a field the form does not render goes to the notice; placed ones do not', () => {
    expect(unplacedErrors(fields({ acceptTerms: 'terms_required', name: 'required' }), ['name'])).toEqual(['terms_required'])
    const html = renderToStaticMarkup(<BookingFormNotice outcome={fields({ acceptTerms: 'terms_required' })} placed={['name']} />)
    expect(html).toContain('data-testid="booking-form-error"')
    expect(html).toContain('booking.errors.terms_required')
    expect(renderToStaticMarkup(<BookingFormNotice outcome={fields({ name: 'required' })} placed={['name']} />)).toBe('')
  })

  it('terms_required refreshes the slot page and keeps every value (the time too)', async () => {
    expect(needsRefresh({ acceptTerms: 'terms_required' })).toBe(true)
    expect(needsRefresh({ name: 'required' })).toBe(false)
    const values: SlotFormValues = { ...EMPTY_SLOT_FORM, partySize: 2, date: '2026-11-21', time: '19:00', name: 'Chan' }
    const step = await sendSlotForm('t', values, false, async () => fields({ acceptTerms: 'terms_required' }))
    expect(step).toMatchObject({ refresh: true, values, changedTime: null })
  })

  it('a times-changed refusal still refreshes and clears only the time', async () => {
    const values: SlotFormValues = { ...EMPTY_SLOT_FORM, partySize: 2, date: '2026-11-21', time: '19:00', name: 'Chan' }
    const step = await sendSlotForm('t', values, false, async () => fields({ time: 'too_soon' }))
    expect(step).toMatchObject({ refresh: true, values: { ...values, time: '' }, changedTime: '19:00' })
  })
})
