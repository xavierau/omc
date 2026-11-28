import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/whatsapp-message-repository', () => ({
  countMarketingSendsLast24h: vi.fn(),
  countMarketingSendsLast24hForPhones: vi.fn(),
}))

import {
  checkMarketingCooldown,
  bulkCheckMarketingCooldown,
} from '../check-marketing-cooldown'
import {
  countMarketingSendsLast24h,
  countMarketingSendsLast24hForPhones,
} from '@/infrastructure/supabase/repositories/whatsapp-message-repository'

const FUTURE = new Date(Date.now() + 3600_000).toISOString()
const PAST = new Date(Date.now() - 3600_000).toISOString()

describe('checkMarketingCooldown', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects with pmm_throttled when pmm_throttled_until is in the future', async () => {
    const r = await checkMarketingCooldown({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberPmmThrottledUntil: FUTURE,
      memberUnreachableAt: null,
      cap: 1,
    })
    expect(r).toEqual({ allowed: false, reason: 'pmm_throttled' })
    // Throttle short-circuits before the count query — no DB call needed.
    expect(countMarketingSendsLast24h).not.toHaveBeenCalled()
  })

  it('does NOT regress to pmm_throttled when the timestamp is in the past', async () => {
    vi.mocked(countMarketingSendsLast24h).mockResolvedValue(0)

    const r = await checkMarketingCooldown({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberPmmThrottledUntil: PAST,
      memberUnreachableAt: null,
      cap: 1,
    })
    expect(r).toEqual({ allowed: true })
  })

  it('rejects with unreachable when unreachable_at is set', async () => {
    const r = await checkMarketingCooldown({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberPmmThrottledUntil: null,
      memberUnreachableAt: PAST,
      cap: 1,
    })
    expect(r).toEqual({ allowed: false, reason: 'unreachable' })
    expect(countMarketingSendsLast24h).not.toHaveBeenCalled()
  })

  it('allows when neither flag is set and count is below cap', async () => {
    vi.mocked(countMarketingSendsLast24h).mockResolvedValue(0)

    const r = await checkMarketingCooldown({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberPmmThrottledUntil: null,
      memberUnreachableAt: null,
      cap: 1,
    })
    expect(r).toEqual({ allowed: true })
  })

  it('rejects with cap_exceeded when count >= cap', async () => {
    vi.mocked(countMarketingSendsLast24h).mockResolvedValue(1)

    const r = await checkMarketingCooldown({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberPmmThrottledUntil: null,
      memberUnreachableAt: null,
      cap: 1,
    })
    expect(r).toEqual({ allowed: false, reason: 'cap_exceeded' })
  })

  it('honors a tenant override cap of 2', async () => {
    vi.mocked(countMarketingSendsLast24h).mockResolvedValue(1)

    const r = await checkMarketingCooldown({
      restaurantId: 'r-1',
      phoneE164: '85291234567',
      memberPmmThrottledUntil: null,
      memberUnreachableAt: null,
      cap: 2,
    })
    // Same recipient counted as 1 — second send within 24h still allowed.
    expect(r).toEqual({ allowed: true })
  })
})

describe('bulkCheckMarketingCooldown', () => {
  beforeEach(() => vi.clearAllMocks())

  it('short-circuits an empty recipients list — no DB call, empty map', async () => {
    const map = await bulkCheckMarketingCooldown({
      restaurantId: 'r-1',
      recipients: [],
      cap: 1,
    })
    expect(map.size).toBe(0)
    expect(countMarketingSendsLast24hForPhones).not.toHaveBeenCalled()
  })

  it('issues exactly ONE bulk count() and decides each recipient in memory (no N+1)', async () => {
    // throttled → pmm_throttled (no count needed for them)
    // unreachable → unreachable (no count needed for them)
    // capped → count=1 with cap=1 → cap_exceeded
    // allowed → count=0 with cap=1 → allowed
    vi.mocked(countMarketingSendsLast24hForPhones).mockResolvedValue(
      new Map([['85293333333', 1]])
    )

    const map = await bulkCheckMarketingCooldown({
      restaurantId: 'r-1',
      recipients: [
        { phoneE164: '85291111111', memberPmmThrottledUntil: FUTURE, memberUnreachableAt: null },
        { phoneE164: '85292222222', memberPmmThrottledUntil: null, memberUnreachableAt: PAST },
        { phoneE164: '85293333333', memberPmmThrottledUntil: null, memberUnreachableAt: null },
        { phoneE164: '85294444444', memberPmmThrottledUntil: null, memberUnreachableAt: null },
      ],
      cap: 1,
    })

    expect(countMarketingSendsLast24hForPhones).toHaveBeenCalledTimes(1)
    expect(countMarketingSendsLast24hForPhones).toHaveBeenCalledWith({
      restaurantId: 'r-1',
      phones: ['85291111111', '85292222222', '85293333333', '85294444444'],
    })

    expect(map.get('85291111111')).toEqual({
      allowed: false,
      reason: 'pmm_throttled',
    })
    expect(map.get('85292222222')).toEqual({
      allowed: false,
      reason: 'unreachable',
    })
    expect(map.get('85293333333')).toEqual({
      allowed: false,
      reason: 'cap_exceeded',
    })
    expect(map.get('85294444444')).toEqual({ allowed: true })
  })

  it('respects cap=2 when applied to bulk decisions', async () => {
    vi.mocked(countMarketingSendsLast24hForPhones).mockResolvedValue(
      new Map([
        ['85291111111', 1],
        ['85292222222', 2],
      ])
    )

    const map = await bulkCheckMarketingCooldown({
      restaurantId: 'r-1',
      recipients: [
        { phoneE164: '85291111111', memberPmmThrottledUntil: null, memberUnreachableAt: null },
        { phoneE164: '85292222222', memberPmmThrottledUntil: null, memberUnreachableAt: null },
      ],
      cap: 2,
    })

    expect(map.get('85291111111')).toEqual({ allowed: true })
    expect(map.get('85292222222')).toEqual({
      allowed: false,
      reason: 'cap_exceeded',
    })
  })
})
