import { describe, it, expect, vi, beforeEach } from 'vitest'

const sendSpy = vi.fn()

vi.mock('@/infrastructure/notifications/slack-notifier', () => ({
  createSlackNotifier: () => ({ send: sendSpy }),
}))

import { notifyOpsAlert } from '../notify-ops-alert'
import type { OpsAlert } from '@/domain/value-objects/ops-alert'

beforeEach(() => {
  sendSpy.mockReset()
  sendSpy.mockResolvedValue(undefined)
})

function build(overrides: Partial<OpsAlert> = {}): OpsAlert {
  return {
    kind: 'quality_transition_red',
    severity: 'critical',
    restaurantId: 'rest-1',
    message: 'Tenant flipped to RED',
    ...overrides,
  }
}

describe('notifyOpsAlert', () => {
  it('routes platform-only alerts to platform channel ONLY', async () => {
    await notifyOpsAlert(
      build({ kind: 'quality_transition_red', severity: 'critical' })
    )
    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'platform' })
    )
  })

  it('routes cs-only alerts to cs channel ONLY', async () => {
    await notifyOpsAlert(
      build({ kind: 'quality_transition_yellow', severity: 'warn' })
    )
    expect(sendSpy).toHaveBeenCalledTimes(1)
    expect(sendSpy).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'cs' })
    )
  })

  it('routes "both" alerts to BOTH channels', async () => {
    await notifyOpsAlert(
      build({ kind: 'policy_violation', severity: 'critical' })
    )
    expect(sendSpy).toHaveBeenCalledTimes(2)
    const channels = sendSpy.mock.calls.map((c) => c[0].channel).sort()
    expect(channels).toEqual(['cs', 'platform'])
  })

  it('one channel failing does NOT prevent the other (both)', async () => {
    sendSpy
      .mockRejectedValueOnce(new Error('cs slack down'))
      .mockResolvedValueOnce(undefined)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      notifyOpsAlert(
        build({ kind: 'policy_violation', severity: 'critical' })
      )
    ).resolves.toBeUndefined()

    expect(sendSpy).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('NEVER throws even if every channel fails', async () => {
    sendSpy.mockRejectedValue(new Error('all slack down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      notifyOpsAlert(build({ kind: 'block_template', severity: 'error' }))
    ).resolves.toBeUndefined()
    warnSpy.mockRestore()
  })

  it('passes the alert through unchanged to the slack notifier', async () => {
    const alert = build({
      kind: 'auto_pause_triggered',
      severity: 'critical',
      restaurantName: 'Cafe Latte',
      message: 'Auto-paused due to RED',
      details: { prevRating: 'YELLOW', nextRating: 'RED' },
    })
    await notifyOpsAlert(alert)
    expect(sendSpy).toHaveBeenCalledWith({ channel: 'platform', alert })
  })
})
