import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/event-repository')
vi.mock('@/infrastructure/event-dispatch/tenant-listener-resolver')
vi.mock('@/infrastructure/queue/event-dispatch-queue')
vi.mock('@/infrastructure/event-dispatch/listener-registry')

import { createEvent } from '@/infrastructure/supabase/repositories/event-repository'
import { resolveListenersForEvent } from '@/infrastructure/event-dispatch/tenant-listener-resolver'
import { addEventDispatchJob } from '@/infrastructure/queue/event-dispatch-queue'
import { resolveListener } from '@/infrastructure/event-dispatch/listener-registry'
import { emitEvent } from '../emit-event'

const BASE_PARAMS = {
  restaurantId: 'rest-1',
  memberId: 'member-1',
  type: 'join' as const,
  dataJson: { foo: 'bar' },
}

describe('emitEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    vi.mocked(createEvent).mockResolvedValue('event-1')
    vi.mocked(resolveListenersForEvent).mockResolvedValue([])
    vi.mocked(addEventDispatchJob).mockResolvedValue(undefined)
  })

  it('calls createEvent and returns the event ID', async () => {
    const result = await emitEvent(BASE_PARAMS)

    expect(createEvent).toHaveBeenCalledWith(BASE_PARAMS)
    expect(result).toBe('event-1')
  })

  it('does not propagate dispatch failures', async () => {
    vi.mocked(resolveListenersForEvent).mockRejectedValue(
      new Error('dispatch boom')
    )

    const result = await emitEvent(BASE_PARAMS)

    expect(result).toBe('event-1')
  })

  it('creates integration_error event when dispatch fails', async () => {
    vi.mocked(resolveListenersForEvent).mockRejectedValue(
      new Error('queue down')
    )

    await emitEvent(BASE_PARAMS)

    expect(createEvent).toHaveBeenCalledTimes(2)
    expect(createEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: 'rest-1',
        memberId: 'member-1',
        type: 'integration_error',
        dataJson: expect.objectContaining({
          originalEventId: 'event-1',
          originalEventType: 'join',
          error: 'queue down',
          phase: 'dispatch_enqueue',
        }),
      })
    )
  })

  it('enqueues no jobs when there are no listeners', async () => {
    vi.mocked(resolveListenersForEvent).mockResolvedValue([])

    await emitEvent(BASE_PARAMS)

    expect(addEventDispatchJob).not.toHaveBeenCalled()
  })

  it('enqueues one job per listener', async () => {
    vi.mocked(resolveListenersForEvent).mockResolvedValue([
      { listenerKey: 'listener-a' },
      { listenerKey: 'listener-b' },
    ])

    await emitEvent(BASE_PARAMS)

    expect(addEventDispatchJob).toHaveBeenCalledTimes(2)
    expect(addEventDispatchJob).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        listenerKey: 'listener-a',
        restaurantId: 'rest-1',
        eventType: 'join',
      })
    )
    expect(addEventDispatchJob).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'event-1',
        listenerKey: 'listener-b',
      })
    )
  })

  it('passes source to resolveListenersForEvent', async () => {
    await emitEvent({ ...BASE_PARAMS, source: 'pos:stocky' })

    expect(resolveListenersForEvent).toHaveBeenCalledWith(
      'rest-1',
      'join',
      'pos:stocky'
    )
  })

  it('passes source in dispatch job data', async () => {
    vi.mocked(resolveListenersForEvent).mockResolvedValue([
      { listenerKey: 'listener-a' },
    ])

    await emitEvent({ ...BASE_PARAMS, source: 'crm:web' })

    expect(addEventDispatchJob).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'crm:web',
      })
    )
  })

  it('falls back to sync dispatch when REDIS_URL is not set', async () => {
    vi.stubEnv('REDIS_URL', '')
    const mockHandle = vi.fn()
    vi.mocked(resolveListener).mockReturnValue({ supportedEvents: [], handle: mockHandle })
    vi.mocked(resolveListenersForEvent).mockResolvedValue([
      { listenerKey: 'sync-listener' },
    ])

    const result = await emitEvent(BASE_PARAMS)

    expect(addEventDispatchJob).not.toHaveBeenCalled()
    expect(resolveListener).toHaveBeenCalledWith('sync-listener')
    expect(mockHandle).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'event-1',
        restaurantId: 'rest-1',
        memberId: 'member-1',
        type: 'join',
      })
    )
    expect(result).toBe('event-1')
  })
})
