// BOOK-001 W3-02 (UI part) and W3-10 render states: the campaign form's Book
// now toggle and booking URL override. External mode with no restaurant URL
// and no campaign URL disables the toggle with "Add a booking link in
// settings"; a toggle/template mismatch shows inline before the server 400s.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}.${key}`,
}))

import { bookNowFormView } from '../campaign-book-now-form'
import { CampaignBookNowFields } from '../campaign-book-now-fields'
import { buildCampaignRequestBody, initialCampaignForm, type CampaignFormState, type TemplateLookup } from '../campaign-form-types'
import { bookNowToggleState } from '@/domain/services/campaign-book-now'
import { buildWhatsAppTemplate } from '@/test-utils/builders'
import type { BookingAvailability } from '@/hooks/use-booking-availability'

const APP = 'https://app.ohmyclient.io'
const withButton = buildWhatsAppTemplate({
  id: 'tpl-b',
  components: [{ type: 'BODY', text: 'Hi' }, { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Book now', url: `${APP}/b/{{1}}` }] }],
})
const plain = buildWhatsAppTemplate({ id: 'tpl-p' })
const resolved = (template = withButton): TemplateLookup => ({ status: 'resolved', template })

const form = (o: Partial<CampaignFormState> = {}): CampaignFormState => ({
  ...initialCampaignForm, name: 'Promo', messageType: 'wa_template', whatsappTemplateId: 'tpl-b', ...o,
})
const simple: BookingAvailability = { mode: 'simple', externalUrl: null }
const externalNoUrl: BookingAvailability = { mode: 'external', externalUrl: null }

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_URL', APP))
afterEach(() => vi.unstubAllEnvs())

describe('bookNowToggleState', () => {
  it('External mode with no restaurant URL and no campaign URL → no_link (disabled)', () => {
    expect(bookNowToggleState({ mode: 'external', externalUrl: null, campaignUrl: null, enabled: false, templateHasButton: true })).toBe('no_link')
  })
  it('a campaign URL makes it available', () => {
    expect(bookNowToggleState({ mode: 'external', externalUrl: null, campaignUrl: 'https://inline.app/x', enabled: false, templateHasButton: true })).toBe('available')
  })
  it('hidden while booking is off, unless already on or the template carries the button', () => {
    const off = { mode: 'off' as const, externalUrl: null, campaignUrl: null }
    expect(bookNowToggleState({ ...off, enabled: false, templateHasButton: false })).toBe('hidden')
    expect(bookNowToggleState({ ...off, enabled: true, templateHasButton: false })).toBe('available')
    expect(bookNowToggleState({ ...off, enabled: false, templateHasButton: true })).toBe('available')
  })
})

describe('bookNowFormView', () => {
  it('Simple mode, toggle on, template with the button: available, preview shown, no issue, no URL field', () => {
    expect(bookNowFormView(form({ bookNowEnabled: true }), resolved(), simple)).toEqual({
      state: 'available', issue: null, showUrl: false, showPreview: true,
    })
  })

  it('flags the template mismatch both ways', () => {
    expect(bookNowFormView(form({ bookNowEnabled: true }), resolved(plain), simple).issue).toBe('template_missing_button')
    expect(bookNowFormView(form({ bookNowEnabled: false }), resolved(), simple).issue).toBe('toggle_off_with_button')
  })

  it('External mode shows the URL override; with no link anywhere the toggle is disabled', () => {
    const view = bookNowFormView(form(), resolved(), externalNoUrl)
    expect(view).toMatchObject({ state: 'no_link', showUrl: true, issue: null })
  })

  it('no availability yet (loading) and not on → hidden', () => {
    expect(bookNowFormView(form({ whatsappTemplateId: '' }), { status: 'unselected' }, null).state).toBe('hidden')
  })
})

describe('request body', () => {
  it('sends the toggle and the trimmed URL, null when blank', () => {
    expect(buildCampaignRequestBody(form({ bookNowEnabled: true, bookingUrl: ' https://inline.app/x ' }))).toMatchObject({
      bookNowEnabled: true, bookingUrl: 'https://inline.app/x',
    })
    expect(buildCampaignRequestBody(form())).toMatchObject({ bookNowEnabled: false, bookingUrl: null })
  })

  it('an inline campaign never sends Book now on', () => {
    expect(buildCampaignRequestBody(form({ messageType: 'inline', templateEn: 'Hi', bookNowEnabled: true }))).toMatchObject({
      bookNowEnabled: false,
    })
  })
})

describe('CampaignBookNowFields render', () => {
  const render = (f: CampaignFormState, lookup: TemplateLookup, availability: BookingAvailability | null) =>
    renderToStaticMarkup(
      <CampaignBookNowFields form={f} lookup={lookup} availability={availability} onToggle={() => {}} onChange={() => {}} />
    )

  it('toggle on: checked toggle and the preview line', () => {
    const html = render(form({ bookNowEnabled: true }), resolved(), simple)
    expect(html).toMatch(/data-testid="campaign-book-now-toggle"[^>]*checked=""|checked=""[^>]*data-testid="campaign-book-now-toggle"/)
    expect(html).toContain('data-testid="campaign-book-now-preview"')
    expect(html).not.toContain('data-testid="campaign-book-now-url"')
  })

  it('toggle off on a plain template: unchecked, no preview, no issue', () => {
    const html = render(form({ whatsappTemplateId: 'tpl-p' }), resolved(plain), simple)
    expect(html).toContain('data-testid="campaign-book-now-toggle"')
    expect(html).not.toMatch(/checked=""/)
    expect(html).not.toContain('data-testid="campaign-book-now-issue"')
  })

  it('External with no link: disabled toggle with the "Add a booking link in settings" hint and the URL field', () => {
    const html = render(form(), resolved(), externalNoUrl)
    expect(html).toMatch(/disabled=""[^>]*data-testid="campaign-book-now-toggle"|data-testid="campaign-book-now-toggle"[^>]*disabled=""/)
    expect(html).toContain('data-testid="campaign-book-now-no-link"')
    expect(html).toContain('campaigns.bookNowNoLink')
    expect(html).toContain('data-testid="campaign-book-now-url"')
    expect(html).not.toContain('data-testid="campaign-book-now-issue"')
  })

  it('shows the mismatch inline', () => {
    const html = render(form({ bookNowEnabled: false }), resolved(), simple)
    expect(html).toContain('data-testid="campaign-book-now-issue"')
    expect(html).toContain('campaigns.bookNowIssue.toggle_off_with_button')
  })

  it('renders nothing while booking is off and the template has no button', () => {
    expect(render(form({ whatsappTemplateId: 'tpl-p' }), resolved(plain), { mode: 'off', externalUrl: null })).toBe('')
  })
})
