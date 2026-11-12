import { describe, it, expect } from 'vitest'
import {
  DEFAULT_BOOKING_CONFIG,
  isSafeHttpsUrl,
  parseBookingSettings,
  resolveBookingConfig,
  type BookingConfig,
} from '../booking-config'

describe('resolveBookingConfig', () => {
  it('defaults a missing or malformed blob to mode off (AC-3)', () => {
    expect(resolveBookingConfig(undefined)).toEqual(DEFAULT_BOOKING_CONFIG)
    expect(resolveBookingConfig({ mode: 'off' })).toEqual(DEFAULT_BOOKING_CONFIG)
    expect(resolveBookingConfig({ mode: 'party', maxPartySize: -1, externalUrl: 'http://x' }).mode).toBe('off')
  })

  it('keeps null lifetimes (no expiry) and valid values', () => {
    const config = resolveBookingConfig({
      mode: 'simple',
      chatLinkTtlHours: null,
      campaignLinkTtlHours: 48,
      maxPartySize: 8,
      aiRoutingEnabled: true,
      templateIds: { confirmed: 'tpl-1', declined: 7 },
    })
    expect(config).toMatchObject({
      mode: 'simple',
      chatLinkTtlHours: null,
      campaignLinkTtlHours: 48,
      maxPartySize: 8,
      aiRoutingEnabled: true,
      templateIds: { received: null, confirmed: 'tpl-1', declined: null, reminder: null },
    })
  })
})

describe('isSafeHttpsUrl (R14)', () => {
  it.each(['https://inline.app/booking/abc', 'https://example.com'])('accepts %s', (url) => {
    expect(isSafeHttpsUrl(url)).toBe(true)
  })

  it.each([
    'javascript:alert(1)',
    'http://inline.app/x',
    'data:text/html,<script>alert(1)</script>',
    'not a url',
    'https://',
    'https://user:pw@example.com',
    `https://example.com/${'a'.repeat(2040)}`,
    'https://exa mple.com',
  ])('rejects %s', (url) => {
    expect(isSafeHttpsUrl(url)).toBe(false)
  })
})

describe('parseBookingSettings (R14 / AC-1 / AC-2)', () => {
  const current: BookingConfig = {
    ...DEFAULT_BOOKING_CONFIG,
    aiRoutingEnabled: true,
    templateIds: { received: 'r', confirmed: 'c', declined: 'd', reminder: 'm' },
  }

  it('saves simple mode with lifetimes as positive ints or null', () => {
    const result = parseBookingSettings(
      { mode: 'simple', chatLinkTtlHours: null, campaignLinkTtlHours: 72, maxPartySize: 12 },
      current
    )
    expect(result).toEqual({
      ok: true,
      config: { ...current, mode: 'simple', externalUrl: null, chatLinkTtlHours: null, campaignLinkTtlHours: 72, maxPartySize: 12 },
    })
  })

  it('keeps aiRoutingEnabled and templateIds from the current config (not owned by the form)', () => {
    const result = parseBookingSettings({ mode: 'off' }, current)
    expect(result.ok && result.config.aiRoutingEnabled).toBe(true)
    expect(result.ok && result.config.templateIds).toEqual(current.templateIds)
    expect(parseBookingSettings({ mode: 'off', aiRoutingEnabled: true }, current)).toEqual({
      ok: false,
      errors: { form: 'unknown_field:aiRoutingEnabled' },
    })
  })

  it('saves external mode with a trimmed https URL', () => {
    const result = parseBookingSettings({ mode: 'external', externalUrl: '  https://inline.app/r/1 ' }, current)
    expect(result.ok && result.config.externalUrl).toBe('https://inline.app/r/1')
  })

  it.each(['javascript:alert(1)', 'http://inline.app/r', 'data:text/html,x', 'https//broken'])(
    'rejects external URL %s',
    (externalUrl) => {
      expect(parseBookingSettings({ mode: 'external', externalUrl }, current)).toEqual({
        ok: false,
        errors: { externalUrl: 'invalid_https_url' },
      })
    }
  )

  it('requires a URL in external mode', () => {
    expect(parseBookingSettings({ mode: 'external', externalUrl: '' }, current)).toEqual({
      ok: false,
      errors: { externalUrl: 'required' },
    })
  })

  it.each([0, -1, 1.5, '24', 9000])('rejects lifetime %j', (ttl) => {
    const result = parseBookingSettings({ mode: 'simple', chatLinkTtlHours: ttl }, current)
    expect(result).toEqual({ ok: false, errors: { chatLinkTtlHours: 'invalid_ttl' } })
  })

  it('rejects an unknown mode and a bad party maximum', () => {
    expect(parseBookingSettings({ mode: 'all', maxPartySize: 0 }, current)).toEqual({
      ok: false,
      errors: { mode: 'invalid_mode', maxPartySize: 'invalid_party_size' },
    })
  })
})
