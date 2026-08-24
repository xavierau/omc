import { describe, it, expect } from 'vitest'
import { buildWhatsAppTemplate } from '@/test-utils/builders'
import {
  enforceHeaderMedia,
  TemplateHeaderMediaMissingError,
} from '../enforce-header-media'

// #127 / CAMP-007: a template that declares an IMAGE/VIDEO/DOCUMENT header
// needs a send-time header parameter with a public media URL. When the stored
// row has no usable URL (only an expired `4:` upload handle, or nothing), the
// send is guaranteed to be rejected by Meta with #132012 — so the campaign
// must fail fast with a tenant-meaningful reason instead of burning the run.
describe('enforceHeaderMedia', () => {
  it('allows a null template (inline text campaigns)', () => {
    expect(() => enforceHeaderMedia(null)).not.toThrow()
  })

  it('allows a template with no header component', () => {
    const template = buildWhatsAppTemplate({
      components: [{ type: 'BODY', text: 'Hello!' }],
    })
    expect(() => enforceHeaderMedia(template)).not.toThrow()
  })

  it('allows a text header', () => {
    const template = buildWhatsAppTemplate({
      components: [
        { type: 'HEADER', format: 'TEXT', text: 'Big News' },
        { type: 'BODY', text: 'Hello!' },
      ],
    })
    expect(() => enforceHeaderMedia(template)).not.toThrow()
  })

  it('allows a media header whose stored handle is an https URL', () => {
    const template = buildWhatsAppTemplate({
      components: [
        {
          type: 'HEADER',
          format: 'IMAGE',
          example: { header_handle: ['https://cdn.example.com/pic.jpg'] },
        },
        { type: 'BODY', text: 'Hello!' },
      ],
    })
    expect(() => enforceHeaderMedia(template)).not.toThrow()
  })

  it('throws when the media header only holds a Meta 4: upload handle', () => {
    const template = buildWhatsAppTemplate({
      name: 'fifth_anniversary',
      components: [
        {
          type: 'HEADER',
          format: 'IMAGE',
          example: { header_handle: ['4:aBcDeF=='] },
        },
        { type: 'BODY', text: 'Hello!' },
      ],
    })
    expect(() => enforceHeaderMedia(template)).toThrow(
      TemplateHeaderMediaMissingError
    )
    expect(() => enforceHeaderMedia(template)).toThrow('fifth_anniversary')
  })

  it('throws when the media header has no stored handle at all', () => {
    const template = buildWhatsAppTemplate({
      components: [
        { type: 'HEADER', format: 'IMAGE' },
        { type: 'BODY', text: 'Hello!' },
      ],
    })
    expect(() => enforceHeaderMedia(template)).toThrow(
      TemplateHeaderMediaMissingError
    )
  })

  it('throws for a VIDEO header without a URL', () => {
    const template = buildWhatsAppTemplate({
      components: [
        { type: 'HEADER', format: 'VIDEO', example: { header_handle: [] } },
        { type: 'BODY', text: 'Hello!' },
      ],
    })
    expect(() => enforceHeaderMedia(template)).toThrow(
      TemplateHeaderMediaMissingError
    )
  })

  it('reads the camelCase headerHandle key too', () => {
    const template = buildWhatsAppTemplate({
      components: [
        {
          type: 'HEADER',
          format: 'IMAGE',
          example: { headerHandle: ['https://cdn.example.com/pic.jpg'] },
        },
        { type: 'BODY', text: 'Hello!' },
      ],
    })
    expect(() => enforceHeaderMedia(template)).not.toThrow()
  })
})
