// BOOK-001 W3-01: the template editor's "Book now button" preset inserts a
// dynamic URL button `${APP_URL}/b/{{1}}` with an example value for Meta
// review, round-trips on edit, and passes template validation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  addBookNowButton,
  buildWaTemplateRequestBody,
  initialWaTemplateForm,
  templateToFormState,
  validateWaTemplateButtons,
  type TemplateButton,
} from '../wa-template-form-types'
import { WaTemplateButtonsSection } from '../wa-template-buttons-section'
import { validateTemplateComponents } from '@/domain/services/validate-template-components'
import { prepareTemplateComponents } from '@/domain/services/prepare-template-components'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'

const APP = 'https://app.ohmyclient.io'
const bookNow = (): TemplateButton => ({ type: 'BOOK_NOW_URL', text: 'Book now', url: '', phoneNumber: '' })

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_APP_URL', APP))
afterEach(() => vi.unstubAllEnvs())

function buttonsOf(buttons: TemplateButton[]) {
  const body = buildWaTemplateRequestBody({ ...initialWaTemplateForm, name: 'promo', body: 'Hi', buttons })
  return body.components.find((c) => c.type === 'BUTTONS') as { type: 'BUTTONS'; buttons: Record<string, unknown>[] }
}

describe('Book now button preset', () => {
  it('inserts one Book now button labelled "Book now"', () => {
    expect(addBookNowButton([])).toEqual([bookNow()])
  })

  it('does nothing when the template already has one, or already has 3 buttons', () => {
    expect(addBookNowButton([bookNow()])).toEqual([bookNow()])
    const three: TemplateButton[] = [1, 2, 3].map((i) => ({ type: 'URL', text: `b${i}`, url: 'https://x.example', phoneNumber: '' }))
    expect(addBookNowButton(three)).toBe(three)
  })

  it('submits a URL button `${APP_URL}/b/{{1}}` with an example URL for Meta review', () => {
    expect(buttonsOf([bookNow()]).buttons).toEqual([
      { type: 'URL', text: 'Book now', url: `${APP}/b/{{1}}`, example: [`${APP}/b/sample-booking-link`] },
    ])
  })

  it('coexists with a coupon link: two URL buttons, each with its own URL', () => {
    const coupon: TemplateButton = { type: 'COUPON_URL', text: 'Get coupon', url: '', phoneNumber: '' }
    expect(buttonsOf([coupon, bookNow()]).buttons.map((b) => b.url)).toEqual([`${APP}/coupon/{{1}}`, `${APP}/b/{{1}}`])
    expect(validateWaTemplateButtons([coupon, bookNow()])).toBeNull()
  })

  it('round-trips: a stored Book now button opens as the Book now type, not a plain URL', () => {
    const stored = { name: 'promo', language: 'en', category: 'MARKETING', components: [
      { type: 'BODY', text: 'Hi' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Book now', url: `${APP}/b/{{1}}` }] },
    ] }
    expect(templateToFormState(stored).buttons).toEqual([bookNow()])
  })

  it('refuses a second Book now button with a readable message', () => {
    expect(validateWaTemplateButtons([bookNow(), bookNow()])).toMatch(/one Book now button/)
  })

  it('template validation accepts it, and the example survives preparation for Meta', () => {
    const components = buildWaTemplateRequestBody({ ...initialWaTemplateForm, name: 'p', body: 'Hi', buttons: [bookNow()] })
      .components as unknown as TemplateComponent[]
    expect(validateTemplateComponents(components)).toBeNull()
    const prepared = prepareTemplateComponents(components).find((c) => c.type === 'BUTTONS')
    expect(prepared?.buttons?.[0]).toMatchObject({ url: `${APP}/b/{{1}}`, example: [`${APP}/b/sample-booking-link`] })
  })
})

describe('buttons section', () => {
  const render = (buttons: TemplateButton[]) =>
    renderToStaticMarkup(<WaTemplateButtonsSection buttons={buttons} onChange={() => {}} />)

  it('offers the "Book now button" preset when the template has none', () => {
    const html = render([])
    expect(html).toContain('data-testid="booking-template-preset"')
    expect(html).toContain('Book now button')
  })

  it('hides the preset once a Book now button exists, and explains the button', () => {
    const html = render([bookNow()])
    expect(html).not.toContain('data-testid="booking-template-preset"')
    expect(html).toContain('data-testid="booking-template-book-now-hint"')
  })

  it('lists Book now link as a button type', () => {
    expect(render([{ type: 'URL', text: '', url: '', phoneNumber: '' }])).toContain('value="BOOK_NOW_URL"')
  })
})
