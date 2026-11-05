import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../client', () => ({
  createServerSupabaseClient: vi.fn(),
}))

import { createServerSupabaseClient } from '../../client'
import {
  findEarliestMemberCreatedSource,
  findIntegrationEventById,
  insertIntegrationEvent,
  pruneOrphanIntegrationEvents,
} from '../integration-event-repository'

describe('insertIntegrationEvent', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes source and origin_integration_id through to the row', async () => {
    const captured: { row?: Record<string, unknown> } = {}
    const insert = vi.fn().mockImplementation((row: Record<string, unknown>) => {
      captured.row = row
      return Promise.resolve({ data: null, error: null })
    })
    const from = vi.fn().mockReturnValue({ insert })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    await insertIntegrationEvent({
      id: 'evt_1',
      restaurantId: 'r-1',
      memberId: 'm-1',
      type: 'member.created',
      changed: [],
      source: 'partner_api',
      originIntegrationId: 'int-1',
      occurredAt: '2026-09-10T00:00:00.000Z',
    })

    expect(captured.row).toMatchObject({
      id: 'evt_1',
      source: 'partner_api',
      origin_integration_id: 'int-1',
    })
  })

  it('throws a contextual error on a database failure', async () => {
    const insert = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } })
    const from = vi.fn().mockReturnValue({ insert })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    await expect(
      insertIntegrationEvent({
        id: 'evt_1',
        restaurantId: 'r-1',
        memberId: null,
        type: 'ping',
        changed: [],
        source: null,
        originIntegrationId: null,
        occurredAt: '2026-09-10T00:00:00.000Z',
      })
    ).rejects.toThrow(/insertIntegrationEvent.*boom/)
  })
})

describe('findIntegrationEventById', () => {
  beforeEach(() => vi.clearAllMocks())

  it('maps the row, including a null source', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: 'evt_1',
        restaurant_id: 'r-1',
        member_id: 'm-1',
        type: 'member.updated',
        changed: ['status'],
        source: null,
        origin_integration_id: null,
        occurred_at: '2026-09-10T00:00:00.000Z',
      },
      error: null,
    })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    const result = await findIntegrationEventById('evt_1')
    expect(result).toEqual({
      id: 'evt_1',
      restaurantId: 'r-1',
      memberId: 'm-1',
      type: 'member.updated',
      changed: ['status'],
      originIntegrationId: null,
      occurredAt: '2026-09-10T00:00:00.000Z',
      source: null,
    })
  })

  it('returns null when the event does not exist', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq = vi.fn().mockReturnValue({ maybeSingle })
    const select = vi.fn().mockReturnValue({ eq })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    expect(await findIntegrationEventById('missing')).toBeNull()
  })
})

describe('findEarliestMemberCreatedSource (member.updated source fallback)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns the earliest member.created event source for the member', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { source: 'whatsapp' }, error: null })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const order = vi.fn().mockReturnValue({ limit })
    const eq2 = vi.fn().mockReturnValue({ order })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    const result = await findEarliestMemberCreatedSource('m-1')
    expect(result).toBe('whatsapp')
    expect(order).toHaveBeenCalledWith('occurred_at', { ascending: true })
  })

  it('returns null when the member predates the outbox (no member.created event)', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const limit = vi.fn().mockReturnValue({ maybeSingle })
    const order = vi.fn().mockReturnValue({ limit })
    const eq2 = vi.fn().mockReturnValue({ order })
    const eq1 = vi.fn().mockReturnValue({ eq: eq2 })
    const select = vi.fn().mockReturnValue({ eq: eq1 })
    const from = vi.fn().mockReturnValue({ select })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    expect(await findEarliestMemberCreatedSource('m-legacy')).toBeNull()
  })
})

describe('pruneOrphanIntegrationEvents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes only candidate events with zero deliveries', async () => {
    const lt = vi.fn().mockResolvedValue({
      data: [{ id: 'evt_old_1' }, { id: 'evt_old_2' }, { id: 'evt_old_3' }],
      error: null,
    })
    const selectEvents = vi.fn().mockReturnValue({ lt })

    const inDeliveries = vi.fn().mockResolvedValue({ data: [{ event_id: 'evt_old_2' }], error: null })
    const selectDeliveries = vi.fn().mockReturnValue({ in: inDeliveries })

    const inDelete = vi.fn().mockResolvedValue({ data: null, error: null })
    const del = vi.fn().mockReturnValue({ in: inDelete })

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'integration_events') return { select: selectEvents, delete: del }
      if (table === 'integration_deliveries') return { select: selectDeliveries }
      throw new Error(`unexpected table ${table}`)
    })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    const deleted = await pruneOrphanIntegrationEvents(30)

    expect(deleted).toBe(2)
    expect(inDelete).toHaveBeenCalledWith('id', ['evt_old_1', 'evt_old_3'])
  })

  it('short-circuits with zero deletions when there are no old candidates', async () => {
    const lt = vi.fn().mockResolvedValue({ data: [], error: null })
    const selectEvents = vi.fn().mockReturnValue({ lt })
    const from = vi.fn().mockReturnValue({ select: selectEvents })
    vi.mocked(createServerSupabaseClient).mockReturnValue({ from } as unknown as ReturnType<
      typeof createServerSupabaseClient
    >)

    expect(await pruneOrphanIntegrationEvents(30)).toBe(0)
    expect(from).toHaveBeenCalledTimes(1) // never queries integration_deliveries
  })
})
