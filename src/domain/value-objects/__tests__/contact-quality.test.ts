import { describe, it, expect } from 'vitest'
import {
  classifyContactQuality,
  CONTACT_QUALITY_THRESHOLDS,
  CONTACT_QUALITY_WINDOW_DAYS,
} from '../contact-quality'

const counts = (delivered: number, failed: number) => ({ delivered, failed })

describe('classifyContactQuality', () => {
  it('exposes the owner-tunable window and thresholds', () => {
    expect(CONTACT_QUALITY_WINDOW_DAYS).toBe(90)
    expect(CONTACT_QUALITY_THRESHOLDS).toEqual({ green: 0.9, yellow: 0.6 })
  })

  it('is red for an unreachable member regardless of history', () => {
    const q = classifyContactQuality({ ...counts(100, 0), unreachable: true })
    expect(q.rating).toBe('red')
    expect(q.deliveryRate).toBe(1)
    expect(q.sampleSize).toBe(100)
  })

  it('is red for an unreachable member with no sample', () => {
    expect(classifyContactQuality({ ...counts(0, 0), unreachable: true }).rating).toBe('red')
  })

  it('is unknown with a zero sample and a null rate', () => {
    expect(classifyContactQuality({ ...counts(0, 0), unreachable: false })).toEqual({
      rating: 'unknown',
      deliveryRate: null,
      sampleSize: 0,
      reason: 'no_data',
    })
  })

  it.each([
    [9, 1, 'green'], // 0.90 exactly
    [10, 0, 'green'],
    [8999, 1001, 'yellow'], // 0.8999
    [6, 4, 'yellow'], // 0.60 exactly
    [5999, 4001, 'red'], // 0.5999
    [0, 5, 'red'],
  ])('delivered=%i failed=%i -> %s', (d, f, rating) => {
    expect(classifyContactQuality({ ...counts(d, f), unreachable: false }).rating).toBe(rating)
  })

  it('reports rate and sampleSize', () => {
    expect(classifyContactQuality({ ...counts(3, 1), unreachable: false })).toEqual({
      rating: 'yellow',
      deliveryRate: 0.75,
      sampleSize: 4,
      reason: 'meets_yellow',
    })
  })

  it.each([
    [0, 0, true, 'unreachable'],
    [100, 0, true, 'unreachable'],
    [0, 0, false, 'no_data'],
    [9, 1, false, 'meets_green'], // 0.90 exactly
    [6, 4, false, 'meets_yellow'], // 0.60 exactly
    [8999, 1001, false, 'meets_yellow'],
    [5999, 4001, false, 'below_yellow'],
    [0, 5, false, 'below_yellow'],
  ])('delivered=%i failed=%i unreachable=%s -> reason %s', (d, f, unreachable, reason) => {
    expect(classifyContactQuality({ ...counts(d, f), unreachable }).reason).toBe(reason)
  })
})
