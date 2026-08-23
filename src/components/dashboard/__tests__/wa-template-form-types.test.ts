import { describe, it, expect } from 'vitest'
import {
  applyTemplateButtonChange,
  buildWaTemplateRequestBody,
  createTemplateButton,
  initialWaTemplateForm,
  validateWaTemplateButtons,
} from '@/components/dashboard/wa-template-form-types'
import type { TemplateButton, WaTemplateFormState } from '@/components/dashboard/wa-template-form-types'

const PHONE = '+85296283521'

function button(overrides: Partial<TemplateButton> = {}): TemplateButton {
  return { ...createTemplateButton(), ...overrides }
}

function formWith(buttons: TemplateButton[]): WaTemplateFormState {
  return { ...initialWaTemplateForm, name: 'testing_template', body: 'Hello', buttons }
}

function wireButtons(form: WaTemplateFormState): Record<string, unknown>[] {
  // Round-tripping through JSON is the point: an `undefined` value drops the
  // whole key on the way to the API, which is how #97 reached Meta.
  const body = JSON.parse(JSON.stringify(buildWaTemplateRequestBody(form)))
  const buttons = (body.components as Record<string, unknown>[]).find((c) => c.type === 'BUTTONS')
  return (buttons?.buttons ?? []) as Record<string, unknown>[]
}

describe('createTemplateButton', () => {
  it('seeds every field so a later type switch has somewhere to write', () => {
    expect(createTemplateButton()).toEqual({ type: 'URL', text: '', url: '', phoneNumber: '' })
  })
})

describe('applyTemplateButtonChange', () => {
  it('writes a single field without touching the others', () => {
    const next = applyTemplateButtonChange(button({ text: 'Call us', url: 'https://a.test' }), 'text', 'Order now')

    expect(next).toEqual({ type: 'URL', text: 'Order now', url: 'https://a.test', phoneNumber: '' })
  })

  it('keeps the label when the type changes', () => {
    const next = applyTemplateButtonChange(button({ text: 'Call us' }), 'type', 'PHONE_NUMBER')

    expect(next.text).toBe('Call us')
  })

  it('clears the stale url when switching to a phone button', () => {
    const next = applyTemplateButtonChange(button({ url: 'https://a.test' }), 'type', 'PHONE_NUMBER')

    expect(next).toEqual({ type: 'PHONE_NUMBER', text: '', url: '', phoneNumber: '' })
  })

  it('clears the stale phone number when switching to a url button', () => {
    const next = applyTemplateButtonChange(
      button({ type: 'PHONE_NUMBER', phoneNumber: PHONE }),
      'type',
      'URL'
    )

    expect(next).toEqual({ type: 'URL', text: '', url: '', phoneNumber: '' })
  })

  it('clears both type-specific fields when switching to a coupon button', () => {
    const next = applyTemplateButtonChange(
      button({ url: 'https://a.test', phoneNumber: PHONE }),
      'type',
      'COUPON_URL'
    )

    expect(next).toEqual({ type: 'COUPON_URL', text: '', url: '', phoneNumber: '' })
  })
})

describe('validateWaTemplateButtons', () => {
  it('accepts a form with no buttons', () => {
    expect(validateWaTemplateButtons([])).toBeNull()
  })

  it('blocks a phone button with no number', () => {
    const message = validateWaTemplateButtons([
      button({ type: 'PHONE_NUMBER', text: 'Call us' }),
    ])

    expect(message).toBeTruthy()
    expect(message?.toLowerCase()).toContain('phone number')
  })

  it('blocks a phone button whose number is only whitespace', () => {
    const message = validateWaTemplateButtons([
      button({ type: 'PHONE_NUMBER', text: 'Call us', phoneNumber: '   ' }),
    ])

    expect(message).toBeTruthy()
  })

  it('blocks a url button with no url', () => {
    const message = validateWaTemplateButtons([button({ text: 'Order now' })])

    expect(message).toBeTruthy()
    expect(message?.toLowerCase()).toContain('link')
  })

  it('blocks a button with no label', () => {
    const message = validateWaTemplateButtons([button({ url: 'https://a.test' })])

    expect(message).toBeTruthy()
    expect(message?.toLowerCase()).toContain('label')
  })

  it('names the button that is wrong', () => {
    const message = validateWaTemplateButtons([
      button({ text: 'Order now', url: 'https://a.test' }),
      button({ type: 'PHONE_NUMBER', text: 'Call us' }),
    ])

    expect(message).toContain('Button 2')
  })

  it('accepts a coupon button, which needs only a label', () => {
    expect(validateWaTemplateButtons([button({ type: 'COUPON_URL', text: 'My coupon' })])).toBeNull()
  })

  it('accepts fully filled url and phone buttons', () => {
    const message = validateWaTemplateButtons([
      button({ text: 'Order now', url: 'https://a.test' }),
      button({ type: 'PHONE_NUMBER', text: 'Call us', phoneNumber: PHONE }),
    ])

    expect(message).toBeNull()
  })
})

describe('buildWaTemplateRequestBody', () => {
  it('sends the phone number of a phone button (#97)', () => {
    const buttons = wireButtons(
      formWith([button({ type: 'PHONE_NUMBER', text: 'Call us', phoneNumber: PHONE })])
    )

    expect(buttons[0]).toEqual({ type: 'PHONE_NUMBER', text: 'Call us', phoneNumber: PHONE })
  })

  it('keeps the phoneNumber key even when the value is empty, so the backstop can see it', () => {
    const buttons = wireButtons(formWith([button({ type: 'PHONE_NUMBER', text: 'Call us' })]))

    expect(buttons[0]).toHaveProperty('phoneNumber', '')
  })

  it('sends no phoneNumber on a url button', () => {
    const buttons = wireButtons(formWith([button({ text: 'Order now', url: 'https://a.test' })]))

    expect(buttons[0]).toEqual({ type: 'URL', text: 'Order now', url: 'https://a.test' })
  })
})
