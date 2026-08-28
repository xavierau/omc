import { describe, it, expect } from 'vitest'
import { isClaimTemplate } from '../campaign-mode'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

function template(
  buttons?: WhatsAppTemplate['components'][number]['buttons']
): WhatsAppTemplate {
  return {
    id: 'tpl-1',
    restaurantId: 'r-1',
    metaTemplateId: null,
    name: 'promo',
    language: 'en',
    category: 'MARKETING',
    status: 'approved',
    components: buttons
      ? [{ type: 'BODY', text: 'Hi' }, { type: 'BUTTONS', buttons }]
      : [{ type: 'BODY', text: 'Hi' }],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  }
}

describe('isClaimTemplate', () => {
  it('is claim mode when any button is a QUICK_REPLY', () => {
    expect(
      isClaimTemplate(template([{ type: 'URL', text: 'Go', url: 'https://x' }, { type: 'QUICK_REPLY', text: 'Claim' }]))
    ).toBe(true)
  })

  it('is eager mode without a QUICK_REPLY button, without buttons, or without a template', () => {
    expect(isClaimTemplate(template([{ type: 'URL', text: 'Go', url: 'https://x' }]))).toBe(false)
    expect(isClaimTemplate(template())).toBe(false)
    expect(isClaimTemplate(null)).toBe(false)
  })
})
