import { describe, it, expect } from 'vitest'
import { routingFor, type OpsAlert, type AlertKind } from '../ops-alert'

function alert(
  kind: AlertKind,
  severity: OpsAlert['severity']
): OpsAlert {
  return {
    kind,
    severity,
    restaurantId: 'rest-1',
    message: `${kind}/${severity}`,
  }
}

describe('routingFor', () => {
  // CS team handles tenant-care: yellow transitions, opt-out spikes,
  // throttle spikes (impacts deliverability of CS team's tenants).
  it('quality_transition_yellow → cs', () => {
    expect(routingFor(alert('quality_transition_yellow', 'warn'))).toBe('cs')
  })

  it('quality_recovery_pending → cs (CS clears the auto-flag manually)', () => {
    expect(routingFor(alert('quality_recovery_pending', 'info'))).toBe('cs')
  })

  it('opt_out_spike → cs (campaign-level signal CS team owns)', () => {
    expect(routingFor(alert('opt_out_spike', 'warn'))).toBe('cs')
  })

  it('pmm_throttle_spike → cs (per-recipient throttle pattern)', () => {
    expect(routingFor(alert('pmm_throttle_spike', 'warn'))).toBe('cs')
  })

  // Platform team handles infrastructure / WABA-level / engineering issues.
  it('quality_transition_red → platform (paused account = platform escalation)', () => {
    expect(routingFor(alert('quality_transition_red', 'critical'))).toBe(
      'platform'
    )
  })

  it('auto_pause_triggered → platform', () => {
    expect(routingFor(alert('auto_pause_triggered', 'critical'))).toBe(
      'platform'
    )
  })

  it('waba_tier_change → platform (WABA-level event)', () => {
    expect(routingFor(alert('waba_tier_change', 'warn'))).toBe('platform')
  })

  it('engineering_alert → platform (unmapped/internal errors)', () => {
    expect(routingFor(alert('engineering_alert', 'error'))).toBe('platform')
  })

  // Policy violations: CS needs to know tenant content policy was hit so
  // they can warn the merchant; platform needs to investigate WABA risk.
  it('policy_violation → both', () => {
    expect(routingFor(alert('policy_violation', 'critical'))).toBe('both')
  })

  // block_template: CS may need to coach the tenant on template content
  // and platform owns template lifecycle.
  it('block_template → both', () => {
    expect(routingFor(alert('block_template', 'error'))).toBe('both')
  })
})
