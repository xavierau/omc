import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import {
  ConcurrentAdvanceError,
  OnboardingAdvanceError,
} from '@/domain/services/__errors__/onboarding-errors'
import type { TenantOnboardingStateRepository } from '@/domain/repositories/tenant-onboarding-state-repository'
import type { KpiGateEvaluator } from '@/domain/ports/kpi-gate-evaluator'
import { CHECKLIST_KEYS } from '@/domain/value-objects/pre-kickoff-checklist'
import { advancePhase } from '../advance-phase'

const RESTAURANT_ID = 'rest-1'
const ACTOR = 'admin-1'
const NOW = '2026-05-05T01:00:00.000Z'

function makeRepo(): TenantOnboardingStateRepository {
  return {
    findByRestaurantId: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    advance: vi.fn(),
  }
}

function makeEvaluator(): KpiGateEvaluator {
  return { evaluate: vi.fn() }
}

const PASS_RESULT = {
  status: 'pass' as const,
  kpis: {
    totalSends: 200,
    delivered: 195,
    read: 100,
    failed: 5,
    optedOut: 1,
    deliveryRate: 0.975,
    readRate: 0.5,
    errorRate: 0.025,
    optOutRate: 0.005,
  },
  thresholds: {
    minDeliveryRate: 0.95,
    maxOptOutRate: 0.02,
    minSampleSize: 100,
    windowDays: 7,
  },
  failingMetrics: [],
}

const FAIL_RESULT = {
  ...PASS_RESULT,
  status: 'fail' as const,
  failingMetrics: ['delivery'] as const,
}

const INSUFFICIENT_RESULT = {
  ...PASS_RESULT,
  status: 'insufficient' as const,
  failingMetrics: [],
  kpis: { ...PASS_RESULT.kpis, totalSends: 12 },
}

function setupState() {
  let state = TenantOnboardingState.createDefault({
    id: 'id-1',
    restaurantId: RESTAURANT_ID,
    now: '2026-05-05T00:00:00.000Z',
  }).setPath('A', NOW)
  for (const key of CHECKLIST_KEYS) {
    state = state.tickChecklist(key, ACTOR, NOW)
  }
  return state
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(NOW))
})

describe('advancePhase', () => {
  it('advances setup→probe when checklist complete and KPI passes', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(setupState())
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(PASS_RESULT)
    vi.mocked(repo.advance).mockImplementation(async (s) => s)

    const out = await advancePhase({
      restaurantId: RESTAURANT_ID,
      actor: ACTOR,
      repo,
      kpiEvaluator: evaluator,
    })

    expect(out.state.snapshot.phase).toBe('probe')
    expect(out.state.snapshot.advancedBy).toBe(ACTOR)
    expect(out.fromPhase).toBe('setup')
    expect(out.toPhase).toBe('probe')
    expect(out.kpiGate.status).toBe('pass')
    expect(repo.advance).toHaveBeenCalledWith(expect.anything(), 'setup')
  })

  it('rejects with kpi_failed when gate fails', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(setupState())
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(FAIL_RESULT)

    await expect(
      advancePhase({
        restaurantId: RESTAURANT_ID,
        actor: ACTOR,
        repo,
        kpiEvaluator: evaluator,
      })
    ).rejects.toMatchObject({
      name: 'OnboardingAdvanceError',
      reason: 'kpi_failed',
    })
    expect(repo.advance).not.toHaveBeenCalled()
  })

  it('rejects with kpi_insufficient when sample size below 100', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(setupState())
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(INSUFFICIENT_RESULT)

    await expect(
      advancePhase({
        restaurantId: RESTAURANT_ID,
        actor: ACTOR,
        repo,
        kpiEvaluator: evaluator,
      })
    ).rejects.toMatchObject({ reason: 'kpi_insufficient' })
  })

  it('rejects with checklist_incomplete on setup→probe when an item is unchecked', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    const incomplete = TenantOnboardingState.createDefault({
      id: 'id-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    }).setPath('A', NOW)
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(incomplete)
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(PASS_RESULT)

    await expect(
      advancePhase({
        restaurantId: RESTAURANT_ID,
        actor: ACTOR,
        repo,
        kpiEvaluator: evaluator,
      })
    ).rejects.toMatchObject({ reason: 'checklist_incomplete' })
  })

  it('rejects with no_path when path is null', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    const noPath = TenantOnboardingState.createDefault({
      id: 'id-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    })
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(noPath)
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(PASS_RESULT)

    await expect(
      advancePhase({
        restaurantId: RESTAURANT_ID,
        actor: ACTOR,
        repo,
        kpiEvaluator: evaluator,
      })
    ).rejects.toMatchObject({ reason: 'no_path' })
  })

  it('rejects with phase_terminal when phase is steady', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    const steady = TenantOnboardingState.fromProps({
      ...setupState().snapshot,
      phase: 'steady',
    })
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(steady)
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(PASS_RESULT)

    await expect(
      advancePhase({
        restaurantId: RESTAURANT_ID,
        actor: ACTOR,
        repo,
        kpiEvaluator: evaluator,
      })
    ).rejects.toMatchObject({ reason: 'phase_terminal' })
  })

  it('propagates ConcurrentAdvanceError from the repo', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(setupState())
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(PASS_RESULT)
    vi.mocked(repo.advance).mockRejectedValueOnce(new ConcurrentAdvanceError())

    await expect(
      advancePhase({
        restaurantId: RESTAURANT_ID,
        actor: ACTOR,
        repo,
        kpiEvaluator: evaluator,
      })
    ).rejects.toBeInstanceOf(ConcurrentAdvanceError)
  })

  it('does not call the KPI evaluator when path is missing (fast path)', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    const noPath = TenantOnboardingState.createDefault({
      id: 'id-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    })
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(noPath)

    await expect(
      advancePhase({
        restaurantId: RESTAURANT_ID,
        actor: ACTOR,
        repo,
        kpiEvaluator: evaluator,
      })
    ).rejects.toThrow(OnboardingAdvanceError)
    expect(evaluator.evaluate).not.toHaveBeenCalled()
  })

  it('does not call the KPI evaluator when phase is terminal', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    const steady = TenantOnboardingState.fromProps({
      ...setupState().snapshot,
      phase: 'steady',
    })
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(steady)

    await expect(
      advancePhase({
        restaurantId: RESTAURANT_ID,
        actor: ACTOR,
        repo,
        kpiEvaluator: evaluator,
      })
    ).rejects.toThrow(OnboardingAdvanceError)
    expect(evaluator.evaluate).not.toHaveBeenCalled()
  })
})
