import { describe, it, expect } from 'vitest'
import {
  isTemplateSendable,
  extractParameters,
  validateTemplateName,
  type WhatsAppTemplate,
  type TemplateStatus,
} from '../whatsapp-template'

function buildTemplate(
  overrides: Partial<WhatsAppTemplate> = {}
): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'rest-1',
    metaTemplateId: null,
    name: 'welcome_message',
    language: 'en',
    category: 'MARKETING',
    status: 'draft',
    components: [],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('isTemplateSendable', () => {
  it('returns true when status is approved', () => {
    const t = buildTemplate({ status: 'approved' })
    expect(isTemplateSendable(t)).toBe(true)
  })

  const nonSendable: TemplateStatus[] = [
    'draft', 'pending', 'rejected', 'paused', 'disabled', 'deleted',
  ]
  it.each(nonSendable)('returns false when status is %s', (status) => {
    const t = buildTemplate({ status })
    expect(isTemplateSendable(t)).toBe(false)
  })
})

describe('extractParameters', () => {
  it('extracts params from body text', () => {
    const t = buildTemplate({
      components: [
        { type: 'BODY', text: 'Hello {{name}}, your code is {{code}}' },
      ],
    })
    expect(extractParameters(t)).toEqual(['name', 'code'])
  })

  it('extracts params from header text', () => {
    const t = buildTemplate({
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Welcome {{name}}' },
      ],
    })
    expect(extractParameters(t)).toEqual(['name'])
  })

  it('deduplicates params across components', () => {
    const t = buildTemplate({
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Hi {{name}}' },
        { type: 'BODY', text: '{{name}}, use {{code}}' },
      ],
    })
    expect(extractParameters(t)).toEqual(['name', 'code'])
  })

  it('returns empty array when no params', () => {
    const t = buildTemplate({
      components: [{ type: 'BODY', text: 'No params here' }],
    })
    expect(extractParameters(t)).toEqual([])
  })

  it('returns empty array when no text components', () => {
    const t = buildTemplate({
      components: [{ type: 'HEADER', format: 'IMAGE' }],
    })
    expect(extractParameters(t)).toEqual([])
  })

  it('extracts params from footer text', () => {
    const t = buildTemplate({
      components: [
        { type: 'FOOTER', text: 'Reply {{keyword}} to opt out' },
      ],
    })
    expect(extractParameters(t)).toEqual(['keyword'])
  })
})

describe('validateTemplateName', () => {
  it('accepts lowercase alphanumeric with underscores', () => {
    expect(validateTemplateName('welcome_message_v2')).toBe(true)
  })

  it('rejects uppercase letters', () => {
    expect(validateTemplateName('Welcome')).toBe(false)
  })

  it('rejects spaces', () => {
    expect(validateTemplateName('welcome message')).toBe(false)
  })

  it('rejects hyphens', () => {
    expect(validateTemplateName('welcome-message')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(validateTemplateName('')).toBe(false)
  })

  it('accepts single character', () => {
    expect(validateTemplateName('a')).toBe(true)
  })

  it('rejects names longer than 512 chars', () => {
    expect(validateTemplateName('a'.repeat(513))).toBe(false)
  })

  it('accepts exactly 512 chars', () => {
    expect(validateTemplateName('a'.repeat(512))).toBe(true)
  })
})
