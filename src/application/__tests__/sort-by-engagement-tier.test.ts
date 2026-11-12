import { describe, it, expect } from 'vitest'
import type { Member } from '@/domain/entities/member'
import { sortByEngagementTier } from '@/application/sort-by-engagement-tier'

function buildMember(overrides: Partial<Member>): Member {
  return {
    id: overrides.id ?? 'm-x',
    restaurantId: 'r-1',
    phone: overrides.phone ?? '85291234567',
    name: null,
    pointsBalance: 0,
    status: 'active',
    joinedAt: '2024-01-01T00:00:00Z',
    lastVisitAt: null,
    preferredLanguage: null,
    pmmThrottledUntil: null,
    unreachableAt: null,
    ...overrides,
  }
}

describe('sortByEngagementTier', () => {
  it('sorts members by lastVisitAt DESC (most-recent first)', () => {
    const oldest = buildMember({ id: 'a', lastVisitAt: '2026-01-01T00:00:00Z' })
    const newest = buildMember({ id: 'b', lastVisitAt: '2026-05-01T00:00:00Z' })
    const middle = buildMember({ id: 'c', lastVisitAt: '2026-03-01T00:00:00Z' })

    const sorted = sortByEngagementTier([oldest, newest, middle])

    expect(sorted.map((m) => m.id)).toEqual(['b', 'c', 'a'])
  })

  it('places members with null lastVisitAt at the end (least engaged)', () => {
    const visited = buildMember({ id: 'a', lastVisitAt: '2026-01-01T00:00:00Z' })
    const never = buildMember({ id: 'b', lastVisitAt: null })

    expect(sortByEngagementTier([never, visited]).map((m) => m.id)).toEqual([
      'a',
      'b',
    ])
  })

  it('does not mutate the input array (pure)', () => {
    const a = buildMember({ id: 'a', lastVisitAt: '2026-01-01T00:00:00Z' })
    const b = buildMember({ id: 'b', lastVisitAt: '2026-05-01T00:00:00Z' })
    const input = [a, b]
    const before = [...input]

    sortByEngagementTier(input)

    expect(input).toEqual(before)
  })

  it('returns an empty array unchanged', () => {
    expect(sortByEngagementTier([])).toEqual([])
  })

  it('returns a single-element array unchanged', () => {
    const only = buildMember({ id: 'only', lastVisitAt: '2026-01-01T00:00:00Z' })
    expect(sortByEngagementTier([only])).toEqual([only])
  })

  it('keeps relative order for two members with identical lastVisitAt (stable)', () => {
    const a = buildMember({ id: 'a', lastVisitAt: '2026-01-01T00:00:00Z' })
    const b = buildMember({ id: 'b', lastVisitAt: '2026-01-01T00:00:00Z' })
    expect(sortByEngagementTier([a, b]).map((m) => m.id)).toEqual(['a', 'b'])
  })
})
