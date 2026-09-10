import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { StampCampaign, type CreateStampCampaignInput } from '../stamp-campaign'

const FIXED_NOW = new Date('2026-06-09T12:00:00.000Z')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(FIXED_NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

function buildCreate(
  overrides: Partial<CreateStampCampaignInput> = {}
): CreateStampCampaignInput {
  return {
    id: 'camp-1',
    restaurantId: 'rest-1',
    name: 'Buy 10 get 1',
    nameZh: '儲十送一',
    stampsRequired: 10,
    rewardId: 'reward-1',
    ...overrides,
  }
}

describe('StampCampaign.create', () => {
  it('starts in draft with default max 1 stamp/day', () => {
    const c = StampCampaign.create(buildCreate())
    expect(c.snapshot).toMatchObject({
      id: 'camp-1',
      restaurantId: 'rest-1',
      name: 'Buy 10 get 1',
      nameZh: '儲十送一',
      stampsRequired: 10,
      rewardId: 'reward-1',
      status: 'draft',
      maxStampsPerDay: 1,
      honorUntil: null,
    })
  })

  it('accepts an explicit max_stamps_per_day', () => {
    const c = StampCampaign.create(buildCreate({ maxStampsPerDay: 3 }))
    expect(c.snapshot.maxStampsPerDay).toBe(3)
  })

  it('rejects stampsRequired <= 0', () => {
    expect(() => StampCampaign.create(buildCreate({ stampsRequired: 0 }))).toThrow(
      /stampsRequired/
    )
  })

  it('rejects maxStampsPerDay < 1', () => {
    expect(() =>
      StampCampaign.create(buildCreate({ maxStampsPerDay: 0 }))
    ).toThrow(/maxStampsPerDay/)
  })

  it('rejects an empty name', () => {
    expect(() => StampCampaign.create(buildCreate({ name: '  ' }))).toThrow(/name/)
  })

  it('rejects a missing rewardId', () => {
    expect(() => StampCampaign.create(buildCreate({ rewardId: '' }))).toThrow(
      /rewardId/
    )
  })
})

describe('StampCampaign.activate', () => {
  it('moves a draft to active', () => {
    const c = StampCampaign.create(buildCreate()).activate()
    expect(c.snapshot.status).toBe('active')
  })

  it('is idempotent on an already-active campaign', () => {
    const c = StampCampaign.create(buildCreate()).activate().activate()
    expect(c.snapshot.status).toBe('active')
  })

  it('rejects activating an ended campaign', () => {
    const ended = StampCampaign.create(buildCreate()).activate().end()
    expect(() => ended.activate()).toThrow(/ended/)
  })
})

describe('StampCampaign.pause', () => {
  it('moves active to paused', () => {
    const c = StampCampaign.create(buildCreate()).activate().pause()
    expect(c.snapshot.status).toBe('paused')
  })
})

describe('StampCampaign.end', () => {
  it('ends and sets a 14-day honor window from now', () => {
    const c = StampCampaign.create(buildCreate()).activate().end()
    const expected = new Date(
      FIXED_NOW.getTime() + 14 * 24 * 60 * 60 * 1000
    ).toISOString()
    expect(c.snapshot.status).toBe('ended')
    expect(c.snapshot.honorUntil).toBe(expected)
  })
})

describe('StampCampaign.fromProps', () => {
  it('rehydrates persisted state without mutation', () => {
    const c = StampCampaign.create(buildCreate({ maxStampsPerDay: 2 })).activate()
    const round = StampCampaign.fromProps(c.snapshot)
    expect(round.snapshot).toEqual(c.snapshot)
  })
})
