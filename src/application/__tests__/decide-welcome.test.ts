// INT-001 WI-3: frozen acceptance suite for `decideWelcome` (spec US-4,
// plan §"Member-create job (worker)" step 6). Table-driven over every named
// `skipped_*` reason plus the `queued` path.

import { describe, expect, it } from 'vitest'
import { decideWelcome, type DecideWelcomeInput, type WelcomeDecision } from '../decide-welcome'

const BASE: DecideWelcomeInput = {
  memberOutcome: 'created',
  sendWelcomeRequested: true,
  newJoinTemplateId: 'default',
  memberStatus: 'active',
  template: { found: true, templateId: 'tpl-1', category: 'MARKETING' },
  categoryStatus: 'opted_in',
  effectiveLevel: 'all',
  tenantAutoPaused: false,
  hourlyCapExceeded: false,
}

function decision(overrides: Partial<DecideWelcomeInput>): WelcomeDecision {
  return decideWelcome({ ...BASE, ...overrides })
}

describe('decideWelcome (INT-001 WI-3, D3-D5/T-H8)', () => {
  it('existing member -> skipped_existing (D1), regardless of everything else', () => {
    expect(decision({ memberOutcome: 'existing' })).toEqual({ outcome: 'skipped_existing' })
  })

  it('send_welcome:false -> skipped_by_request (D5), even with a template configured', () => {
    expect(decision({ sendWelcomeRequested: false })).toEqual({ outcome: 'skipped_by_request' })
  })

  it('new_join_template_id null -> skipped_off (OD-3 default)', () => {
    expect(decision({ newJoinTemplateId: null })).toEqual({ outcome: 'skipped_off' })
  })

  it('member unsubscribed -> skipped_opted_out, without needing template resolution', () => {
    expect(decision({ memberStatus: 'unsubscribed', template: { found: false } })).toEqual({
      outcome: 'skipped_opted_out',
    })
  })

  it('resolved template missing/not approved/foreign -> skipped_no_template', () => {
    expect(decision({ template: { found: false } })).toEqual({ outcome: 'skipped_no_template' })
  })

  it('template category latest opted_out -> skipped_opted_out (STOP between create and consent write)', () => {
    expect(decision({ categoryStatus: 'opted_out' })).toEqual({ outcome: 'skipped_opted_out' })
  })

  it('marketing template + utility level -> skipped_consent_level {required_level: all, effective_level: utility}', () => {
    expect(
      decision({
        template: { found: true, templateId: 'tpl-1', category: 'MARKETING' },
        effectiveLevel: 'utility',
        categoryStatus: 'pending',
      })
    ).toEqual({ outcome: 'skipped_consent_level', requiredLevel: 'all', effectiveLevel: 'utility' })
  })

  it('utility template + none level -> skipped_consent_level {required_level: utility, effective_level: none}', () => {
    expect(
      decision({
        template: { found: true, templateId: 'tpl-2', category: 'UTILITY' },
        effectiveLevel: 'none',
        categoryStatus: 'pending',
      })
    ).toEqual({ outcome: 'skipped_consent_level', requiredLevel: 'utility', effectiveLevel: 'none' })
  })

  it('utility template + utility level -> sent (queued), not skipped', () => {
    expect(
      decision({
        template: { found: true, templateId: 'tpl-2', category: 'UTILITY' },
        effectiveLevel: 'utility',
        categoryStatus: 'opted_in',
      })
    ).toEqual({ outcome: 'queued', templateId: 'tpl-2', category: 'UTILITY' })
  })

  it('tenant quality-paused -> skipped_quality_paused, checked after the consent-level gate', () => {
    expect(decision({ tenantAutoPaused: true })).toEqual({ outcome: 'skipped_quality_paused' })
  })

  it('hourly cap exceeded -> skipped_rate_capped, checked last', () => {
    expect(decision({ hourlyCapExceeded: true })).toEqual({ outcome: 'skipped_rate_capped' })
  })

  it('every gate open -> queued with the resolved template id and category', () => {
    expect(decision({})).toEqual({ outcome: 'queued', templateId: 'tpl-1', category: 'MARKETING' })
  })

  // Invariant: precedence order matches the plan's dependency-respecting
  // reading -- member-level checks (existing/by_request/off/unsubscribed)
  // always win over template/consent/quality checks, whatever those say.
  it('precedence: skipped_existing wins even when every other gate would also fail', () => {
    expect(
      decision({
        memberOutcome: 'existing',
        sendWelcomeRequested: false,
        newJoinTemplateId: null,
        memberStatus: 'unsubscribed',
        template: { found: false },
        tenantAutoPaused: true,
        hourlyCapExceeded: true,
      })
    ).toEqual({ outcome: 'skipped_existing' })
  })
})
