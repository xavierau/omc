import { describe, it, expect } from 'vitest'
import { buildQualityAlerts } from '../notify-quality-action'
import type { QualityAction } from '@/domain/value-objects/quality-action'

const INPUT = {
  restaurantId: 'rest-1',
  prevRating: 'GREEN' as const,
  nextRating: 'YELLOW' as const,
}

describe('buildQualityAlerts', () => {
  it('throttle action → 1 alert: quality_transition_yellow / warn', () => {
    const action: QualityAction = {
      kind: 'throttle',
      factor: 0.5,
      reason: 'quality_yellow_throttle',
    }
    const alerts = buildQualityAlerts(INPUT, action)
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      kind: 'quality_transition_yellow',
      severity: 'warn',
      restaurantId: 'rest-1',
    })
    expect(alerts[0].details).toMatchObject({
      prevRating: 'GREEN',
      nextRating: 'YELLOW',
    })
  })

  it('pause action → 2 alerts: quality_transition_red + auto_pause_triggered', () => {
    const action: QualityAction = {
      kind: 'pause',
      reason: 'quality_red_auto',
    }
    const alerts = buildQualityAlerts(
      { restaurantId: 'rest-1', prevRating: 'YELLOW', nextRating: 'RED' },
      action
    )
    expect(alerts.map((a) => a.kind)).toEqual([
      'quality_transition_red',
      'auto_pause_triggered',
    ])
    expect(alerts.every((a) => a.severity === 'critical')).toBe(true)
  })

  it('manual_recovery_required → 1 alert: quality_recovery_pending / info', () => {
    const action: QualityAction = { kind: 'manual_recovery_required' }
    const alerts = buildQualityAlerts(
      { restaurantId: 'rest-1', prevRating: 'YELLOW', nextRating: 'GREEN' },
      action
    )
    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      kind: 'quality_recovery_pending',
      severity: 'info',
    })
  })

  it('no_op → empty (no notification)', () => {
    const action: QualityAction = { kind: 'no_op' }
    expect(buildQualityAlerts(INPUT, action)).toEqual([])
  })

  it('uses null prev gracefully in message', () => {
    const action: QualityAction = {
      kind: 'throttle',
      factor: 0.5,
      reason: 'quality_yellow_throttle',
    }
    const alerts = buildQualityAlerts(
      { restaurantId: 'rest-1', prevRating: null, nextRating: 'YELLOW' },
      action
    )
    expect(alerts[0].message).toContain('null')
  })
})
