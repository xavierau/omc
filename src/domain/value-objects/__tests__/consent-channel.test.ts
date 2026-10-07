import { describe, it, expect } from 'vitest'
import {
  CONSENT_CHANNELS,
  isConsentChannel,
  type ConsentChannel,
} from '../consent-channel'

describe('isConsentChannel', () => {
  it('accepts the four canonical channels', () => {
    expect(isConsentChannel('whatsapp')).toBe(true)
    expect(isConsentChannel('generic')).toBe(true)
    expect(isConsentChannel('service_only')).toBe(true)
    expect(isConsentChannel('none')).toBe(true)
  })

  it('rejects unknown / case-mismatched / non-string values', () => {
    expect(isConsentChannel('WhatsApp')).toBe(false)
    expect(isConsentChannel('email')).toBe(false)
    expect(isConsentChannel('')).toBe(false)
    expect(isConsentChannel(null)).toBe(false)
    expect(isConsentChannel(undefined)).toBe(false)
    expect(isConsentChannel(0)).toBe(false)
  })

  it('exposes a frozen ordered list of channels', () => {
    expect(CONSENT_CHANNELS).toEqual([
      'whatsapp',
      'generic',
      'service_only',
      'none',
    ])
    expect(Object.isFrozen(CONSENT_CHANNELS)).toBe(true)
  })

  it('typing: each canonical channel is assignable to ConsentChannel', () => {
    const w: ConsentChannel = 'whatsapp'
    const s: ConsentChannel = 'service_only'
    expect([w, s]).toEqual(['whatsapp', 'service_only'])
  })
})
