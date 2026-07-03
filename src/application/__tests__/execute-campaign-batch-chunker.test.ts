import { describe, it, expect } from 'vitest'
import type { Member } from '@/domain/entities/member'
import type { PacingConfig } from '@/domain/value-objects/pacing-strategy'
import { planChunks } from '@/application/execute-campaign-batch-chunker'

function buildConfig(overrides: Partial<PacingConfig> = {}): PacingConfig {
  return {
    strategy: 'engagement_tier',
    probeChunkSize: 100,
    scaleChunkSize: 100,
    activeHoursStartLocal: '10:00:00',
    activeHoursEndLocal: '22:00:00',
    tenantTimezone: 'Asia/Hong_Kong',
    ...overrides,
  }
}

function buildMembers(n: number): Member[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m-${i}`,
    restaurantId: 'r-1',
    phone: `8529000${String(i).padStart(4, '0')}`,
    name: null,
    pointsBalance: 0,
    status: 'active' as const,
    joinedAt: '2024-01-01T00:00:00Z',
    lastVisitAt: null,
    preferredLanguage: null,
    pmmThrottledUntil: null,
    unreachableAt: null,
  }))
}

describe('planChunks (WAQ-010)', () => {
  it('engagement_tier: first chunk = probeChunkSize, rest = scaleChunkSize', () => {
    const config = buildConfig({ probeChunkSize: 2, scaleChunkSize: 3 })
    const plan = planChunks(buildMembers(6), config)

    expect(plan.map((c) => c.members.length)).toEqual([2, 3, 1])
    expect(plan[0].isProbe).toBe(true)
    expect(plan[1].isProbe).toBe(false)
    expect(plan[2].isProbe).toBe(false)
  })

  it('engagement_tier: total <= probeChunkSize collapses to a single probe chunk', () => {
    const config = buildConfig({ probeChunkSize: 100, scaleChunkSize: 100 })
    const plan = planChunks(buildMembers(50), config)

    expect(plan.length).toBe(1)
    expect(plan[0].isProbe).toBe(true)
    expect(plan[0].members.length).toBe(50)
  })

  it('naive: chunks fixed at 20 and never marked as probe', () => {
    const config = buildConfig({ strategy: 'naive' })
    const plan = planChunks(buildMembers(45), config)

    expect(plan.map((c) => c.members.length)).toEqual([20, 20, 5])
    expect(plan.every((c) => c.isProbe === false)).toBe(true)
  })

  it('returns an empty plan for an empty member list', () => {
    expect(planChunks([], buildConfig())).toEqual([])
    expect(planChunks([], buildConfig({ strategy: 'naive' }))).toEqual([])
  })
})
