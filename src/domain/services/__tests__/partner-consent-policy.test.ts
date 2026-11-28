// INT-001 WI-1 frozen acceptance suite (T-C1 / OD-14).
// Source: plan §WI-1 Tests(first) -- "applyPartnerAssertedConsent table over
// {no row, pending, opted_in, opted_out latest, opted_out-then-opted_in
// latest} x {none, utility, all} x {utility, marketing} -> exact action +
// resulting rows (invariant test: after any sequence, a latest-opted_out
// category has zero newer rows from partner_api)".
//
// "opted_out-then-opted_in latest" collapses to latestStatus='opted_in' for
// this pure function (only the LATEST row's status is the input), and is
// covered by the opted_in case below -- the history itself is exercised at
// the repository/scratch-DB layer (see consent-record-repository.test.ts and
// the migration 072 trigger test).

import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import type { ConsentStatus } from '@/domain/value-objects/consent-status'
import type { ConsentLevel } from '@/domain/value-objects/consent-level'
import { covers, type PartnerConsentCategory } from '@/domain/value-objects/consent-level'
import {
  decidePartnerConsentAction,
  insertedRowStatus,
} from '../partner-consent-policy'

const LATEST_STATUSES: (ConsentStatus | null)[] = [null, 'pending', 'opted_in', 'opted_out']
const LEVELS: ConsentLevel[] = ['none', 'utility', 'all']
const CATEGORIES: PartnerConsentCategory[] = ['utility', 'marketing']

describe('decidePartnerConsentAction', () => {
  it('opted_out is absorbing regardless of level or category', () => {
    for (const level of LEVELS) {
      for (const category of CATEGORIES) {
        expect(decidePartnerConsentAction('opted_out', level, category)).toBe(
          'blocked_opted_out'
        )
      }
    }
  })

  it('opted_in is never touched (noop) regardless of level or category', () => {
    for (const level of LEVELS) {
      for (const category of CATEGORIES) {
        expect(decidePartnerConsentAction('opted_in', level, category)).toBe('noop')
      }
    }
  })

  it('no row (null) always inserts', () => {
    for (const level of LEVELS) {
      for (const category of CATEGORIES) {
        expect(decidePartnerConsentAction(null, level, category)).toBe('inserted')
      }
    }
  })

  it('pending upgrades only when the level covers the category, else noop', () => {
    const table: Array<[ConsentLevel, PartnerConsentCategory, 'upgraded' | 'noop']> = [
      ['none', 'utility', 'noop'],
      ['none', 'marketing', 'noop'],
      ['utility', 'utility', 'upgraded'],
      ['utility', 'marketing', 'noop'],
      ['all', 'utility', 'upgraded'],
      ['all', 'marketing', 'upgraded'],
    ]
    for (const [level, category, expected] of table) {
      expect(decidePartnerConsentAction('pending', level, category)).toBe(expected)
    }
  })

  it('exhaustive table: every (latestStatus, level, category) combination is asserted', () => {
    // Full cross product from the plan's Tests(first) spec, printed as a
    // table so a future regression shows exactly which cell broke.
    for (const latestStatus of LATEST_STATUSES) {
      for (const level of LEVELS) {
        for (const category of CATEGORIES) {
          const action = decidePartnerConsentAction(latestStatus, level, category)
          if (latestStatus === 'opted_out') {
            expect(action).toBe('blocked_opted_out')
          } else if (latestStatus === 'opted_in') {
            expect(action).toBe('noop')
          } else if (latestStatus === null) {
            expect(action).toBe('inserted')
          } else {
            expect(action).toBe(covers(level, category) ? 'upgraded' : 'noop')
          }
        }
      }
    }
  })

  it('invariant (fast-check): opted_out never produces a write action', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...LEVELS),
        fc.constantFrom(...CATEGORIES),
        (level, category) => {
          const action = decidePartnerConsentAction('opted_out', level, category)
          expect(action).not.toBe('inserted')
          expect(action).not.toBe('upgraded')
        }
      )
    )
  })

  it('invariant (fast-check): a non-opted_out latest status never returns blocked_opted_out', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<ConsentStatus | null>(null, 'pending', 'opted_in'),
        fc.constantFrom(...LEVELS),
        fc.constantFrom(...CATEGORIES),
        (latestStatus, level, category) => {
          expect(decidePartnerConsentAction(latestStatus, level, category)).not.toBe(
            'blocked_opted_out'
          )
        }
      )
    )
  })
})

describe('insertedRowStatus', () => {
  it('is opted_in exactly when the level covers the category', () => {
    for (const level of LEVELS) {
      for (const category of CATEGORIES) {
        const expected = covers(level, category) ? 'opted_in' : 'pending'
        expect(insertedRowStatus(level, category)).toBe(expected)
      }
    }
  })
})
