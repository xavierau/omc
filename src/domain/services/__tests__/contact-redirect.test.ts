import { describe, it, expect } from 'vitest'
import { buildContactUrl } from '@/domain/services/contact-redirect'

describe('buildContactUrl', () => {
  it('builds a wa.me link for a valid E.164 number', () => {
    expect(buildContactUrl('+85291234567')).toBe('https://wa.me/85291234567')
  })

  it('strips the leading + and spaces/dashes', () => {
    expect(buildContactUrl('+852 9123 4567')).toBe('https://wa.me/85291234567')
    expect(buildContactUrl('852-9123-4567')).toBe('https://wa.me/85291234567')
  })

  it('accepts a number without a leading + (PhoneNumber normalizes it)', () => {
    expect(buildContactUrl('85291234567')).toBe('https://wa.me/85291234567')
  })

  it('returns null for non-numeric junk', () => {
    expect(buildContactUrl('abc')).toBeNull()
  })

  it('returns null for a too-short number', () => {
    expect(buildContactUrl('12345')).toBeNull()
  })

  it('returns null for an empty string', () => {
    expect(buildContactUrl('')).toBeNull()
  })

  it('appends url-encoded prefilled text when provided', () => {
    expect(buildContactUrl('+85291234567', 'Hi there')).toBe(
      'https://wa.me/85291234567?text=Hi%20there'
    )
  })

  it('omits the ?text= query when no prefilled text is given', () => {
    expect(buildContactUrl('+85291234567')).not.toContain('?text=')
  })
})
