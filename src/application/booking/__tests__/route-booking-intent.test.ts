// BOOK-001 W2-03, W2-06, W2-07 (spec AC-4, AC-6, AC-7; R13, R17).
import { describe, it, expect, vi } from 'vitest'
import { routeBookingIntent, type RouteBookingIntentDeps } from '../route-booking-intent'
import { DEFAULT_BOOKING_CONFIG, type BookingConfig } from '@/domain/value-objects/booking-config'
import type { ClassifyResult } from '@/domain/ports/intent-classifier'
import { FakeChatTokens, FakeClassificationStore, FakeIntentClassifier } from '@/test-utils/fake-intent-classifier'

const R = 'rest-a'
const PHONE = '+85291234567'
const TEXT = '想訂星期五7點4位'

function setup(over: Partial<BookingConfig> = {}, result?: ClassifyResult) {
  const classifier = new FakeIntentClassifier(result)
  const classifications = new FakeClassificationStore()
  const tokens = new FakeChatTokens()
  const log = vi.fn()
  const config: BookingConfig = { ...DEFAULT_BOOKING_CONFIG, mode: 'simple', aiRoutingEnabled: true, ...over }
  const deps: RouteBookingIntentDeps = {
    getConfig: vi.fn(async () => config),
    classifier,
    classifications,
    tokens,
    appUrl: 'https://app.example.com',
    log,
  }
  return { deps, classifier, classifications, tokens, log }
}

const input = (over: Partial<Parameters<typeof routeBookingIntent>[1]> = {}) => ({
  restaurantId: R, phone: PHONE, messageId: 'wamid.1', messageType: 'text', text: TEXT, ...over,
})

describe('routeBookingIntent — gate (AC-4, AC-8)', () => {
  it.each([
    ['mode off', { mode: 'off' as const }],
    ['aiRoutingEnabled false', { aiRoutingEnabled: false }],
  ])('%s → classifier not called, fallback, nothing recorded', async (_, over) => {
    const { deps, classifier, classifications } = setup(over)
    expect(await routeBookingIntent(deps, input())).toEqual({ kind: 'fallback' })
    expect(classifier.calls).toEqual([])
    expect(classifications.rows).toEqual([])
  })

  it.each([['non-text', { messageType: 'interactive' }], ['blank text', { text: '   ' }]])(
    '%s → classifier not called',
    async (_, over) => {
      const { deps, classifier } = setup()
      expect(await routeBookingIntent(deps, input(over))).toEqual({ kind: 'fallback' })
      expect(classifier.calls).toEqual([])
    }
  )
})

describe('routeBookingIntent — decision (AC-4, AC-6)', () => {
  it('booking ≥ 0.7 in simple mode → Book now target with a chat link', async () => {
    const { deps, classifier } = setup({}, { ok: true, label: 'booking', confidence: 0.7 })
    const decision = await routeBookingIntent(deps, input())
    expect(classifier.calls).toEqual([TEXT])
    expect(decision).toMatchObject({ kind: 'booking_reply', target: { mode: 'simple' } })
  })

  it('booking ≥ 0.7 in external mode → the external URL', async () => {
    const { deps } = setup({ mode: 'external', externalUrl: 'https://inline.app/r/demo' })
    expect(await routeBookingIntent(deps, input())).toEqual({
      kind: 'booking_reply', target: { mode: 'external', url: 'https://inline.app/r/demo' },
    })
  })

  it.each<[string, ClassifyResult]>([
    ['booking 0.69', { ok: true, label: 'booking', confidence: 0.69 }],
    ['loyalty 0.99', { ok: true, label: 'loyalty', confidence: 0.99 }],
    ['other', { ok: true, label: 'other', confidence: 0.9 }],
    ['timeout', { ok: false, reason: 'timeout' }],
    ['safety', { ok: false, reason: 'safety' }],
  ])('%s → fallback', async (_, result) => {
    const { deps } = setup({}, result)
    expect(await routeBookingIntent(deps, input())).toEqual({ kind: 'fallback' })
  })

  it('booking but the link cannot be built → fallback, recorded as fallback', async () => {
    const { deps, tokens, classifications } = setup()
    tokens.failMint = true
    expect(await routeBookingIntent(deps, input())).toEqual({ kind: 'fallback' })
    expect(classifications.rows[0].outcome).toBe('fallback')
  })
})

describe('routeBookingIntent — record (AC-7, R17)', () => {
  it('writes label, confidence and outcome per classified message, no text', async () => {
    const { deps, classifications } = setup({}, { ok: true, label: 'booking', confidence: 0.91 })
    await routeBookingIntent(deps, input())
    expect(classifications.rows).toEqual([
      { restaurantId: R, messageId: 'wamid.1', label: 'booking', confidence: 0.91, outcome: 'booking_reply' },
    ])
  })

  it('a fallback label is recorded with outcome fallback', async () => {
    const { deps, classifications } = setup({}, { ok: true, label: 'loyalty', confidence: 0.8 })
    await routeBookingIntent(deps, input())
    expect(classifications.rows[0]).toMatchObject({ label: 'loyalty', confidence: 0.8, outcome: 'fallback' })
  })

  it('an error is recorded with null label and confidence', async () => {
    const { deps, classifications } = setup({}, { ok: false, reason: 'http_error' })
    await routeBookingIntent(deps, input())
    expect(classifications.rows[0]).toEqual({
      restaurantId: R, messageId: 'wamid.1', label: null, confidence: null, outcome: 'error',
    })
  })

  it('a replayed wamid → duplicate (no second reply), one row, no throw', async () => {
    const { deps, classifications } = setup()
    expect((await routeBookingIntent(deps, input())).kind).toBe('booking_reply')
    expect(await routeBookingIntent(deps, input())).toEqual({ kind: 'duplicate' })
    expect(classifications.rows).toHaveLength(1)
  })

  it('a failed record still replies (fail open)', async () => {
    const { deps, classifications } = setup()
    classifications.fail = true
    expect((await routeBookingIntent(deps, input())).kind).toBe('booking_reply')
  })
})

describe('routeBookingIntent — R13 writes', () => {
  it('booking path writes only the classification row and one chat token', async () => {
    const { deps, classifications, tokens } = setup()
    const depKeys = Object.keys(deps).sort()
    await routeBookingIntent(deps, input())
    expect(classifications.rows).toHaveLength(1)
    expect(tokens.mints).toHaveLength(1)
    // The use case has no member, consent, coupon, points, stamp or booking port to write through.
    expect(depKeys).toEqual(['appUrl', 'classifications', 'classifier', 'getConfig', 'log', 'tokens'])
  })
})

describe('routeBookingIntent — R8 logs', () => {
  it('logs outcome and message id, never the text or the phone', async () => {
    for (const result of [
      { ok: false, reason: 'timeout' } as const,
      { ok: true, label: 'booking', confidence: 0.9 } as const,
    ]) {
      const { deps, log } = setup({}, result)
      await routeBookingIntent(deps, input())
      const logged = JSON.stringify(log.mock.calls)
      expect(logged).toContain('wamid.1')
      expect(logged).not.toContain(TEXT)
      expect(logged).not.toContain('91234567')
    }
  })
})
