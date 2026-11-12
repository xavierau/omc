import { describe, it, expect } from 'vitest'
import { loyaltyToken } from '../loyalty-token'

describe('loyaltyToken', () => {
  it('produces 32 lowercase hex chars (16 random bytes, matching migration 050 backfill)', () => {
    const token = loyaltyToken()
    expect(token).toMatch(/^[0-9a-f]{32}$/)
  })

  it('is unique across calls (no collision in a small sample)', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => loyaltyToken()))
    expect(tokens.size).toBe(200)
  })
})
