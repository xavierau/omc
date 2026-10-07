import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/idempotency', () => ({
  tryMarkProcessed: vi.fn(),
}))
vi.mock(
  '@/infrastructure/supabase/repositories/quality-state-repository',
  () => ({
    insertEvent: vi.fn(),
    // WAQ-009: handler reads PRIOR state before insert to feed the dispatcher.
    findLatest: vi.fn().mockResolvedValue(null),
  })
)
// WAQ-009: stub the dispatcher so unit tests for routeQualityEvent stay
// focused on idempotency + insertion. Dispatcher behaviour is covered by
// dispatch-quality-action.test.ts and the integration test.
vi.mock('@/application/dispatch-quality-action', () => ({
  dispatchQualityAction: vi.fn().mockResolvedValue(undefined),
}))

import { tryMarkProcessed } from '@/infrastructure/supabase/idempotency'
import {
  insertEvent,
  findLatest,
} from '@/infrastructure/supabase/repositories/quality-state-repository'
import { dispatchQualityAction } from '@/application/dispatch-quality-action'
import { routeQualityEvent } from '../quality-handlers'
import type { LogFn } from '@/domain/ports/whatsapp-webhooks'

function metaQualityBody(opts: {
  field?: string
  phoneNumberId?: string
  quality?: string
  currentLimit?: string
} = {}) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA-1',
        changes: [
          {
            field: opts.field ?? 'account_update',
            value: {
              event: 'account_quality_update',
              phone_number_id: opts.phoneNumberId ?? 'pn-1',
              quality: opts.quality ?? 'yellow',
              current_limit: opts.currentLimit ?? 'TIER_1K',
            },
          },
        ],
      },
    ],
  }
}

describe('routeQualityEvent', () => {
  let logs: Array<[string, string, unknown]>
  const log: LogFn = (level, event, data) => {
    logs.push([level, event, data])
  }

  beforeEach(() => {
    vi.clearAllMocks()
    logs = []
    // Default: no prior state. Individual tests override per case.
    vi.mocked(findLatest).mockResolvedValue(null)
    vi.mocked(dispatchQualityAction).mockResolvedValue(undefined)
  })

  it('happy path: claims idempotency, inserts event, logs quality_event', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(insertEvent).mockResolvedValue(undefined)

    await routeQualityEvent(metaQualityBody(), 'rest-1', log)

    expect(tryMarkProcessed).toHaveBeenCalledTimes(1)
    const claimedKey = vi.mocked(tryMarkProcessed).mock.calls[0]?.[0]
    // Payload-derived key: <prefix>:<phoneNumberId>:<sha256_16>
    expect(claimedKey).toMatch(/^account_quality:pn-1:[0-9a-f]{16}$/)

    expect(insertEvent).toHaveBeenCalledTimes(1)
    const insertedEvent = vi.mocked(insertEvent).mock.calls[0]?.[0]
    expect(insertedEvent.snapshot.restaurantId).toBe('rest-1')
    expect(insertedEvent.snapshot.phoneNumberId).toBe('pn-1')
    expect(insertedEvent.snapshot.qualityRating).toBe('YELLOW')
    expect(insertedEvent.snapshot.messagingTier).toBe('TIER_1K')

    const logEntry = logs.find((l) => l[1] === 'webhook.quality_event')
    expect(logEntry).toBeDefined()
    expect(logEntry?.[2]).toMatchObject({
      qualityRating: 'YELLOW',
      messagingTier: 'TIER_1K',
      flagged: false,
    })
  })

  it('returns early on duplicate idempotency claim (no insert)', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('duplicate')

    await routeQualityEvent(metaQualityBody(), 'rest-1', log)

    expect(insertEvent).not.toHaveBeenCalled()
  })

  it('throws idempotency.error so route.ts returns 500 / Kapso retries', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('error')

    await expect(
      routeQualityEvent(metaQualityBody(), 'rest-1', log)
    ).rejects.toThrow(/^idempotency\.error/)

    expect(insertEvent).not.toHaveBeenCalled()
  })

  it('no quality entries: logs ignored and does not call repo or claim', async () => {
    await routeQualityEvent({ foo: 'bar' }, 'rest-1', log)

    expect(tryMarkProcessed).not.toHaveBeenCalled()
    expect(insertEvent).not.toHaveBeenCalled()
    const ignored = logs.find((l) => l[1] === 'webhook.quality_event_ignored')
    expect(ignored).toBeDefined()
  })

  it('falls back to per-tenant synthetic id when both phone identifiers missing', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(insertEvent).mockResolvedValue(undefined)

    const body = {
      entry: [
        {
          changes: [
            {
              field: 'message_template_quality_update',
              value: { new_quality_score: 'GREEN' },
            },
          ],
        },
      ],
    }

    // When Meta omits phone_number_id (e.g. message_template_quality_update),
    // the handler synthesises `restaurant:<restaurantId>` so the row stays
    // tenant-scoped and the idempotency key cannot collide cross-tenant.
    // The literal 'unknown' would have been a global namespace bug.
    await routeQualityEvent(body, 'rest-1', log)

    const claimedKey = vi.mocked(tryMarkProcessed).mock.calls[0]?.[0]
    expect(claimedKey).toMatch(/^account_quality:restaurant:rest-1:[0-9a-f]{16}$/)
    expect(insertEvent).toHaveBeenCalledTimes(1)
    const insertedEvent = vi.mocked(insertEvent).mock.calls[0]?.[0]
    expect(insertedEvent.snapshot.phoneNumberId).toBe('restaurant:rest-1')
  })

  it('CROSS-TENANT: same payload from two restaurantIds — both inserts succeed', async () => {
    // CRITICAL: processed_webhooks.idempotency_key is GLOBAL. When Meta
    // omits phone_number_id (e.g. message_template_quality_update), two
    // tenants receiving structurally identical payloads must NOT collide
    // on the idempotency key — otherwise tenant B's quality event is
    // silently dropped as a duplicate of tenant A's.
    const seenKeys = new Set<string>()
    vi.mocked(tryMarkProcessed).mockImplementation(async (key: string) => {
      if (seenKeys.has(key)) return 'duplicate'
      seenKeys.add(key)
      return 'new'
    })
    vi.mocked(insertEvent).mockResolvedValue(undefined)

    const body = {
      entry: [
        {
          changes: [
            {
              field: 'message_template_quality_update',
              value: {
                new_quality_score: 'GREEN',
                previous_quality_score: 'YELLOW',
                message_template_id: 'tpl-1',
              },
            },
          ],
        },
      ],
    }

    await routeQualityEvent(body, 'rest-A', log)
    await routeQualityEvent(body, 'rest-B', log)

    const keyA = vi.mocked(tryMarkProcessed).mock.calls[0]?.[0]
    const keyB = vi.mocked(tryMarkProcessed).mock.calls[1]?.[0]
    expect(keyA).not.toBe(keyB)
    expect(insertEvent).toHaveBeenCalledTimes(2)

    const restaurants = vi
      .mocked(insertEvent)
      .mock.calls.map((c) => c[0].snapshot.restaurantId)
    expect(restaurants).toEqual(['rest-A', 'rest-B'])
  })

  it('same payload after 30 seconds: same idempotency key (no second insert)', async () => {
    // RED before fix: when the key was clock-derived, two retries 30s apart
    // produced different keys -> the second insert went through. Payload-
    // derived key fingerprint must collapse them.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T10:00:00.000Z'))
    vi.mocked(tryMarkProcessed).mockResolvedValueOnce('new')
    vi.mocked(insertEvent).mockResolvedValue(undefined)

    await routeQualityEvent(metaQualityBody(), 'rest-1', log)
    const firstKey = vi.mocked(tryMarkProcessed).mock.calls[0]?.[0]

    vi.setSystemTime(new Date('2026-05-04T10:00:30.000Z'))
    vi.mocked(tryMarkProcessed).mockResolvedValueOnce('duplicate')
    await routeQualityEvent(metaQualityBody(), 'rest-1', log)
    const secondKey = vi.mocked(tryMarkProcessed).mock.calls[1]?.[0]

    expect(secondKey).toBe(firstKey)
    expect(insertEvent).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('GREEN -> YELLOW then YELLOW -> GREEN: distinct keys via old_limit', async () => {
    // Two different transitions through the same YELLOW intermediate state
    // would collapse if we keyed only on (rating, tier, flagged). Including
    // old_limit and previous_quality_score in the fingerprint makes them
    // distinct.
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(insertEvent).mockResolvedValue(undefined)

    const greenToYellow = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'account_update',
              value: {
                event: 'account_quality_update',
                phone_number_id: 'pn-1',
                quality: 'yellow',
                current_limit: 'TIER_1K',
                old_limit: 'TIER_10K',
              },
            },
          ],
        },
      ],
    }
    const yellowToGreen = {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'account_update',
              value: {
                event: 'account_quality_update',
                phone_number_id: 'pn-1',
                quality: 'green',
                current_limit: 'TIER_10K',
                old_limit: 'TIER_1K',
              },
            },
          ],
        },
      ],
    }

    await routeQualityEvent(greenToYellow, 'rest-1', log)
    await routeQualityEvent(yellowToGreen, 'rest-1', log)

    const k1 = vi.mocked(tryMarkProcessed).mock.calls[0]?.[0]
    const k2 = vi.mocked(tryMarkProcessed).mock.calls[1]?.[0]
    expect(k1).not.toBe(k2)
    expect(insertEvent).toHaveBeenCalledTimes(2)
  })

  // WAQ-009: dispatcher wiring + stale-event guard.
  it('WAQ-009: dispatches action with prevRating from findLatest', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(insertEvent).mockResolvedValue(undefined)
    vi.mocked(findLatest).mockResolvedValue({
      snapshot: {
        qualityRating: 'GREEN',
        transitionedAt: '2026-05-04T00:00:00.000Z',
      },
    } as never)

    await routeQualityEvent(metaQualityBody({ quality: 'red' }), 'rest-1', log)

    expect(dispatchQualityAction).toHaveBeenCalledTimes(1)
    expect(dispatchQualityAction).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'rest-1',
        prevRating: 'GREEN',
        nextRating: 'RED',
      })
    )
  })

  it('WAQ-009: stale event (prev newer than this) skips dispatch', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(insertEvent).mockResolvedValue(undefined)
    // Prior row from the future — guarantees prev > thisAt.
    vi.mocked(findLatest).mockResolvedValue({
      snapshot: {
        qualityRating: 'RED',
        transitionedAt: '2099-01-01T00:00:00.000Z',
      },
    } as never)

    await routeQualityEvent(metaQualityBody({ quality: 'yellow' }), 'rest-1', log)

    expect(dispatchQualityAction).not.toHaveBeenCalled()
    const skipLog = logs.find(
      (l) => l[1] === 'webhook.quality_action_skipped_stale'
    )
    expect(skipLog).toBeDefined()
  })

  // WAQ-009 round-1 review (CRITICAL): when the Meta payload includes
  // entry[].time, the stale-guard must use THAT (not server now). Without
  // this fix a delayed retry got a NEWER server timestamp than the DB row
  // and the guard never fired.
  it('WAQ-009 r1: stale guard uses Meta entry[].time when present', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(insertEvent).mockResolvedValue(undefined)
    // Prev row at 2026-05-04T12:00:00.
    vi.mocked(findLatest).mockResolvedValue({
      snapshot: {
        qualityRating: 'RED',
        transitionedAt: '2026-05-04T12:00:00.000Z',
      },
    } as never)

    // Incoming payload: entry[].time = 1 hour BEFORE the prev row.
    const olderEpoch = Math.floor(
      new Date('2026-05-04T11:00:00.000Z').getTime() / 1000
    )
    const body = {
      entry: [
        {
          id: 'WABA-1',
          time: olderEpoch,
          changes: [
            {
              field: 'account_update',
              value: {
                event: 'account_quality_update',
                phone_number_id: 'pn-1',
                quality: 'yellow',
                current_limit: 'TIER_1K',
              },
            },
          ],
        },
      ],
    }

    await routeQualityEvent(body, 'rest-1', log)

    expect(dispatchQualityAction).not.toHaveBeenCalled()
    const skipLog = logs.find(
      (l) => l[1] === 'webhook.quality_action_skipped_stale'
    )
    expect(skipLog).toBeDefined()
    expect(skipLog?.[2]).toMatchObject({
      thisAt: '2026-05-04T11:00:00.000Z',
      prevAt: '2026-05-04T12:00:00.000Z',
    })
  })

  it('WAQ-009 r1: NEWER Meta entry[].time dispatches (regression)', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(insertEvent).mockResolvedValue(undefined)
    vi.mocked(findLatest).mockResolvedValue({
      snapshot: {
        qualityRating: 'GREEN',
        transitionedAt: '2026-05-04T12:00:00.000Z',
      },
    } as never)

    const newerEpoch = Math.floor(
      new Date('2026-05-04T13:00:00.000Z').getTime() / 1000
    )
    const body = {
      entry: [
        {
          time: newerEpoch,
          changes: [
            {
              field: 'account_update',
              value: {
                event: 'account_quality_update',
                phone_number_id: 'pn-1',
                quality: 'red',
                current_limit: 'TIER_1K',
              },
            },
          ],
        },
      ],
    }

    await routeQualityEvent(body, 'rest-1', log)

    expect(dispatchQualityAction).toHaveBeenCalledWith(
      expect.objectContaining({ prevRating: 'GREEN', nextRating: 'RED' })
    )
  })

  it('WAQ-009: null prev (first-ever event) feeds dispatcher prevRating=null', async () => {
    vi.mocked(tryMarkProcessed).mockResolvedValue('new')
    vi.mocked(insertEvent).mockResolvedValue(undefined)
    vi.mocked(findLatest).mockResolvedValue(null)

    await routeQualityEvent(metaQualityBody({ quality: 'red' }), 'rest-1', log)

    expect(dispatchQualityAction).toHaveBeenCalledWith(
      expect.objectContaining({ prevRating: null, nextRating: 'RED' })
    )
  })

  it('identical payload twice: second is duplicate (regression)', async () => {
    vi.mocked(tryMarkProcessed)
      .mockResolvedValueOnce('new')
      .mockResolvedValueOnce('duplicate')
    vi.mocked(insertEvent).mockResolvedValue(undefined)

    await routeQualityEvent(metaQualityBody(), 'rest-1', log)
    await routeQualityEvent(metaQualityBody(), 'rest-1', log)

    expect(tryMarkProcessed).toHaveBeenCalledTimes(2)
    expect(insertEvent).toHaveBeenCalledTimes(1)
  })
})
