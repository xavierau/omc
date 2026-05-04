import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/quality-auto-flags', () => ({
  applyAutoThrottle: vi.fn().mockResolvedValue(undefined),
  applyAutoPause: vi.fn().mockResolvedValue(undefined),
  clearAutoQualityFlags: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/infrastructure/supabase/repositories/event-repository', () => ({
  createEvent: vi.fn().mockResolvedValue('evt-1'),
}))

vi.mock('@/application/notify-ops-alert', () => ({
  notifyOpsAlert: vi.fn().mockResolvedValue(undefined),
}))

import { dispatchQualityAction } from '../dispatch-quality-action'
import {
  applyAutoThrottle,
  applyAutoPause,
} from '@/infrastructure/supabase/repositories/quality-auto-flags'
import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { notifyOpsAlert } from '@/application/notify-ops-alert'

const mockThrottle = vi.mocked(applyAutoThrottle)
const mockPause = vi.mocked(applyAutoPause)
const mockCreateEvent = vi.mocked(createEvent)
const mockNotify = vi.mocked(notifyOpsAlert)

const log = vi.fn()

beforeEach(() => {
  mockThrottle.mockClear()
  mockPause.mockClear()
  mockCreateEvent.mockClear()
  mockNotify.mockClear()
  log.mockClear()
})

const RESTAURANT_ID = 'rest-1'

describe('dispatchQualityAction', () => {
  it('GREEN -> YELLOW: calls applyAutoThrottle(0.5) and logs', async () => {
    await dispatchQualityAction({
      restaurantId: RESTAURANT_ID,
      prevRating: 'GREEN',
      nextRating: 'YELLOW',
      log,
    })
    expect(mockThrottle).toHaveBeenCalledWith(RESTAURANT_ID, 0.5)
    expect(mockPause).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'info',
      'webhook.quality_action',
      expect.objectContaining({ kind: 'throttle', factor: 0.5 })
    )
  })

  it('GREEN -> RED: calls applyAutoPause with quality_red_auto', async () => {
    await dispatchQualityAction({
      restaurantId: RESTAURANT_ID,
      prevRating: 'GREEN',
      nextRating: 'RED',
      log,
    })
    expect(mockPause).toHaveBeenCalledWith(RESTAURANT_ID, 'quality_red_auto')
    expect(mockThrottle).not.toHaveBeenCalled()
  })

  it('null prev + RED: pauses (first-ever event)', async () => {
    await dispatchQualityAction({
      restaurantId: RESTAURANT_ID,
      prevRating: null,
      nextRating: 'RED',
      log,
    })
    expect(mockPause).toHaveBeenCalledWith(RESTAURANT_ID, 'quality_red_auto')
  })

  it('YELLOW -> GREEN (recovery): emits ops alert, does NOT clear pause', async () => {
    await dispatchQualityAction({
      restaurantId: RESTAURANT_ID,
      prevRating: 'YELLOW',
      nextRating: 'GREEN',
      log,
    })
    expect(mockPause).not.toHaveBeenCalled()
    expect(mockThrottle).not.toHaveBeenCalled()
    expect(mockCreateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        type: 'quality_recovery_pending',
        dataJson: expect.objectContaining({
          prevRating: 'YELLOW',
          nextRating: 'GREEN',
        }),
      })
    )
    expect(log).toHaveBeenCalledWith(
      'info',
      'webhook.quality_action',
      expect.objectContaining({ kind: 'manual_recovery_required' })
    )
  })

  it('RED -> GREEN (recovery): emits ops alert', async () => {
    await dispatchQualityAction({
      restaurantId: RESTAURANT_ID,
      prevRating: 'RED',
      nextRating: 'GREEN',
      log,
    })
    expect(mockCreateEvent).toHaveBeenCalled()
  })

  it('GREEN -> GREEN: no-op (no repo writes, no events)', async () => {
    await dispatchQualityAction({
      restaurantId: RESTAURANT_ID,
      prevRating: 'GREEN',
      nextRating: 'GREEN',
      log,
    })
    expect(mockPause).not.toHaveBeenCalled()
    expect(mockThrottle).not.toHaveBeenCalled()
    expect(mockCreateEvent).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      'info',
      'webhook.quality_action',
      expect.objectContaining({ kind: 'no_op' })
    )
  })

  it('YELLOW -> YELLOW: no-op (does not re-throttle)', async () => {
    await dispatchQualityAction({
      restaurantId: RESTAURANT_ID,
      prevRating: 'YELLOW',
      nextRating: 'YELLOW',
      log,
    })
    expect(mockThrottle).not.toHaveBeenCalled()
  })

  it('RED -> YELLOW: stays paused (idempotent pause), does not throttle', async () => {
    await dispatchQualityAction({
      restaurantId: RESTAURANT_ID,
      prevRating: 'RED',
      nextRating: 'YELLOW',
      log,
    })
    expect(mockPause).toHaveBeenCalledWith(RESTAURANT_ID, 'quality_red_auto')
    expect(mockThrottle).not.toHaveBeenCalled()
  })

  it('recovery_required: continues even if event insert throws', async () => {
    mockCreateEvent.mockRejectedValueOnce(new Error('events down'))
    await expect(
      dispatchQualityAction({
        restaurantId: RESTAURANT_ID,
        prevRating: 'RED',
        nextRating: 'GREEN',
        log,
      })
    ).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith(
      'warn',
      'webhook.quality_action_event_insert_failed',
      expect.objectContaining({ error: 'events down' })
    )
  })

  // WAQ-009 round-1 review (CRITICAL): the dispatcher's call into
  // applyAutoThrottle / applyAutoPause MUST be wrapped in try/catch.
  // If an uncaught throw bubbled to the webhook handler, the idempotency
  // key has already been claimed, so Kapso's retry would be deduped as
  // 'duplicate' and the auto-flag write would be permanently lost.
  it('logs and swallows when applyAutoPause throws (CRITICAL)', async () => {
    mockPause.mockRejectedValueOnce(new Error('supabase 503'))
    await expect(
      dispatchQualityAction({
        restaurantId: RESTAURANT_ID,
        prevRating: 'GREEN',
        nextRating: 'RED',
        log,
      })
    ).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith(
      'error',
      'webhook.quality_action_failed',
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        action: 'pause',
        prevRating: 'GREEN',
        nextRating: 'RED',
        error: 'supabase 503',
      })
    )
    // WAQ-013 r1 nit fix: info log only fires on successful apply so a
    // failed transition doesn't muddy the action telemetry.
    expect(log).not.toHaveBeenCalledWith(
      'info',
      'webhook.quality_action',
      expect.anything()
    )
  })

  it('logs and swallows when applyAutoThrottle throws (CRITICAL)', async () => {
    mockThrottle.mockRejectedValueOnce(new Error('connection reset'))
    await expect(
      dispatchQualityAction({
        restaurantId: RESTAURANT_ID,
        prevRating: 'GREEN',
        nextRating: 'YELLOW',
        log,
      })
    ).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith(
      'error',
      'webhook.quality_action_failed',
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        action: 'throttle',
        prevRating: 'GREEN',
        nextRating: 'YELLOW',
        error: 'connection reset',
      })
    )
    expect(log).not.toHaveBeenCalledWith(
      'info',
      'webhook.quality_action',
      expect.anything()
    )
  })

  // WAQ-013 — live notification on each real transition.
  describe('notifyOpsAlert wiring (WAQ-013)', () => {
    it('throttle (YELLOW) → notify quality_transition_yellow / warn', async () => {
      await dispatchQualityAction({
        restaurantId: RESTAURANT_ID,
        prevRating: 'GREEN',
        nextRating: 'YELLOW',
        log,
      })
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'quality_transition_yellow',
          severity: 'warn',
          restaurantId: RESTAURANT_ID,
        })
      )
    })

    it('pause (RED) → notify auto_pause_triggered / critical', async () => {
      await dispatchQualityAction({
        restaurantId: RESTAURANT_ID,
        prevRating: 'GREEN',
        nextRating: 'RED',
        log,
      })
      // Spec: pause action notifies BOTH quality_transition_red AND
      // auto_pause_triggered. We assert the auto_pause_triggered call
      // because that's the actionable one for the platform team.
      const calls = mockNotify.mock.calls.map((c) => c[0].kind)
      expect(calls).toContain('auto_pause_triggered')
      expect(calls).toContain('quality_transition_red')
    })

    it('manual_recovery_required (YELLOW->GREEN) → notify quality_recovery_pending / info', async () => {
      await dispatchQualityAction({
        restaurantId: RESTAURANT_ID,
        prevRating: 'YELLOW',
        nextRating: 'GREEN',
        log,
      })
      expect(mockNotify).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: 'quality_recovery_pending',
          severity: 'info',
        })
      )
    })

    it('no_op (GREEN -> GREEN) → does NOT notify', async () => {
      await dispatchQualityAction({
        restaurantId: RESTAURANT_ID,
        prevRating: 'GREEN',
        nextRating: 'GREEN',
        log,
      })
      expect(mockNotify).not.toHaveBeenCalled()
    })

    it('does NOT notify if applyAction throws (only the actually-applied side effects fire alerts)', async () => {
      mockPause.mockRejectedValueOnce(new Error('supabase 503'))
      await dispatchQualityAction({
        restaurantId: RESTAURANT_ID,
        prevRating: 'GREEN',
        nextRating: 'RED',
        log,
      })
      expect(mockNotify).not.toHaveBeenCalled()
    })

    it('does NOT throw if notifyOpsAlert rejects', async () => {
      mockNotify.mockRejectedValue(new Error('slack down'))
      await expect(
        dispatchQualityAction({
          restaurantId: RESTAURANT_ID,
          prevRating: 'GREEN',
          nextRating: 'YELLOW',
          log,
        })
      ).resolves.toBeUndefined()
    })
  })
})
