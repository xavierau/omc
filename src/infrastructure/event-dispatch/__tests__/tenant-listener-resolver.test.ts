import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock(
  '@/infrastructure/supabase/repositories/pos-integration-repository'
)
vi.mock('../pos-event-listener')

import { findPosIntegrationsByRestaurant } from '@/infrastructure/supabase/repositories/pos-integration-repository'
import { getSupportedEventsForProvider } from '../pos-event-listener'
import { resolveListenersForEvent, clearIntegrationCache } from '../tenant-listener-resolver'
import { buildPosIntegration } from '@/test-utils/builders'

describe('resolveListenersForEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearIntegrationCache()
  })

  it('returns POS listeners for active integrations matching event type', async () => {
    const integration = buildPosIntegration({
      id: 'pos-ichef-1',
      provider: 'ichef',
      status: 'active',
    })
    vi.mocked(findPosIntegrationsByRestaurant).mockResolvedValue([
      integration,
    ])
    vi.mocked(getSupportedEventsForProvider).mockReturnValue([
      'join',
      'points',
      'pos_transaction',
    ])

    const result = await resolveListenersForEvent(
      'restaurant-active',
      'join'
    )

    expect(result).toEqual([{ listenerKey: 'pos:pos-ichef-1' }])
    expect(getSupportedEventsForProvider).toHaveBeenCalledWith('ichef')
  })

  it('skips inactive integrations', async () => {
    const inactive = buildPosIntegration({
      id: 'pos-inactive-1',
      provider: 'ichef',
      status: 'inactive',
    })
    vi.mocked(findPosIntegrationsByRestaurant).mockResolvedValue([
      inactive,
    ])

    const result = await resolveListenersForEvent(
      'restaurant-inactive',
      'join'
    )

    expect(result).toEqual([])
    expect(getSupportedEventsForProvider).not.toHaveBeenCalled()
  })

  it('returns empty for unsupported event types', async () => {
    const integration = buildPosIntegration({
      provider: 'generic',
      status: 'active',
    })
    vi.mocked(findPosIntegrationsByRestaurant).mockResolvedValue([
      integration,
    ])
    vi.mocked(getSupportedEventsForProvider).mockReturnValue([])

    const result = await resolveListenersForEvent(
      'restaurant-unsupported',
      'join'
    )

    expect(result).toEqual([])
    expect(getSupportedEventsForProvider).toHaveBeenCalledWith(
      'generic'
    )
  })

  it('returns empty for restaurants without integrations', async () => {
    vi.mocked(findPosIntegrationsByRestaurant).mockResolvedValue([])

    const result = await resolveListenersForEvent(
      'restaurant-no-pos',
      'join'
    )

    expect(result).toEqual([])
    expect(
      findPosIntegrationsByRestaurant
    ).toHaveBeenCalledWith('restaurant-no-pos')
  })

  it('skips POS listeners when source prefix matches', async () => {
    const integration = buildPosIntegration({
      id: 'pos-stocky-1',
      provider: 'ichef',
      status: 'active',
    })
    vi.mocked(findPosIntegrationsByRestaurant).mockResolvedValue([
      integration,
    ])
    vi.mocked(getSupportedEventsForProvider).mockReturnValue([
      'join',
      'points',
    ])

    const result = await resolveListenersForEvent(
      'restaurant-source-match',
      'join',
      'pos:stocky'
    )

    expect(result).toEqual([])
  })

  it('includes POS listeners when source prefix differs', async () => {
    const integration = buildPosIntegration({
      id: 'pos-ichef-1',
      provider: 'ichef',
      status: 'active',
    })
    vi.mocked(findPosIntegrationsByRestaurant).mockResolvedValue([
      integration,
    ])
    vi.mocked(getSupportedEventsForProvider).mockReturnValue([
      'join',
      'points',
    ])

    const result = await resolveListenersForEvent(
      'restaurant-source-diff',
      'join',
      'crm:internal'
    )

    expect(result).toEqual([{ listenerKey: 'pos:pos-ichef-1' }])
  })

  it('includes POS listeners when source is null', async () => {
    const integration = buildPosIntegration({
      id: 'pos-ichef-1',
      provider: 'ichef',
      status: 'active',
    })
    vi.mocked(findPosIntegrationsByRestaurant).mockResolvedValue([
      integration,
    ])
    vi.mocked(getSupportedEventsForProvider).mockReturnValue([
      'join',
      'points',
    ])

    const result = await resolveListenersForEvent(
      'restaurant-null-source',
      'join',
      null
    )

    expect(result).toEqual([{ listenerKey: 'pos:pos-ichef-1' }])
  })

  it('includes POS listeners when source has no prefix', async () => {
    const integration = buildPosIntegration({
      id: 'pos-ichef-1',
      provider: 'ichef',
      status: 'active',
    })
    vi.mocked(findPosIntegrationsByRestaurant).mockResolvedValue([
      integration,
    ])
    vi.mocked(getSupportedEventsForProvider).mockReturnValue([
      'join',
      'points',
    ])

    const result = await resolveListenersForEvent(
      'restaurant-no-prefix',
      'join',
      'manual'
    )

    expect(result).toEqual([{ listenerKey: 'pos:pos-ichef-1' }])
  })
})
