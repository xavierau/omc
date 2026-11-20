import { describe, it, expect } from 'vitest'
import type { TemplateComponent } from '@/domain/entities/whatsapp-template'
import {
  isMediaHeader,
  readHeaderLink,
} from '../template-media-header'

// #127 / CAMP-007: readHeaderLink is the single owner of "what counts as a
// send-time header URL" for both the fail-fast gate and the header param
// builder. These pin the predicate directly, so a later tightening (e.g.
// https-only) shows up as an explicit test change, not a silent behavior
// shift behind green suites.
function imageHeader(example?: TemplateComponent['example']): TemplateComponent {
  return { type: 'HEADER', format: 'IMAGE', example }
}

describe('isMediaHeader', () => {
  it('matches IMAGE/VIDEO/DOCUMENT headers only', () => {
    expect(isMediaHeader(imageHeader())).toBe(true)
    expect(isMediaHeader({ type: 'HEADER', format: 'VIDEO' })).toBe(true)
    expect(isMediaHeader({ type: 'HEADER', format: 'DOCUMENT' })).toBe(true)
    expect(isMediaHeader({ type: 'HEADER', format: 'TEXT', text: 'Hi' })).toBe(false)
    expect(isMediaHeader({ type: 'BODY', text: 'Hello' })).toBe(false)
  })
})

describe('readHeaderLink', () => {
  it('returns an https URL', () => {
    expect(
      readHeaderLink(imageHeader({ header_handle: ['https://cdn.example.com/pic.jpg'] }))
    ).toBe('https://cdn.example.com/pic.jpg')
  })

  it('accepts a plain http:// URL (parity with the submit path predicate)', () => {
    expect(
      readHeaderLink(imageHeader({ header_handle: ['http://cdn.example.com/pic.jpg'] }))
    ).toBe('http://cdn.example.com/pic.jpg')
  })

  it('accepts an uppercase scheme', () => {
    expect(
      readHeaderLink(imageHeader({ header_handle: ['HTTPS://cdn.example.com/pic.jpg'] }))
    ).toBe('HTTPS://cdn.example.com/pic.jpg')
  })

  it('rejects a minted 4: upload handle', () => {
    expect(readHeaderLink(imageHeader({ header_handle: ['4:aBcDeF=='] }))).toBeNull()
  })

  it('returns null for an empty handle list', () => {
    expect(readHeaderLink(imageHeader({ header_handle: [] }))).toBeNull()
  })

  it('returns null when example is missing entirely', () => {
    expect(readHeaderLink(imageHeader())).toBeNull()
  })

  it('reads the camelCase headerHandle key', () => {
    expect(
      readHeaderLink(imageHeader({ headerHandle: ['https://cdn.example.com/pic.jpg'] }))
    ).toBe('https://cdn.example.com/pic.jpg')
  })

  it('reads ONLY the first handle entry', () => {
    expect(
      readHeaderLink(
        imageHeader({ header_handle: ['4:abc', 'https://cdn.example.com/pic.jpg'] })
      )
    ).toBeNull()
  })
})
