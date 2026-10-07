import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TenantOnboardingState } from '@/domain/entities/onboarding/tenant-onboarding-state'
import { CHECKLIST_KEYS } from '@/domain/value-objects/pre-kickoff-checklist'
import type { TenantOnboardingStateRepository } from '@/domain/repositories/tenant-onboarding-state-repository'
import type { KpiGateEvaluator } from '@/domain/ports/kpi-gate-evaluator'
import { getOnboardingState } from '../get-onboarding-state'

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
  kpis: { ...PASS_RESULT.kpis, totalSends: 35 },
}

function setupCompleteState() {
  let state = TenantOnboardingState.createDefault({
    id: 'id-1',
    restaurantId: RESTAURANT_ID,
    now: NOW,
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

describe('getOnboardingState', () => {
  it('auto-initializes when no row exists, returning the default view', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(null)
    vi.mocked(repo.insert).mockResolvedValueOnce(undefined)
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(INSUFFICIENT_RESULT)

    const view = await getOnboardingState({
      restaurantId: RESTAURANT_ID,
      repo,
      kpiEvaluator: evaluator,
    })

    expect(repo.insert).toHaveBeenCalled()
    expect(view.restaurantId).toBe(RESTAURANT_ID)
    expect(view.phase).toBe('setup')
    expect(view.path).toBeNull()
    expect(view.canAdvance).toBe(false)
    expect(view.blockedReasons).toContain('no_path')
    expect(view.kpiGate).toEqual({ status: 'insufficient', observed: 35, required: 100 })
  })

  it('returns canAdvance=true when checklist complete + KPI pass + path set', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(setupCompleteState())
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(PASS_RESULT)

    const view = await getOnboardingState({
      restaurantId: RESTAURANT_ID,
      repo,
      kpiEvaluator: evaluator,
    })

    expect(view.canAdvance).toBe(true)
    expect(view.blockedReasons).toEqual([])
    expect(view.checklistComplete).toBe(true)
    expect(view.nextPhase).toBe('probe')
    expect(view.kpiGate).toEqual({
      status: 'pass',
      deliveryRate: 0.975,
      optOutRate: 0.005,
      sampleSize: 200,
    })
  })

  it('blocks with checklist_incomplete when an item is unchecked', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    const state = TenantOnboardingState.createDefault({
      id: 'id-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    }).setPath('A', NOW)
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(state)
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(PASS_RESULT)

    const view = await getOnboardingState({
      restaurantId: RESTAURANT_ID,
      repo,
      kpiEvaluator: evaluator,
    })

    expect(view.canAdvance).toBe(false)
    expect(view.blockedReasons).toContain('checklist_incomplete')
  })

  it('blocks with kpi_failed and surfaces failingMetrics in the view', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(setupCompleteState())
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(FAIL_RESULT)

    const view = await getOnboardingState({
      restaurantId: RESTAURANT_ID,
      repo,
      kpiEvaluator: evaluator,
    })

    expect(view.canAdvance).toBe(false)
    expect(view.blockedReasons).toContain('kpi_failed')
    expect(view.kpiGate).toMatchObject({
      status: 'fail',
      failingMetrics: ['delivery'],
    })
  })

  it('blocks with kpi_insufficient when sample size too low', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(setupCompleteState())
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(INSUFFICIENT_RESULT)

    const view = await getOnboardingState({
      restaurantId: RESTAURANT_ID,
      repo,
      kpiEvaluator: evaluator,
    })

    expect(view.canAdvance).toBe(false)
    expect(view.blockedReasons).toContain('kpi_insufficient')
    expect(view.kpiGate).toEqual({ status: 'insufficient', observed: 35, required: 100 })
  })

  it('reports phase_terminal and nextPhase=null when phase=steady', async () => {
    const repo = makeRepo()
    const evaluator = makeEvaluator()
    const steady = TenantOnboardingState.fromProps({
      ...setupCompleteState().snapshot,
      phase: 'steady',
    })
    vi.mocked(repo.findByRestaurantId).mockResolvedValueOnce(steady)
    vi.mocked(evaluator.evaluate).mockResolvedValueOnce(PASS_RESULT)

    const view = await getOnboardingState({
      restaurantId: RESTAURANT_ID,
      repo,
      kpiEvaluator: evaluator,
    })

    expect(view.canAdvance).toBe(false)
    expect(view.nextPhase).toBeNull()
    expect(view.blockedReasons).toContain('phase_terminal')
  })
})
