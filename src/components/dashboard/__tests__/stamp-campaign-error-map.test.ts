import { describe, it, expect } from 'vitest'
import { mapCreateError, mapTransitionError } from '@/components/dashboard/stamp-campaign-error-map'

describe('mapCreateError', () => {
  it('maps the zero-rewards block to errorNoRewards', () => {
    expect(mapCreateError('Create a reward first — a stamp campaign needs a reward to give out.')).toBe('errorNoRewards')
  })

  it('maps a missing reward to errorRewardNotFound', () => {
    expect(mapCreateError('That reward does not exist for this restaurant.')).toBe('errorRewardNotFound')
  })

  it('maps a cap-block message to errorCapBlocked', () => {
    expect(mapCreateError('Your plan limits stamps to 1/day.')).toBe('errorCapBlocked')
  })

  it('falls back to saveError for unknown errors', () => {
    expect(mapCreateError('boom')).toBe('saveError')
    expect(mapCreateError(undefined)).toBe('saveError')
  })
})

describe('mapTransitionError', () => {
  it('maps the one-active conflict to errorOneActive', () => {
    expect(mapTransitionError('Pause the running card first.')).toBe('errorOneActive')
  })

  it('falls back to transitionError for unknown errors', () => {
    expect(mapTransitionError('boom')).toBe('transitionError')
    expect(mapTransitionError(undefined)).toBe('transitionError')
  })
})
