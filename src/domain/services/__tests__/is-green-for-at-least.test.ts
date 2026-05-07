import { describe, it, expect } from 'vitest'
import { QualityStateEvent } from '@/domain/entities/quality-state-event'
import type { QualityRating } from '@/domain/value-objects/quality-rating'
import { isGreenForAtLeast } from '../is-green-for-at-least'

// Pure-function mirror of the SQL `tenant_green_for_days` RPC. Same Q-H
// strict semantics: tenant must currently be GREEN AND have been GREEN
// continuously for ≥ minDays. Any non-GREEN transition within the last
// `minDays` disqualifies. Used in unit tests for callers that resolve
// the streak server-side from history (no DB round-trip).

const NOW = new Date('2026-05-10T00:00:00.000Z')

function evt(rating: QualityRating, daysAgo: number, idSuffix = ''): QualityStateEvent {
  const at = new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString()
  return QualityStateEvent.fromWebhook({
    id: `evt-${rating}-${daysAgo}${idSuffix}`,
    restaurantId: 'rest-1',
    phoneNumberId: 'pn-1',
    qualityRating: rating,
    transitionedAt: at,
  })
}

describe('isGreenForAtLeast', () => {
  it('returns false when no events exist (no quality signal)', () => {
    expect(isGreenForAtLeast([], 7, NOW)).toBe(false)
  })

  it('returns false when current rating is YELLOW', () => {
    const events = [evt('GREEN', 30), evt('YELLOW', 1)]
    expect(isGreenForAtLeast(events, 7, NOW)).toBe(false)
  })

  it('returns false when current rating is RED', () => {
    const events = [evt('GREEN', 30), evt('RED', 0)]
    expect(isGreenForAtLeast(events, 7, NOW)).toBe(false)
  })

  it('returns true when only GREEN events and earliest is ≥ minDays old', () => {
    const events = [evt('GREEN', 10), evt('GREEN', 1, '-b')]
    expect(isGreenForAtLeast(events, 7, NOW)).toBe(true)
  })

  it('returns false when only GREEN events but earliest is < minDays old', () => {
    const events = [evt('GREEN', 3), evt('GREEN', 1, '-b')]
    expect(isGreenForAtLeast(events, 7, NOW)).toBe(false)
  })

  it('returns false on GREEN→YELLOW→GREEN with the YELLOW within last minDays', () => {
    // 30d ago GREEN, 5d ago YELLOW, 1d ago GREEN → YELLOW still inside 7d window.
    const events = [evt('GREEN', 30), evt('YELLOW', 5), evt('GREEN', 1)]
    expect(isGreenForAtLeast(events, 7, NOW)).toBe(false)
  })

  it('returns true on GREEN→YELLOW→GREEN when YELLOW happened > minDays ago', () => {
    // 30d GREEN, 14d YELLOW, 10d GREEN → YELLOW is older than 7d.
    const events = [evt('GREEN', 30), evt('YELLOW', 14), evt('GREEN', 10)]
    expect(isGreenForAtLeast(events, 7, NOW)).toBe(true)
  })

  it('returns false when YELLOW is exactly minDays-1 old', () => {
    // YELLOW 6 days ago, GREEN 1 day ago — still within 7d window.
    const events = [evt('GREEN', 30), evt('YELLOW', 6), evt('GREEN', 1)]
    expect(isGreenForAtLeast(events, 7, NOW)).toBe(false)
  })

  it('returns true when latest non-GREEN is exactly minDays old (boundary)', () => {
    // YELLOW 7 days ago, GREEN 6 days ago → latest non-GREEN is at the cutoff.
    const events = [evt('GREEN', 30), evt('YELLOW', 7), evt('GREEN', 6)]
    expect(isGreenForAtLeast(events, 7, NOW)).toBe(true)
  })

  it('does not require pre-sorted input — sorts internally by transitionedAt', () => {
    const events = [evt('GREEN', 1), evt('GREEN', 30)]
    expect(isGreenForAtLeast(events, 7, NOW)).toBe(true)
  })

  it('handles minDays=0 (always true once any GREEN is current)', () => {
    expect(isGreenForAtLeast([evt('GREEN', 0)], 0, NOW)).toBe(true)
  })

  it('uses provided NOW for deterministic boundary math', () => {
    // Same event set, two different "now" anchors — different verdicts.
    const events = [evt('GREEN', 30), evt('YELLOW', 6), evt('GREEN', 5)]
    expect(isGreenForAtLeast(events, 7, NOW)).toBe(false)
    const laterNow = new Date(NOW.getTime() + 2 * 86_400_000)
    // YELLOW is now 8 days ago, GREEN is 7 days ago → passes 7-day check.
    expect(isGreenForAtLeast(events, 7, laterNow)).toBe(true)
  })
})
