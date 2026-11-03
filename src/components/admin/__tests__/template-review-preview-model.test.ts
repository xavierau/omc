import { describe, it, expect } from 'vitest'
import {
  buildTemplatePreview,
  safeHttpsUrl,
} from '@/components/admin/template-review-preview-model'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'

const IMG = 'https://x.supabase.co/storage/v1/object/public/wa-template-media/r/1.jpg'

describe('safeHttpsUrl', () => {
  it.each([
    [IMG, IMG],
    ['http://x.supabase.co/a.jpg', null],
    ['javascript:alert(1)', null],
    ['4::aW1hZ2U=', null],
    ['', null],
    [undefined, null],
  ])('%s -> %s', (input, expected) => {
    expect(safeHttpsUrl(input)).toBe(expected)
  })
})

describe('buildTemplatePreview', () => {
  it('reads an image header from either handle key, plus body, footer and buttons', () => {
    const components: TemplateComponent[] = [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: [IMG] } },
      { type: 'BODY', text: 'Line 1\nLine 2' },
      { type: 'FOOTER', text: 'T&C apply' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'URL', text: 'Book', url: 'https://bicho.hk/book' },
          { type: 'PHONE_NUMBER', text: 'Call', phoneNumber: '+85291234567' },
          { type: 'QUICK_REPLY', text: 'Thanks' },
          { type: 'COPY_CODE', text: 'Copy', example: 'NOV20' },
        ],
      },
    ]
    expect(buildTemplatePreview(components)).toEqual({
      header: { kind: 'image', url: IMG },
      body: 'Line 1\nLine 2',
      footer: 'T&C apply',
      buttons: [
        { type: 'URL', text: 'Book', target: 'https://bicho.hk/book' },
        { type: 'PHONE_NUMBER', text: 'Call', target: '+85291234567' },
        { type: 'QUICK_REPLY', text: 'Thanks', target: null },
        { type: 'COPY_CODE', text: 'Copy', target: null },
      ],
    })
    expect(
      buildTemplatePreview([{ type: 'HEADER', format: 'IMAGE', example: { headerHandle: [IMG] } }]).header
    ).toEqual({ kind: 'image', url: IMG })
  })

  it('renders a video header as video and a text header as text', () => {
    expect(
      buildTemplatePreview([{ type: 'HEADER', format: 'VIDEO', example: { headerHandle: [IMG] } }]).header
    ).toEqual({ kind: 'video', url: IMG })
    expect(
      buildTemplatePreview([{ type: 'HEADER', format: 'TEXT', text: 'Hi {{name}}' }]).header
    ).toEqual({ kind: 'text', text: 'Hi {{name}}' })
  })

  it('never passes a non-https media handle through', () => {
    const header = buildTemplatePreview([
      { type: 'HEADER', format: 'IMAGE', example: { headerHandle: ['4::minted-handle'] } },
    ]).header
    expect(header).toEqual({ kind: 'media-unavailable' })
  })

  it('returns empty parts for a template without components', () => {
    expect(buildTemplatePreview([])).toEqual({ header: null, body: null, footer: null, buttons: [] })
  })
})
