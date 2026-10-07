import { describe, it, expect } from 'vitest'
import {
  CHECKLIST_KEYS,
  buildInitialChecklist,
  applyTick,
  applyUntick,
  isChecklistComplete,
  isChecklistKey,
  type PreKickoffChecklist,
} from '../pre-kickoff-checklist'

const TICKER = 'auth-user-1'
const NOW = '2026-05-04T10:00:00.000Z'

describe('CHECKLIST_KEYS', () => {
  it('exposes the six stable keys in playbook order', () => {
    expect(CHECKLIST_KEYS).toEqual([
      'hk_sim_never_used',
      'verified_meta_business',
      'display_name_draft_approved',
      'opt_in_source_documented',
      'vertical_allowed',
      'first_three_campaigns_drafted',
    ])
    expect(Object.isFrozen(CHECKLIST_KEYS)).toBe(true)
  })
})

describe('isChecklistKey', () => {
  it('accepts every canonical key', () => {
    for (const k of CHECKLIST_KEYS) expect(isChecklistKey(k)).toBe(true)
  })
  it('rejects anything else', () => {
    expect(isChecklistKey('foo')).toBe(false)
    expect(isChecklistKey('')).toBe(false)
    expect(isChecklistKey(null)).toBe(false)
  })
})

describe('buildInitialChecklist', () => {
  it('path A: every item starts checked=false, status=pending', () => {
    const c = buildInitialChecklist('A')
    for (const k of CHECKLIST_KEYS) {
      expect(c[k]).toEqual({
        checked: false,
        status: 'pending',
        checkedAt: null,
        checkedBy: null,
      })
    }
  })

  it.each(['B1', 'B2', 'B3'] as const)(
    'path %s: hk_sim_never_used is auto not_applicable + checked=true',
    (path) => {
      const c = buildInitialChecklist(path)
      expect(c.hk_sim_never_used).toEqual({
        checked: true,
        status: 'not_applicable',
        checkedAt: null,
        checkedBy: null,
      })
      // Other items remain pending
      expect(c.verified_meta_business.status).toBe('pending')
      expect(c.verified_meta_business.checked).toBe(false)
    }
  )

  it('null path: returns the same shape as path A', () => {
    const cA = buildInitialChecklist('A')
    const cNull = buildInitialChecklist(null)
    expect(cNull).toEqual(cA)
  })

  it('returns a frozen object so callers cannot mutate state in place', () => {
    const c = buildInitialChecklist('A')
    expect(Object.isFrozen(c)).toBe(true)
    expect(Object.isFrozen(c.hk_sim_never_used)).toBe(true)
  })
})

describe('applyTick', () => {
  it('ticks a pending item, recording checkedAt + checkedBy', () => {
    const c0 = buildInitialChecklist('A')
    const c1 = applyTick(c0, 'verified_meta_business', { actor: TICKER, now: NOW })
    expect(c1.verified_meta_business).toEqual({
      checked: true,
      status: 'pending',
      checkedAt: NOW,
      checkedBy: TICKER,
    })
    // Other items untouched
    expect(c1.opt_in_source_documented).toEqual(c0.opt_in_source_documented)
  })

  it('returns a new object and does not mutate the input', () => {
    const c0 = buildInitialChecklist('A')
    const c1 = applyTick(c0, 'verified_meta_business', { actor: TICKER, now: NOW })
    expect(c1).not.toBe(c0)
    expect(c0.verified_meta_business.checked).toBe(false)
  })

  it('is a no-op on not_applicable items (path B)', () => {
    const c0 = buildInitialChecklist('B1')
    const c1 = applyTick(c0, 'hk_sim_never_used', { actor: TICKER, now: NOW })
    expect(c1.hk_sim_never_used).toEqual(c0.hk_sim_never_used)
  })

  it('throws on unknown checklist key', () => {
    const c0 = buildInitialChecklist('A')
    expect(() =>
      applyTick(c0, 'not_a_key' as never, { actor: TICKER, now: NOW })
    ).toThrow(/checklist key/)
  })
})

describe('applyUntick', () => {
  it('unticks a previously ticked item, nulling checkedAt + checkedBy', () => {
    const c0 = buildInitialChecklist('A')
    const c1 = applyTick(c0, 'verified_meta_business', { actor: TICKER, now: NOW })
    const c2 = applyUntick(c1, 'verified_meta_business')
    expect(c2.verified_meta_business).toEqual({
      checked: false,
      status: 'pending',
      checkedAt: null,
      checkedBy: null,
    })
  })

  it('is a no-op on not_applicable items', () => {
    const c0 = buildInitialChecklist('B2')
    const c1 = applyUntick(c0, 'hk_sim_never_used')
    expect(c1.hk_sim_never_used).toEqual(c0.hk_sim_never_used)
  })
})

describe('isChecklistComplete', () => {
  function tickAll(c: PreKickoffChecklist): PreKickoffChecklist {
    let next = c
    for (const k of CHECKLIST_KEYS) next = applyTick(next, k, { actor: TICKER, now: NOW })
    return next
  }

  it('returns false on a freshly-built path A checklist', () => {
    expect(isChecklistComplete(buildInitialChecklist('A'))).toBe(false)
  })

  it('returns true when all six items are checked or N/A (path A all ticked)', () => {
    expect(isChecklistComplete(tickAll(buildInitialChecklist('A')))).toBe(true)
  })

  it('path B2: checked=true after ticking the remaining 5 (sim is N/A)', () => {
    let c = buildInitialChecklist('B2')
    for (const k of CHECKLIST_KEYS) {
      if (k === 'hk_sim_never_used') continue
      c = applyTick(c, k, { actor: TICKER, now: NOW })
    }
    expect(isChecklistComplete(c)).toBe(true)
  })

  it('one missing tick → incomplete', () => {
    let c = buildInitialChecklist('A')
    for (const k of CHECKLIST_KEYS) {
      if (k === 'first_three_campaigns_drafted') continue
      c = applyTick(c, k, { actor: TICKER, now: NOW })
    }
    expect(isChecklistComplete(c)).toBe(false)
  })
})
