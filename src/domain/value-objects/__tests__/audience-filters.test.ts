import { describe, it, expect } from 'vitest'
import {
  isSkippedRating,
  parseLapsedDays,
  parseSkipContactQuality,
} from '@/domain/value-objects/audience-filters'

describe('audience filters', () => {
  it('accepts exactly the three skip levels', () => {
    expect(parseSkipContactQuality('off')).toBe('off')
    expect(parseSkipContactQuality('red')).toBe('red')
    expect(parseSkipContactQuality('red_yellow')).toBe('red_yellow')
    for (const bad of ['yellow', 'RED', '', null, undefined, 1]) expect(parseSkipContactQuality(bad)).toBeNull()
  })

  it('accepts integer lapsed days 1..365 only', () => {
    expect(parseLapsedDays(1)).toBe(1)
    expect(parseLapsedDays(365)).toBe(365)
    for (const bad of [0, 366, -1, 30.5, '30', null, undefined, Number.NaN]) expect(parseLapsedDays(bad)).toBeNull()
  })

  it('never skips no-data contacts; red skips red; red_yellow skips both', () => {
    expect(['green', 'yellow', 'red', 'unknown'].filter((r) => isSkippedRating(r as never, 'off'))).toEqual([])
    expect(['green', 'yellow', 'red', 'unknown'].filter((r) => isSkippedRating(r as never, 'red'))).toEqual(['red'])
    expect(['green', 'yellow', 'red', 'unknown'].filter((r) => isSkippedRating(r as never, 'red_yellow'))).toEqual(['yellow', 'red'])
  })
})
