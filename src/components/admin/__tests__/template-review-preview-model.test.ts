import { describe, it, expect } from 'vitest'
import {
  buildTemplatePreview,
  isAllowedMediaUrl,
  safeHttpsUrl,
} from '@/components/admin/template-review-preview-model'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'

const SUPABASE = 'https://x.supabase.co'
const IMG = 'https://x.supabase.co/storage/v1/object/public/wa-template-media/r/1.jpg'
const header = (format: 'IMAGE' | 'VIDEO', url: string) =>
  buildTemplatePreview([{ type: 'HEADER', format, example: { headerHandle: [url] } }], SUPABASE).header

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
    expect(buildTemplatePreview(components, SUPABASE)).toEqual({
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
      buildTemplatePreview([{ type: 'HEADER', format: 'IMAGE', example: { headerHandle: [IMG] } }], SUPABASE).header
    ).toEqual({ kind: 'image', url: IMG })
  })

  it('renders a video header as video and a text header as text', () => {
    expect(header('VIDEO', IMG)).toEqual({ kind: 'video', url: IMG })
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

  it.each([
    ['IMAGE', 'https://attacker.example/pixel.gif'],
    ['VIDEO', 'https://attacker.example/v.mp4'],
    ['IMAGE', 'https://x.supabase.co.attacker.example/a.jpg'],
    ['IMAGE', 'https://y.supabase.co/a.jpg'],
    ['IMAGE', 'https://scontent.whatsapp.net.attacker.example/a.jpg'],
    ['IMAGE', 'https://placehold.co/600x300'],
  ] as const)('a %s header on a non-allowlisted host (%s) renders as external text, never loaded', (format, url) => {
    expect(header(format, url)).toEqual({ kind: 'external', url })
  })

  it.each([
    ['IMAGE', IMG],
    ['IMAGE', 'https://scontent.whatsapp.net/v/t61/a.jpg'],
    ['VIDEO', 'https://scontent-hkg4-1.whatsapp.net/v/t61/a.mp4'],
    ['IMAGE', 'https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1'],
  ] as const)('a %s header on an allowlisted host (%s) renders as media', (format, url) => {
    expect(header(format, url)).toEqual({ kind: format === 'VIDEO' ? 'video' : 'image', url })
  })

  it('links a DOCUMENT header only on an allowlisted host; off-list is external text', () => {
    const doc = (url: string) =>
      buildTemplatePreview([{ type: 'HEADER', format: 'DOCUMENT', example: { headerHandle: [url] } }], SUPABASE).header
    const pdf = 'https://x.supabase.co/storage/v1/object/public/wa-template-media/r/menu.pdf'
    expect(doc(pdf)).toEqual({ kind: 'document', url: pdf })
    expect(doc('https://attacker.example/menu.pdf')).toEqual({ kind: 'external', url: 'https://attacker.example/menu.pdf' })
    expect(doc('4::minted')).toEqual({ kind: 'document', url: null })
  })

  it('admits no media host from storage when NEXT_PUBLIC_SUPABASE_URL is unset', () => {
    expect(
      buildTemplatePreview([{ type: 'HEADER', format: 'IMAGE', example: { headerHandle: [IMG] } }], undefined).header
    ).toEqual({ kind: 'external', url: IMG })
  })

  it('returns empty parts for a template without components', () => {
    expect(buildTemplatePreview([])).toEqual({ header: null, body: null, footer: null, buttons: [] })
  })
})

describe('isAllowedMediaUrl', () => {
  it.each([
    [IMG, true],
    ['https://scontent.whatsapp.net/a.jpg', true],
    ['https://scontent-sin6-1.whatsapp.net/a.jpg', true],
    ['https://lookaside.fbsbx.com/a', true],
    ['http://x.supabase.co/a.jpg', false],
    ['https://x.supabase.co:8443/a.jpg', false],
    ['https://evil-scontent.whatsapp.net/a.jpg', false],
    ['https://mmg.whatsapp.net/a.jpg', false],
    ['https://lookaside.fbsbx.com.evil.example/a', false],
    ['not a url', false],
  ])('%s -> %s', (url, expected) => {
    expect(isAllowedMediaUrl(url, SUPABASE)).toBe(expected)
  })
})
