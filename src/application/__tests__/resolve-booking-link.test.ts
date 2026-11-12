import { describe, it, expect, beforeEach } from 'vitest'
import { resolveBookingLink, type ResolveBookingLinkDeps } from '../booking/resolve-booking-link'
import { FakeBookingSettings, FakeBookingTokens } from '@/test-utils/fake-booking'

const A = 'rest-a'
const PHONE = '+85291234567'
const TOKEN = 'A'.repeat(43)
const NOW = new Date('2026-11-12T02:00:00.000Z')

let tokens: FakeBookingTokens
let settings: FakeBookingSettings
let deps: ResolveBookingLinkDeps

beforeEach(() => {
  tokens = new FakeBookingTokens()
  tokens.add({ token: TOKEN, restaurantId: A, phone: PHONE, source: 'campaign', campaignId: 'camp-1' })
  settings = new FakeBookingSettings()
  settings.restaurants.set(A, { name: 'Kushiro', logoUrl: 'https://cdn/logo.png', whatsappNumber: '+85220000001' })
  settings.setConfig(A, { mode: 'simple', maxPartySize: 12 })
  deps = { tokens, settings, now: () => NOW }
})

describe('resolveBookingLink', () => {
  it('simple mode shows the form with the masked phone, the restaurant max and HK today', async () => {
    expect(await resolveBookingLink(deps, TOKEN)).toEqual({
      kind: 'form',
      restaurant: { name: 'Kushiro', logoUrl: 'https://cdn/logo.png' },
      maskedPhone: '•••• 4567',
      maxPartySize: 12,
      today: '2026-11-12',
      retryUrl: 'https://wa.me/85220000001?text=BOOK',
    })
  })

  it('does not consume the token', async () => {
    await resolveBookingLink(deps, TOKEN)
    expect(tokens.rows[0].consumedAt).toBeNull()
  })

  it("external mode redirects to the token campaign's stored URL first", async () => {
    settings.setConfig(A, { mode: 'external', externalUrl: 'https://inline.app/default' })
    settings.campaignUrls.set('camp-1', { restaurantId: A, url: 'https://inline.app/campaign' })
    expect(await resolveBookingLink(deps, TOKEN)).toEqual({ kind: 'redirect', url: 'https://inline.app/campaign' })
  })

  it("external mode falls back to the restaurant default; another tenant's campaign URL is never used (R15)", async () => {
    settings.setConfig(A, { mode: 'external', externalUrl: 'https://inline.app/default' })
    settings.campaignUrls.set('camp-1', { restaurantId: 'rest-b', url: 'https://evil.example/phish' })
    expect(await resolveBookingLink(deps, TOKEN)).toEqual({ kind: 'redirect', url: 'https://inline.app/default' })
  })

  it('AC-3: off mode shows the unavailable page with a wa.me BOOK link and no form', async () => {
    settings.setConfig(A, { mode: 'off' })
    expect(await resolveBookingLink(deps, TOKEN)).toEqual({
      kind: 'unavailable',
      reason: 'off',
      restaurant: { name: 'Kushiro', logoUrl: 'https://cdn/logo.png' },
      retryUrl: 'https://wa.me/85220000001?text=BOOK',
    })
  })

  it('external mode with no URL anywhere is unavailable', async () => {
    settings.setConfig(A, { mode: 'external', externalUrl: null })
    expect((await resolveBookingLink(deps, TOKEN)).kind).toBe('unavailable')
  })

  it.each([
    ['expired', { expiresAt: '2026-11-12T01:00:00.000Z' }],
    ['consumed', { consumedAt: '2026-11-12T01:00:00.000Z' }],
  ])('AC-12: %s token shows the unavailable page with the BOOK deep link', async (state, patch) => {
    Object.assign(tokens.rows[0], patch)
    expect(await resolveBookingLink(deps, TOKEN)).toMatchObject({
      kind: 'unavailable',
      reason: state,
      retryUrl: 'https://wa.me/85220000001?text=BOOK',
    })
  })

  it('AC-12: unknown token reveals no restaurant', async () => {
    expect(await resolveBookingLink(deps, 'Z'.repeat(43))).toEqual({
      kind: 'unavailable', reason: 'unknown', restaurant: null, retryUrl: null,
    })
  })
})
