import { describe, it, expect } from 'vitest'
import { TenantOnboardingState } from '../onboarding/tenant-onboarding-state'
import { buildInitialChecklist } from '@/domain/value-objects/pre-kickoff-checklist'
import {
  OnboardingAdvanceError,
  OnboardingPathLockedError,
  OnboardingPathRequiredError,
  OnboardingTerminalError,
} from '@/domain/services/__errors__/onboarding-errors'

const RESTAURANT_ID = 'rest-1'
const ACTOR = 'auth-user-1'
const NOW = '2026-05-04T10:00:00.000Z'

describe('TenantOnboardingState.createDefault', () => {
  it('produces phase=setup, path=null, six pending items, no advance pair', () => {
    const s = TenantOnboardingState.createDefault({
      id: 'tos-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    })
    expect(s.snapshot.phase).toBe('setup')
    expect(s.snapshot.onboardingPath).toBeNull()
    expect(s.snapshot.advancedAt).toBeNull()
    expect(s.snapshot.advancedBy).toBeNull()
    expect(s.snapshot.checklist).toEqual(buildInitialChecklist(null))
    expect(s.snapshot.createdAt).toBe(NOW)
    expect(s.snapshot.updatedAt).toBe(NOW)
  })
})

describe('TenantOnboardingState.fromProps', () => {
  it('round-trips a snapshot exactly', () => {
    const s = TenantOnboardingState.createDefault({
      id: 'tos-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    })
    const s2 = TenantOnboardingState.fromProps(s.snapshot)
    expect(s2.snapshot).toEqual(s.snapshot)
  })
})

describe('setPath', () => {
  function freshSetup(): TenantOnboardingState {
    return TenantOnboardingState.createDefault({
      id: 'tos-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    })
  }

  it('writes path and rebuilds the checklist', () => {
    const s = freshSetup().setPath('B1', NOW)
    expect(s.snapshot.onboardingPath).toBe('B1')
    expect(s.snapshot.checklist.hk_sim_never_used.status).toBe('not_applicable')
    expect(s.snapshot.checklist.hk_sim_never_used.checked).toBe(true)
  })

  it('bumps updatedAt to the supplied now', () => {
    const later = '2026-05-04T11:30:00.000Z'
    const s = freshSetup().setPath('A', later)
    expect(s.snapshot.updatedAt).toBe(later)
    // createdAt stays the original creation time
    expect(s.snapshot.createdAt).toBe(NOW)
  })

  it('preserves prior ticks for items unaffected by the path change', () => {
    let s = freshSetup().setPath('A', NOW)
    // Tick verified_meta_business under path A
    s = s.tickChecklist('verified_meta_business', ACTOR, NOW)
    // Switch to B2 (still in setup); the unaffected tick survives
    const s2 = s.setPath('B2', NOW)
    expect(s2.snapshot.checklist.verified_meta_business.checked).toBe(true)
    expect(s2.snapshot.checklist.verified_meta_business.checkedBy).toBe(ACTOR)
    // hk_sim flips to N/A
    expect(s2.snapshot.checklist.hk_sim_never_used.status).toBe('not_applicable')
  })

  it('rejects path change after phase has advanced beyond setup', () => {
    let s = freshSetup().setPath('A', NOW)
    for (const k of [
      'hk_sim_never_used',
      'verified_meta_business',
      'display_name_draft_approved',
      'opt_in_source_documented',
      'vertical_allowed',
      'first_three_campaigns_drafted',
    ] as const) {
      s = s.tickChecklist(k, ACTOR, NOW)
    }
    s = s.advance({ kpiPass: true, expectedFrom: 'setup', actor: ACTOR, now: NOW })
    expect(() => s.setPath('B1', NOW)).toThrow(OnboardingPathLockedError)
  })
})

describe('tickChecklist / untickChecklist', () => {
  it('mutates the addressed item only', () => {
    const s0 = TenantOnboardingState.createDefault({
      id: 'tos-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    }).setPath('A', NOW)
    const s1 = s0.tickChecklist('verified_meta_business', ACTOR, NOW)
    expect(s1.snapshot.checklist.verified_meta_business.checked).toBe(true)
    expect(s1.snapshot.checklist.opt_in_source_documented.checked).toBe(false)
    expect(s1.snapshot.updatedAt).toBe(NOW)
  })

  it('untick after tick clears checkedAt/checkedBy', () => {
    let s = TenantOnboardingState.createDefault({
      id: 'tos-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    }).setPath('A', NOW)
    s = s.tickChecklist('vertical_allowed', ACTOR, NOW)
    s = s.untickChecklist('vertical_allowed', NOW)
    expect(s.snapshot.checklist.vertical_allowed).toEqual({
      checked: false,
      status: 'pending',
      checkedAt: null,
      checkedBy: null,
    })
  })

  it('tick on N/A item is a no-op', () => {
    const s0 = TenantOnboardingState.createDefault({
      id: 'tos-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    }).setPath('B3', NOW)
    const s1 = s0.tickChecklist('hk_sim_never_used', ACTOR, NOW)
    expect(s1.snapshot.checklist.hk_sim_never_used).toEqual(
      s0.snapshot.checklist.hk_sim_never_used
    )
  })
})

describe('advance', () => {
  function setupWithCompletedChecklist(): TenantOnboardingState {
    let s = TenantOnboardingState.createDefault({
      id: 'tos-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    }).setPath('A', NOW)
    for (const k of [
      'hk_sim_never_used',
      'verified_meta_business',
      'display_name_draft_approved',
      'opt_in_source_documented',
      'vertical_allowed',
      'first_three_campaigns_drafted',
    ] as const) {
      s = s.tickChecklist(k, ACTOR, NOW)
    }
    return s
  }

  it('setup -> probe requires checklist complete + kpiPass', () => {
    const s = setupWithCompletedChecklist().advance({
      kpiPass: true,
      expectedFrom: 'setup',
      actor: ACTOR,
      now: NOW,
    })
    expect(s.snapshot.phase).toBe('probe')
    expect(s.snapshot.advancedAt).toBe(NOW)
    expect(s.snapshot.advancedBy).toBe(ACTOR)
  })

  it('setup -> probe rejects when checklist incomplete', () => {
    const incomplete = TenantOnboardingState.createDefault({
      id: 'tos-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    }).setPath('A', NOW)
    expect(() =>
      incomplete.advance({
        kpiPass: true,
        expectedFrom: 'setup',
        actor: ACTOR,
        now: NOW,
      })
    ).toThrowError(OnboardingAdvanceError)
  })

  it('setup -> probe rejects when kpi did not pass', () => {
    const ready = setupWithCompletedChecklist()
    try {
      ready.advance({
        kpiPass: false,
        expectedFrom: 'setup',
        actor: ACTOR,
        now: NOW,
      })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(OnboardingAdvanceError)
      expect((e as OnboardingAdvanceError).reason).toBe('kpi_failed')
    }
  })

  it('rejects advance when path is null', () => {
    const s = TenantOnboardingState.createDefault({
      id: 'tos-1',
      restaurantId: RESTAURANT_ID,
      now: NOW,
    })
    expect(() =>
      s.advance({
        kpiPass: true,
        expectedFrom: 'setup',
        actor: ACTOR,
        now: NOW,
      })
    ).toThrow(OnboardingPathRequiredError)
  })

  it('post-setup transitions only require kpiPass (no checklist re-check)', () => {
    let s = setupWithCompletedChecklist()
    s = s.advance({ kpiPass: true, expectedFrom: 'setup', actor: ACTOR, now: NOW })
    s = s.advance({ kpiPass: true, expectedFrom: 'probe', actor: ACTOR, now: NOW })
    expect(s.snapshot.phase).toBe('build')
  })

  it('rejects when expectedFrom does not match current phase', () => {
    const ready = setupWithCompletedChecklist()
    try {
      ready.advance({
        kpiPass: true,
        expectedFrom: 'probe',
        actor: ACTOR,
        now: NOW,
      })
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(OnboardingAdvanceError)
      expect((e as OnboardingAdvanceError).reason).toBe('illegal_transition')
    }
  })

  it('rejects advancing from steady (terminal)', () => {
    let s = setupWithCompletedChecklist()
    s = s.advance({ kpiPass: true, expectedFrom: 'setup', actor: ACTOR, now: NOW })
    s = s.advance({ kpiPass: true, expectedFrom: 'probe', actor: ACTOR, now: NOW })
    s = s.advance({ kpiPass: true, expectedFrom: 'build', actor: ACTOR, now: NOW })
    s = s.advance({ kpiPass: true, expectedFrom: 'scale', actor: ACTOR, now: NOW })
    s = s.advance({ kpiPass: true, expectedFrom: 'full', actor: ACTOR, now: NOW })
    expect(s.snapshot.phase).toBe('steady')
    expect(() =>
      s.advance({
        kpiPass: true,
        expectedFrom: 'steady',
        actor: ACTOR,
        now: NOW,
      })
    ).toThrow(OnboardingTerminalError)
  })
})
