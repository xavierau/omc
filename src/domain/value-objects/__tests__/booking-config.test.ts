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
      // W3: ids are per kind per language; a non-string or a W1-era flat
      // string resolves to null (re-provisioned on the next save).
      templateIds: { confirmed: { en: 'tpl-1', zh_hk: 7 }, declined: 'legacy-flat-id' },
    })
    expect(config).toMatchObject({
      mode: 'simple',
      chatLinkTtlHours: null,
      campaignLinkTtlHours: 48,
      maxPartySize: 8,
      aiRoutingEnabled: true,
      templateIds: {
        received: { en: null, zh_hk: null },
        confirmed: { en: 'tpl-1', zh_hk: null },
        declined: { en: null, zh_hk: null },
        reminder: { en: null, zh_hk: null },
      },
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
    templateIds: {
      received: { en: 'r-en', zh_hk: 'r-zh' },
      confirmed: { en: 'c-en', zh_hk: 'c-zh' },
      declined: { en: 'd-en', zh_hk: 'd-zh' },
      reminder: { en: 'm-en', zh_hk: 'm-zh' },
    },
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

// BOOK-002: custom message text and pending edits live in booking_config,
// written only by the message editor and the sender, never by the settings PUT.
describe('templateBodies and templateCandidates (BOOK-002)', () => {
  it('resolves strings per kind × language and drops anything else', () => {
    const config = resolveBookingConfig({
      mode: 'simple',
      templateBodies: { confirmed: { en: 'Custom {{date}} {{time}} ok.', zh_hk: 7 }, declined: 'flat', bogus: { en: 'x' } },
      templateCandidates: { confirmed: { en: 'tpl-new', zh_hk: '' } },
    })
    expect(config.templateBodies).toEqual({ received: {}, confirmed: { en: 'Custom {{date}} {{time}} ok.' }, declined: {}, reminder: {} })
    expect(config.templateCandidates).toEqual({ received: {}, confirmed: { en: 'tpl-new' }, declined: {}, reminder: {} })
  })

  it('a resolved default is a fresh copy (writing one never changes the default)', () => {
    const config = resolveBookingConfig(undefined)
    config.templateBodies.confirmed.en = 'x'
    expect(DEFAULT_BOOKING_CONFIG.templateBodies.confirmed).toEqual({})
  })

  it.each(['templateBodies', 'templateCandidates'])('the settings PUT refuses %s and keeps the stored value', (field) => {
    const current = resolveBookingConfig({ mode: 'simple', templateBodies: { confirmed: { en: 'Keep {{date}} {{time}} ok.' } } })
    expect(parseBookingSettings({ mode: 'simple', [field]: {} }, current)).toEqual({ ok: false, errors: { form: `unknown_field:${field}` } })
    const saved = parseBookingSettings({ mode: 'simple' }, current)
    expect(saved.ok && saved.config.templateBodies).toEqual(current.templateBodies)
  })
})
