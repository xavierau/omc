import { describe, it, expect } from 'vitest'
import { QualityStateEvent } from '../quality-state-event'

const baseInput = {
  id: '11111111-1111-1111-1111-111111111111',
  restaurantId: 'rest-1',
  phoneNumberId: 'pn-1',
  qualityRating: 'GREEN' as const,
  messagingTier: 'TIER_1K' as const,
  flagged: false,
  rawPayload: { foo: 'bar' },
  transitionedAt: '2026-05-04T10:00:00.000Z',
}

describe('QualityStateEvent.fromWebhook', () => {
  it('builds an immutable snapshot from a complete input', () => {
    const e = QualityStateEvent.fromWebhook(baseInput)
    expect(e.snapshot).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      restaurantId: 'rest-1',
      phoneNumberId: 'pn-1',
      displayPhoneNumber: null,
      qualityRating: 'GREEN',
      messagingTier: 'TIER_1K',
      flagged: false,
      rawPayload: { foo: 'bar' },
      transitionedAt: '2026-05-04T10:00:00.000Z',
    })
  })

  it('accepts a display-only event (no phone_number_id)', () => {
    const e = QualityStateEvent.fromWebhook({
      id: 'id-2',
      restaurantId: 'rest-1',
      displayPhoneNumber: '85291234567',
      qualityRating: 'YELLOW',
    })
    expect(e.snapshot.phoneNumberId).toBeNull()
    expect(e.snapshot.displayPhoneNumber).toBe('85291234567')
  })

  it('defaults messagingTier=null, flagged=false, rawPayload=null when omitted', () => {
    const e = QualityStateEvent.fromWebhook({
      id: 'id-1',
      restaurantId: 'rest-1',
      phoneNumberId: 'pn-1',
      qualityRating: 'YELLOW',
      transitionedAt: '2026-05-04T10:00:00.000Z',
    })
    expect(e.snapshot.messagingTier).toBeNull()
    expect(e.snapshot.flagged).toBe(false)
    expect(e.snapshot.rawPayload).toBeNull()
  })

  it('defaults transitionedAt to now() when omitted', () => {
    const before = Date.now()
    const e = QualityStateEvent.fromWebhook({
      id: 'id-1',
      restaurantId: 'rest-1',
      phoneNumberId: 'pn-1',
      qualityRating: 'RED',
    })
    const ts = Date.parse(e.snapshot.transitionedAt)
    expect(ts).toBeGreaterThanOrEqual(before)
    expect(ts).toBeLessThanOrEqual(Date.now() + 1)
  })

  it('rejects an empty restaurantId', () => {
    expect(() =>
      QualityStateEvent.fromWebhook({
        ...baseInput,
        restaurantId: '',
      })
    ).toThrow(/restaurantId/)
  })

  it('rejects when neither phoneNumberId nor displayPhoneNumber is present', () => {
    expect(() =>
      QualityStateEvent.fromWebhook({
        id: 'id-x',
        restaurantId: 'rest-1',
        qualityRating: 'GREEN',
      })
    ).toThrow(/phoneNumberId or displayPhoneNumber/)
  })

  it('rejects when both phone identifiers are blank strings', () => {
    expect(() =>
      QualityStateEvent.fromWebhook({
        id: 'id-x',
        restaurantId: 'rest-1',
        phoneNumberId: '   ',
        displayPhoneNumber: '',
        qualityRating: 'GREEN',
      })
    ).toThrow(/phoneNumberId or displayPhoneNumber/)
  })
})

describe('QualityStateEvent.fromProps', () => {
  it('round-trips snapshot identity', () => {
    const e = QualityStateEvent.fromWebhook(baseInput)
    const e2 = QualityStateEvent.fromProps(e.snapshot)
    expect(e2.snapshot).toEqual(e.snapshot)
  })
})
