import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-delivery-repository', () => ({
  findAllPausedDeliveryIdsForIntegration: vi.fn(),
  findDeliveryById: vi.fn(),
  saveDelivery: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/infrastructure/supabase/repositories/integration-settings-repository', () => ({
  findIntegrationSettingsByIdForRestaurant: vi.fn(),
  updateOutboundBreakerState: vi.fn().mockResolvedValue(undefined),
}))

import {
  findAllPausedDeliveryIdsForIntegration,
  findDeliveryById,
  saveDelivery,
} from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import {
  findIntegrationSettingsByIdForRestaurant,
  updateOutboundBreakerState,
} from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { IntegrationDelivery, type IntegrationDeliveryProps } from '@/domain/entities/integration-delivery'
import { IntegrationSettings, type IntegrationSettingsProps } from '@/domain/entities/integration-settings'
import { resumeOutbound, RESUME_CONCURRENCY_LIMIT } from '../resume-outbound'

function pausedDelivery(id: string): IntegrationDelivery {
  const props: IntegrationDeliveryProps = {
    id,
    integrationId: 'int-1',
    restaurantId: 'r-1',
    eventId: `evt_${id}`,
    status: 'paused',
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
  }
  return IntegrationDelivery.fromProps(props)
}

function settings(overrides: Partial<IntegrationSettingsProps> = {}): IntegrationSettings {
  return IntegrationSettings.fromProps({
    integrationId: 'int-1',
    restaurantId: 'r-1',
    newJoinTemplateId: null,
    consentAttestationText: null,
    consentAttestationAckAt: null,
    consentAttestationAckBy: null,
    outboundUrl: 'https://partner.example.test/hook',
    outboundSecretLast4: 'abcd',
    outboundSecretUpdatedAt: null,
    outboundSecretUpdatedBy: null,
    outboundEvents: ['member.created'],
    outboundEnabled: true,
    outboundPiiAckAt: '2026-09-01T00:00:00.000Z',
    outboundPiiAckBy: 'u-1',
    outboundStatus: 'paused_auto',
    outboundFailureStreak: 10,
    outboundPausedAt: '2026-09-10T00:00:00.000Z',
    inboundRatePerMin: null,
    inboundBurst: null,
    inboundQueueCap: null,
    inboundSecretUpdatedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  })
}

describe('resumeOutbound (US-9)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('integration not found -> integration_not_found, no writes', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(null)

    const result = await resumeOutbound('int-missing', 'r-1')

    expect(result).toEqual({ ok: false, error: 'integration_not_found' })
    expect(updateOutboundBreakerState).not.toHaveBeenCalled()
  })

  it('no saved URL -> url_invalid, no writes', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(settings({ outboundUrl: null, outboundEnabled: false }))

    const result = await resumeOutbound('int-1', 'r-1')

    expect(result).toEqual({ ok: false, error: 'url_invalid' })
    expect(updateOutboundBreakerState).not.toHaveBeenCalled()
  })

  // G-5 (WI-14, grok review, SEC-001/#111 pattern): the settings read is
  // scoped by BOTH ids in the query itself, not fetch-then-compare --
  // defense in depth alongside the route's own scoped pre-check.
  it('G-5: reads settings through the restaurant-scoped repository lookup', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(settings())
    vi.mocked(findAllPausedDeliveryIdsForIntegration).mockResolvedValue([])

    await resumeOutbound('int-1', 'r-1')

    expect(findIntegrationSettingsByIdForRestaurant).toHaveBeenCalledWith('int-1', 'r-1')
  })

  it('resets status to active and streak to 0', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(settings())
    vi.mocked(findAllPausedDeliveryIdsForIntegration).mockResolvedValue([])

    await resumeOutbound('int-1', 'r-1')

    expect(updateOutboundBreakerState).toHaveBeenCalledWith({
      integrationId: 'int-1',
      restaurantId: 'r-1',
      outboundFailureStreak: 0,
      outboundStatus: 'active',
      outboundPausedAt: null,
    })
  })

  it('WI-6 Tests-first: "resume requeues exactly the pending rows once" -- every paused row within the cap transitions to queued with enqueued_at cleared', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(settings({ inboundQueueCap: 500 }))
    vi.mocked(findAllPausedDeliveryIdsForIntegration).mockResolvedValue(['del-1', 'del-2'])
    vi.mocked(findDeliveryById).mockImplementation(async (id: string) => pausedDelivery(id))

    const result = await resumeOutbound('int-1', 'r-1')

    expect(result).toEqual({ ok: true, requeued: 2, deadLettered: 0 })
    expect(saveDelivery).toHaveBeenCalledTimes(2)
    for (const call of vi.mocked(saveDelivery).mock.calls) {
      const snapshot = (call[0] as IntegrationDelivery).snapshot
      expect(snapshot.status).toBe('queued')
      expect(snapshot.enqueuedAt).toBeNull()
    }
  })

  it('rows beyond the queue cap are dead-lettered directly, not requeued', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(settings({ inboundQueueCap: 2 }))
    vi.mocked(findAllPausedDeliveryIdsForIntegration).mockResolvedValue(['del-1', 'del-2', 'del-3'])
    vi.mocked(findDeliveryById).mockImplementation(async (id: string) => pausedDelivery(id))

    const result = await resumeOutbound('int-1', 'r-1')

    expect(result).toEqual({ ok: true, requeued: 2, deadLettered: 1 })
    const statuses = vi.mocked(saveDelivery).mock.calls.map((call) => (call[0] as IntegrationDelivery).snapshot.status)
    expect(statuses.filter((s) => s === 'queued')).toHaveLength(2)
    expect(statuses.filter((s) => s === 'dead_lettered')).toHaveLength(1)
  })

  it('falls back to the plan default cap (500) when inboundQueueCap is unset', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(settings({ inboundQueueCap: null }))
    const ids = Array.from({ length: 3 }, (_, i) => `del-${i}`)
    vi.mocked(findAllPausedDeliveryIdsForIntegration).mockResolvedValue(ids)
    vi.mocked(findDeliveryById).mockImplementation(async (id: string) => pausedDelivery(id))

    const result = await resumeOutbound('int-1', 'r-1')
    expect(result).toEqual({ ok: true, requeued: 3, deadLettered: 0 })
  })

  // Grok finding #8: a full Promise.all over every paused row (up to the
  // 500-row cap) used to fire that many parallel PostgREST reads+writes at
  // once -- a resume on a heavily-paused integration could contend with
  // the shared VM's inbound/outbound workers. Bounded to
  // RESUME_CONCURRENCY_LIMIT (mirrors execute-campaign-batch.ts's own
  // CONCURRENCY_LIMIT=20 precedent for the identical class of risk).
  it('finding #8: never more than RESUME_CONCURRENCY_LIMIT findDeliveryById calls in flight at once, and still processes every row correctly', async () => {
    const ids = Array.from({ length: 55 }, (_, i) => `del-${i}`)
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(settings({ inboundQueueCap: 500 }))
    vi.mocked(findAllPausedDeliveryIdsForIntegration).mockResolvedValue(ids)

    let inFlight = 0
    let maxInFlight = 0
    vi.mocked(findDeliveryById).mockImplementation(async (id: string) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 0))
      inFlight -= 1
      return pausedDelivery(id)
    })

    const result = await resumeOutbound('int-1', 'r-1')

    expect(result).toEqual({ ok: true, requeued: 55, deadLettered: 0 })
    expect(saveDelivery).toHaveBeenCalledTimes(55)
    expect(maxInFlight).toBeLessThanOrEqual(RESUME_CONCURRENCY_LIMIT)
    // Also proves it's genuinely batched, not serialised down to 1 at a time.
    expect(maxInFlight).toBeGreaterThan(1)
  })
})
