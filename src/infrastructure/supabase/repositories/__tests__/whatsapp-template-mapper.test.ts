import { describe, it, expect } from 'vitest'
import {
  mapRowToTemplate,
  mapTemplateToInsert,
  type WhatsAppTemplateRow,
} from '../whatsapp-template-mapper'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'

function buildRow(overrides: Partial<WhatsAppTemplateRow> = {}): WhatsAppTemplateRow {
  return {
    id: 'tpl-1',
    restaurant_id: 'rest-1',
    meta_template_id: 'meta-1',
    name: 'order_confirmation',
    language: 'en',
    category: 'UTILITY',
    status: 'approved',
    components: [{ type: 'BODY', text: 'Hello {{name}}' }],
    parameter_format: 'NAMED',
    rejection_reason: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-02T00:00:00Z',
    ...overrides,
  }
}

describe('mapRowToTemplate', () => {
  it('maps all fields from DB row to domain entity', () => {
    const row = buildRow()
    const result = mapRowToTemplate(row)

    expect(result).toEqual({
      id: 'tpl-1',
      restaurantId: 'rest-1',
      metaTemplateId: 'meta-1',
      name: 'order_confirmation',
      language: 'en',
      category: 'UTILITY',
      status: 'approved',
      components: [{ type: 'BODY', text: 'Hello {{name}}' }],
      parameterFormat: 'NAMED',
      rejectionReason: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
    })
  })

  it('handles null meta_template_id', () => {
    const row = buildRow({ meta_template_id: null })
    expect(mapRowToTemplate(row).metaTemplateId).toBeNull()
  })

  it('handles rejection_reason', () => {
    const row = buildRow({ rejection_reason: 'bad content' })
    expect(mapRowToTemplate(row).rejectionReason).toBe('bad content')
  })
})

describe('mapTemplateToInsert', () => {
  it('maps create params to DB insert object', () => {
    const components: TemplateComponent[] = [
      { type: 'BODY', text: 'Hi {{name}}' },
    ]
    const result = mapTemplateToInsert({
      restaurantId: 'rest-1',
      name: 'welcome_msg',
      language: 'en',
      category: 'MARKETING',
      components,
    })

    expect(result).toEqual({
      restaurant_id: 'rest-1',
      name: 'welcome_msg',
      language: 'en',
      category: 'MARKETING',
      status: 'draft',
      components,
      parameter_format: 'NAMED',
    })
  })
})
