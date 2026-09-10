import { describe, it, expect } from 'vitest'
import { Language } from '@/domain/value-objects/language'
import { pointsEarnedMessage } from '../award-points-messages'

describe('pointsEarnedMessage', () => {
  it('EN — includes points earned, new balance, and "Keep it up"', () => {
    const text = pointsEarnedMessage(Language.EN, {
      pointsEarned: 10,
      newBalance: 60,
    })
    expect(text).toContain('10 points')
    expect(text).toContain('60 points')
    expect(text.toLowerCase()).toContain('keep it up')
  })

  it('ZH — includes 積分 numbers and encouragement', () => {
    const text = pointsEarnedMessage(Language.ZH_HK, {
      pointsEarned: 10,
      newBalance: 60,
    })
    expect(text).toContain('10')
    expect(text).toContain('60')
    expect(text).toContain('積分')
    expect(text).toMatch(/繼續|加油/)
  })

  it('EN — uses newline between earned and balance lines', () => {
    const text = pointsEarnedMessage(Language.EN, {
      pointsEarned: 5,
      newBalance: 25,
    })
    expect(text).toContain('\n')
  })
})
