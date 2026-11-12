// BOOK-001 W2-01 (spec AC-5, R11): where a Book now reply points.
import { describe, it, expect } from 'vitest'
import { resolveBookingReplyTarget } from '../resolve-booking-reply-target'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import { FakeChatTokens } from '@/test-utils/fake-intent-classifier'

const R = 'rest-a'
const PHONE = '+85291234567'
const APP = 'https://app.example.com'
const config = (over: Partial<BookingConfig>): BookingConfig => ({ ...DEFAULT_BOOKING_CONFIG, ...over })

describe('resolveBookingReplyTarget', () => {
  it('simple: reuses the live chat token instead of minting another (R11)', async () => {
    const tokens = new FakeChatTokens()
    tokens.live.set(`${R}|${PHONE}`, 'livetoken')
    const target = await resolveBookingReplyTarget(
      { tokens, appUrl: APP },
      { restaurantId: R, phone: PHONE, config: config({ mode: 'simple' }) }
    )
    expect(target).toEqual({ mode: 'simple', url: `${APP}/b/livetoken` })
    expect(tokens.mints).toEqual([])
  })

  it('simple: mints a chat token with chatLinkTtlHours when none is live', async () => {
    const tokens = new FakeChatTokens()
    const target = await resolveBookingReplyTarget(
      { tokens, appUrl: `${APP}/` },
      { restaurantId: R, phone: PHONE, config: config({ mode: 'simple', chatLinkTtlHours: 48 }) }
    )
    expect(tokens.mints).toEqual([{ restaurantId: R, phone: PHONE, ttlHours: 48 }])
    expect(target?.url).toMatch(new RegExp(`^${APP}/b/tok1x+$`))
  })

  it('simple: null chatLinkTtlHours mints a no-expiry token', async () => {
    const tokens = new FakeChatTokens()
    await resolveBookingReplyTarget(
      { tokens, appUrl: APP },
      { restaurantId: R, phone: PHONE, config: config({ mode: 'simple', chatLinkTtlHours: null }) }
    )
    expect(tokens.mints[0].ttlHours).toBeNull()
  })

  it('simple: a failed mint or a missing app URL gives no target', async () => {
    const failing = new FakeChatTokens()
    failing.failMint = true
    const cfg = config({ mode: 'simple' })
    expect(await resolveBookingReplyTarget({ tokens: failing, appUrl: APP }, { restaurantId: R, phone: PHONE, config: cfg })).toBeNull()
    const tokens = new FakeChatTokens()
    expect(await resolveBookingReplyTarget({ tokens, appUrl: undefined }, { restaurantId: R, phone: PHONE, config: cfg })).toBeNull()
    expect(tokens.mints).toEqual([])
  })

  it('external: the restaurant URL, no token', async () => {
    const tokens = new FakeChatTokens()
    const target = await resolveBookingReplyTarget(
      { tokens, appUrl: APP },
      { restaurantId: R, phone: PHONE, config: config({ mode: 'external', externalUrl: 'https://inline.app/r/demo' }) }
    )
    expect(target).toEqual({ mode: 'external', url: 'https://inline.app/r/demo' })
    expect(tokens.mints).toEqual([])
  })

  it('external without a URL, and off, give no target', async () => {
    const tokens = new FakeChatTokens()
    const deps = { tokens, appUrl: APP }
    expect(await resolveBookingReplyTarget(deps, { restaurantId: R, phone: PHONE, config: config({ mode: 'external' }) })).toBeNull()
    expect(await resolveBookingReplyTarget(deps, { restaurantId: R, phone: PHONE, config: config({ mode: 'off' }) })).toBeNull()
    expect(tokens.mints).toEqual([])
  })
})
