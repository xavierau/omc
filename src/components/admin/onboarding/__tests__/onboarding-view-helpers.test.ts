import { describe, it, expect } from 'vitest'
import type {
  KpiGateView,
  OnboardingStateView,
} from '@/hooks/use-admin-tenant-onboarding'
import {
  blockedReasonI18nKey,
  isPathSelectorDisabled,
  isChecklistItemInteractive,
  kpiTileVariant,
  phaseStepStatus,
} from '@/components/admin/onboarding/onboarding-view-helpers'
import { ONBOARDING_PHASES } from '@/domain/value-objects/onboarding-phase'

const baseView: OnboardingStateView = {
  restaurantId: 'r1',
  path: 'A',
  phase: 'setup',
  checklist: {
    hk_sim_never_used: { checked: true, status: 'pending', checkedAt: '2026-01-01', checkedBy: 'u' },
    verified_meta_business: { checked: true, status: 'pending', checkedAt: '2026-01-01', checkedBy: 'u' },
    display_name_draft_approved: { checked: true, status: 'pending', checkedAt: '2026-01-01', checkedBy: 'u' },
    opt_in_source_documented: { checked: true, status: 'pending', checkedAt: '2026-01-01', checkedBy: 'u' },
    vertical_allowed: { checked: true, status: 'pending', checkedAt: '2026-01-01', checkedBy: 'u' },
    first_three_campaigns_drafted: { checked: true, status: 'pending', checkedAt: '2026-01-01', checkedBy: 'u' },
  },
  kpiGate: { status: 'pass', deliveryRate: 0.97, optOutRate: 0.01, sampleSize: 200 },
  checklistComplete: true,
  nextPhase: 'probe',
  canAdvance: true,
  blockedReasons: [],
}

describe('isPathSelectorDisabled', () => {
  it('enabled when phase is setup', () => {
    expect(isPathSelectorDisabled('setup')).toBe(false)
  })
  it.each(ONBOARDING_PHASES.filter((p) => p !== 'setup'))(
    'disabled when phase is %s',
    (phase) => {
      expect(isPathSelectorDisabled(phase)).toBe(true)
    }
  )
})

describe('isChecklistItemInteractive', () => {
  it('false for not_applicable items', () => {
    expect(
      isChecklistItemInteractive({
        checked: true,
        status: 'not_applicable',
        checkedAt: null,
        checkedBy: null,
      })
    ).toBe(false)
  })
  it('true for pending items', () => {
    expect(
      isChecklistItemInteractive({
        checked: false,
        status: 'pending',
        checkedAt: null,
        checkedBy: null,
      })
    ).toBe(true)
  })
})

describe('phaseStepStatus', () => {
  it('returns current for the current phase', () => {
    expect(phaseStepStatus({ ...baseView, phase: 'probe' }, 'probe')).toBe('current')
  })
  it('returns done for prior phases', () => {
    expect(phaseStepStatus({ ...baseView, phase: 'build' }, 'setup')).toBe('done')
    expect(phaseStepStatus({ ...baseView, phase: 'build' }, 'probe')).toBe('done')
  })
  it('returns upcoming for later phases', () => {
    expect(phaseStepStatus({ ...baseView, phase: 'setup' }, 'probe')).toBe('upcoming')
    expect(phaseStepStatus({ ...baseView, phase: 'setup' }, 'steady')).toBe('upcoming')
  })
})

describe('kpiTileVariant', () => {
  it('marks delivery as pass when overall status is pass', () => {
    const gate: KpiGateView = {
      status: 'pass',
      deliveryRate: 0.97,
      optOutRate: 0.01,
      sampleSize: 150,
    }
    expect(kpiTileVariant(gate, 'delivery')).toBe('pass')
    expect(kpiTileVariant(gate, 'opt_out')).toBe('pass')
  })
  it('marks the failing metric as fail and the other as pass', () => {
    const gate: KpiGateView = {
      status: 'fail',
      deliveryRate: 0.9,
      optOutRate: 0.005,
      sampleSize: 200,
      failingMetrics: ['delivery'],
    }
    expect(kpiTileVariant(gate, 'delivery')).toBe('fail')
    expect(kpiTileVariant(gate, 'opt_out')).toBe('pass')
  })
  it('marks both as insufficient when status is insufficient', () => {
    const gate: KpiGateView = { status: 'insufficient', observed: 12, required: 100 }
    expect(kpiTileVariant(gate, 'delivery')).toBe('insufficient')
    expect(kpiTileVariant(gate, 'opt_out')).toBe('insufficient')
  })
})

describe('blockedReasonI18nKey', () => {
  it.each([
    ['checklist_incomplete' as const, 'advance.disabledReason.checklist_incomplete'],
    ['kpi_failed' as const, 'advance.disabledReason.kpi_failed'],
    ['kpi_insufficient' as const, 'advance.disabledReason.kpi_insufficient'],
    ['phase_terminal' as const, 'advance.disabledReason.phase_terminal'],
    ['no_path' as const, 'advance.disabledReason.no_path'],
  ])('maps %s to %s', (reason, key) => {
    expect(blockedReasonI18nKey(reason)).toBe(key)
  })
})
