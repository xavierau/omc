import { describe, it, expect } from 'vitest'
import { decideQualityAction } from '../quality-action'
import type { QualityRating } from '../quality-rating'

type Case = [QualityRating | null, QualityRating, ReturnType<typeof decideQualityAction>['kind']]

describe('decideQualityAction', () => {
  // 5 prev (null + 4 ratings) x 4 next = 20 cases. Every transition is
  // covered explicitly so any drift in the policy fails a named row.
  const cases: Case[] = [
    // null prev (first-ever event for this tenant)
    [null, 'GREEN', 'no_op'],
    [null, 'YELLOW', 'throttle'],
    [null, 'RED', 'pause'],
    [null, 'UNKNOWN', 'no_op'],
    // GREEN prev
    ['GREEN', 'GREEN', 'no_op'],
    ['GREEN', 'YELLOW', 'throttle'],
    ['GREEN', 'RED', 'pause'],
    ['GREEN', 'UNKNOWN', 'no_op'],
    // YELLOW prev
    ['YELLOW', 'GREEN', 'manual_recovery_required'],
    ['YELLOW', 'YELLOW', 'no_op'],
    ['YELLOW', 'RED', 'pause'],
    ['YELLOW', 'UNKNOWN', 'no_op'],
    // RED prev
    ['RED', 'GREEN', 'manual_recovery_required'],
    ['RED', 'YELLOW', 'pause'], // RED -> YELLOW: still degraded, keep paused; treat as pause request (idempotent)
    ['RED', 'RED', 'pause'],
    ['RED', 'UNKNOWN', 'no_op'],
    // UNKNOWN prev — UNKNOWN never participates in compare; treat as null prev
    ['UNKNOWN', 'GREEN', 'no_op'],
    ['UNKNOWN', 'YELLOW', 'throttle'],
    ['UNKNOWN', 'RED', 'pause'],
    ['UNKNOWN', 'UNKNOWN', 'no_op'],
  ]

  it.each(cases)(
    'prev=%s next=%s -> %s',
    (prevRating, nextRating, expectedKind) => {
      const action = decideQualityAction({ prevRating, nextRating })
      expect(action.kind).toBe(expectedKind)
    }
  )

  it('throttle action carries factor 0.5 and yellow_throttle reason', () => {
    const action = decideQualityAction({ prevRating: 'GREEN', nextRating: 'YELLOW' })
    if (action.kind !== 'throttle') throw new Error('expected throttle')
    expect(action.factor).toBe(0.5)
    expect(action.reason).toBe('quality_yellow_throttle')
  })

  it('pause action carries red_auto reason', () => {
    const action = decideQualityAction({ prevRating: 'GREEN', nextRating: 'RED' })
    if (action.kind !== 'pause') throw new Error('expected pause')
    expect(action.reason).toBe('quality_red_auto')
  })

  it('YELLOW->YELLOW does not re-throttle (idempotent)', () => {
    const action = decideQualityAction({ prevRating: 'YELLOW', nextRating: 'YELLOW' })
    expect(action.kind).toBe('no_op')
  })
})
