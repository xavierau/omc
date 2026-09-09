import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import type { IntegrationDeliveryProps } from '@/domain/entities/integration-delivery'
import {
  findDeliveriesByEventId,
  findDeliveriesToRelay,
  findDeliveryById,
  markEnqueued,
  pruneDeliveriesForIntegration,
  saveDelivery,
} from '../integration-delivery-repository'

function baseProps(overrides: Partial<IntegrationDeliveryProps> = {}): IntegrationDeliveryProps {
  return {
    id: 'del-1',
    integrationId: 'int-1',
    restaurantId: 'r-1',
    eventId: 'evt_1',
    status: 'queued',
    attempts: 0,
    lastHttpStatus: null,
    lastErrorCode: null,
    lastLatencyMs: null,
    responseExcerpt: null,
    nextRetryAt: null,
    enqueuedAt: null,
    deliveredAt: null,
    deadLetteredAt: null,
    retriedAt: null,
    ...overrides,
  }
}

function toRow(props: IntegrationDeliveryProps) {
  return {
    id: props.id,
    integration_id: props.integrationId,
    restaurant_id: props.restaurantId,
    event_id: props.eventId,
    status: props.status,
    attempts: props.attempts,
    last_http_status: props.lastHttpStatus,
    last_error_code: props.lastErrorCode,
    last_latency_ms: props.lastLatencyMs,
    response_excerpt: props.responseExcerpt,
    next_retry_at: props.nextRetryAt,
    enqueued_at: props.enqueuedAt,
    delivered_at: props.deliveredAt,
    dead_lettered_at: props.deadLetteredAt,
    retried_at: props.retriedAt,
  }
}

describe('findDeliveryById + saveDelivery round trip', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rehydrates an IntegrationDelivery entity that can transition, and saveDelivery persists the snapshot', async () => {
    const row = toRow(baseProps({ status: 'queued', attempts: 0 }))
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })

    const updateCaptured: { value?: Record<string, unknown> } = {}
    const updateEq = vi.fn().mockResolvedValue({ data: null, error: null })
    const update = vi.fn().mockImplementation((patch: Record<string, unknown>) => {
      updateCaptured.value = patch
      return { eq: updateEq }
    })

    const from = vi.fn().mockReturnValue({ select, update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    const delivery = await findDeliveryById('del-1')
    expect(delivery).not.toBeNull()
    const next = delivery!.transitionTo('delivering')

    await saveDelivery(next)

    expect(updateCaptured.value).toMatchObject({ status: 'delivering' })
    expect(updateEq).toHaveBeenCalledWith('id', 'del-1')
  })

  it('returns null when the delivery does not exist', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    expect(await findDeliveryById('missing')).toBeNull()
  })
})

describe('findDeliveriesToRelay (WI-6 Tests-first: "relay picks queued AND enqueued_at IS NULL only")', () => {
  beforeEach(() => vi.clearAllMocks())

  it('filters on status=queued, enqueued_at IS NULL, and an age cutoff', async () => {
    const limitFn = vi.fn().mockResolvedValue({ data: [], error: null })
    const lt = vi.fn().mockReturnValue({ limit: limitFn })
    const is = vi.fn().mockReturnValue({ lt })
    const eq = vi.fn().mockReturnValue({ is })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    await findDeliveriesToRelay({ olderThanMs: 5000, limit: 200 })

    expect(eq).toHaveBeenCalledWith('status', 'queued')
    expect(is).toHaveBeenCalledWith('enqueued_at', null)
    expect(lt).toHaveBeenCalledWith('created_at', expect.any(String))
    expect(limitFn).toHaveBeenCalledWith(200)
  })
})

describe('markEnqueued (relay/fast-path idempotency)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('guards the UPDATE on enqueued_at IS NULL so a second stamp is a no-op, not a clobber', async () => {
    const is = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq = vi.fn().mockReturnValue({ is })
    const update = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ update })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    await markEnqueued('del-1', '2026-09-10T00:00:05.000Z')

    expect(update).toHaveBeenCalledWith({ enqueued_at: '2026-09-10T00:00:05.000Z' })
    expect(eq).toHaveBeenCalledWith('id', 'del-1')
    expect(is).toHaveBeenCalledWith('enqueued_at', null)
  })
})

describe('pruneDeliveriesForIntegration (US-9: <=500 rows / 30 days, whichever smaller)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes rows older than the retention window, then rows beyond the newest-N cap', async () => {
    const oldRows = [{ id: 'old-1' }, { id: 'old-2' }]
    const remainingRows = Array.from({ length: 6 }, (_, i) => ({ id: `keep-${i}` }))

    const ltAge = vi.fn().mockResolvedValue({ data: oldRows, error: null })
    const orderRemaining = vi.fn().mockResolvedValue({ data: remainingRows, error: null })

    const deleteInCalls: unknown[][] = []
    const deleteIn = vi.fn().mockImplementation((...args: unknown[]) => {
      deleteInCalls.push(args)
      return Promise.resolve({ data: null, error: null })
    })
    const del = vi.fn().mockReturnValue({ in: deleteIn })

    let selectCallCount = 0
    const select = vi.fn().mockImplementation(() => {
      selectCallCount += 1
      if (selectCallCount === 1) {
        // age pass: select().eq().lt()
        const eq = vi.fn().mockReturnValue({ lt: ltAge })
        return { eq }
      }
      // cap pass: select().eq().order()
      const eq = vi.fn().mockReturnValue({ order: orderRemaining })
      return { eq }
    })

    const from = vi.fn().mockReturnValue({ select, delete: del })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    const deleted = await pruneDeliveriesForIntegration('int-1', 4, 30)

    // 2 old rows deleted by age, plus 2 beyond the newest-4 cap (6 - 4 = 2)
    expect(deleted).toBe(4)
    expect(deleteInCalls[0]).toEqual(['id', ['old-1', 'old-2']])
    expect(deleteInCalls[1]).toEqual(['id', ['keep-4', 'keep-5']])
  })
})

describe('findDeliveriesByEventId (WI-6 send-test-event.ts)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns every delivery for the event regardless of status/enqueued_at', async () => {
    const row = toRow(baseProps({ id: 'del-a', status: 'paused', enqueuedAt: '2026-09-10T00:00:00.000Z' }))
    const eq = vi.fn().mockResolvedValue({ data: [row], error: null })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    const result = await findDeliveriesByEventId('evt_1')
    expect(result).toHaveLength(1)
    expect(result[0].snapshot.id).toBe('del-a')
    expect(eq).toHaveBeenCalledWith('event_id', 'evt_1')
  })
})
