import { describe, it, expect } from 'vitest'
import { StampCard } from '../stamp-card'
import { StampCampaign } from '../stamp-campaign'

function buildCampaign(stampsRequired = 3, rewardId = 'reward-1') {
  return StampCampaign.create({
    id: 'camp-1',
    restaurantId: 'rest-1',
    name: 'Buy N',
    stampsRequired,
    rewardId,
  })
}

function buildCard(stampsRequired = 3) {
  return StampCard.openFor({
    id: 'card-1',
    memberId: 'mem-1',
    campaign: buildCampaign(stampsRequired),
  })
}

describe('StampCard.openFor', () => {
  it('snapshots required + reward from the campaign and starts at 0/in_progress', () => {
    const card = StampCard.openFor({
      id: 'card-1',
      memberId: 'mem-1',
      campaign: buildCampaign(10, 'reward-9'),
    })
    expect(card.snapshot).toMatchObject({
      id: 'card-1',
      restaurantId: 'rest-1',
      memberId: 'mem-1',
      campaignId: 'camp-1',
      stampsCount: 0,
      stampsRequired: 10,
      rewardId: 'reward-9',
      status: 'in_progress',
    })
  })
})

describe('StampCard.increment', () => {
  it('adds one stamp and stays in_progress below the threshold', () => {
    const card = buildCard(3).increment()
    expect(card.snapshot.stampsCount).toBe(1)
    expect(card.snapshot.status).toBe('in_progress')
    expect(card.isComplete).toBe(false)
  })

  it('completes when the snapshotted required count is reached', () => {
    const card = buildCard(3).increment().increment().increment()
    expect(card.snapshot.stampsCount).toBe(3)
    expect(card.snapshot.status).toBe('completed')
    expect(card.isComplete).toBe(true)
  })

  it('rejects incrementing a completed card', () => {
    const done = buildCard(1).increment()
    expect(() => done.increment()).toThrow(/completed/)
  })
})

describe('StampCard snapshot immutability vs later campaign edits', () => {
  it('keeps the original required count even if the campaign is later edited', () => {
    const campaign = buildCampaign(3, 'reward-1')
    const card = StampCard.openFor({ id: 'card-1', memberId: 'mem-1', campaign })

    // Owner edits the campaign mid-flight (new campaign instance — entities are
    // immutable; the persisted campaign row would change to required=5).
    const edited = StampCampaign.create({
      id: 'camp-1',
      restaurantId: 'rest-1',
      name: 'Buy N',
      stampsRequired: 5,
      rewardId: 'reward-2',
    })
    expect(edited.snapshot.stampsRequired).toBe(5)

    // The card's goalposts do NOT move: still completes at 3 with the old reward.
    const completed = card.increment().increment().increment()
    expect(completed.snapshot.stampsRequired).toBe(3)
    expect(completed.snapshot.rewardId).toBe('reward-1')
    expect(completed.snapshot.status).toBe('completed')
  })
})

describe('StampCard.reverse', () => {
  it('decrements one stamp', () => {
    const card = buildCard(3).increment().increment().reverse()
    expect(card.snapshot.stampsCount).toBe(1)
  })

  it('floors at 0 — reversing an empty card is a no-op', () => {
    const card = buildCard(3).reverse()
    expect(card.snapshot.stampsCount).toBe(0)
  })

  it('floors at 0 across repeated reversals', () => {
    const card = buildCard(3).increment().reverse().reverse().reverse()
    expect(card.snapshot.stampsCount).toBe(0)
  })

  it('reopens a completed card back to in_progress when reversed below threshold', () => {
    const done = buildCard(1).increment()
    expect(done.snapshot.status).toBe('completed')
    const reopened = done.reverse()
    expect(reopened.snapshot.stampsCount).toBe(0)
    expect(reopened.snapshot.status).toBe('in_progress')
  })
})

describe('StampCard.fromProps', () => {
  it('rehydrates persisted state without mutation', () => {
    const card = buildCard(3).increment()
    const round = StampCard.fromProps(card.snapshot)
    expect(round.snapshot).toEqual(card.snapshot)
  })
})
