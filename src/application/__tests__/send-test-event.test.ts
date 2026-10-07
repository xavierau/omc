import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-settings-repository', () => ({
  findIntegrationSettingsByIdForRestaurant: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/integration-delivery-repository', () => ({
  findDeliveriesByEventId: vi.fn(),
}))
vi.mock('@/application/emit-integration-event', () => ({
  emitIntegrationEvent: vi.fn().mockResolvedValue(undefined),
}))

import { findIntegrationSettingsByIdForRestaurant } from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { findDeliveriesByEventId } from '@/infrastructure/supabase/repositories/integration-delivery-repository'
import { emitIntegrationEvent } from '@/application/emit-integration-event'
import { IntegrationDelivery, type IntegrationDeliveryProps } from '@/domain/entities/integration-delivery'
import { IntegrationSettings, type IntegrationSettingsProps } from '@/domain/entities/integration-settings'
import { sendTestEvent } from '../send-test-event'

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
    outboundStatus: 'active',
    outboundFailureStreak: 0,
    outboundPausedAt: null,
    inboundRatePerMin: null,
    inboundBurst: null,
    inboundQueueCap: null,
    inboundSecretUpdatedAt: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  })
}

function deliveryFor(integrationId: string, id = `del-${integrationId}`): IntegrationDelivery {
  const props: IntegrationDeliveryProps = {
    id,
    integrationId,
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
  }
  return IntegrationDelivery.fromProps(props)
}

describe('sendTestEvent (US-7/US-9, T-M6: identical path, saved URL only)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('integration not found -> integration_not_found, never emits', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(null)

    const result = await sendTestEvent('int-missing', 'r-1')

    expect(result).toEqual({ ok: false, error: 'integration_not_found' })
    expect(emitIntegrationEvent).not.toHaveBeenCalled()
  })

  // G-5 (WI-14, grok review, SEC-001/#111 pattern): the settings read is
  // scoped by BOTH ids in the query itself.
  it('G-5: reads settings through the restaurant-scoped repository lookup', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(settings())
    vi.mocked(findDeliveriesByEventId).mockResolvedValue([deliveryFor('int-1')])

    await sendTestEvent('int-1', 'r-1')

    expect(findIntegrationSettingsByIdForRestaurant).toHaveBeenCalledWith('int-1', 'r-1')
  })

  it('no saved URL -> url_not_saved, never emits (T-M6: never an ad-hoc/unsaved URL)', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(settings({ outboundUrl: null, outboundEnabled: false }))

    const result = await sendTestEvent('int-1', 'r-1')

    expect(result).toEqual({ ok: false, error: 'url_not_saved' })
    expect(emitIntegrationEvent).not.toHaveBeenCalled()
  })

  it('emits a ping event with no member_id and no PII, through emitIntegrationEvent (the identical path)', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(settings())
    vi.mocked(findDeliveriesByEventId).mockResolvedValue([deliveryFor('int-1')])

    await sendTestEvent('int-1', 'r-1')

    expect(emitIntegrationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ping', memberId: null, restaurantId: 'r-1' })
    )
    const publishedEvent = vi.mocked(emitIntegrationEvent).mock.calls[0][0]
    expect(JSON.stringify(publishedEvent)).not.toMatch(/phone|\+852/i)
  })

  it('returns the delivery id matching THIS integration when the fan-out created more than one (multi-integration restaurant)', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(settings())
    vi.mocked(findDeliveriesByEventId).mockResolvedValue([deliveryFor('int-other'), deliveryFor('int-1')])

    const result = await sendTestEvent('int-1', 'r-1')

    expect(result).toEqual({ ok: true, deliveryId: 'del-int-1' })
  })

  it('no matching delivery was fanned out (e.g. PII ack missing) -> not_eligible_for_delivery', async () => {
    vi.mocked(findIntegrationSettingsByIdForRestaurant).mockResolvedValue(settings())
    vi.mocked(findDeliveriesByEventId).mockResolvedValue([])

    const result = await sendTestEvent('int-1', 'r-1')

    expect(result).toEqual({ ok: false, error: 'not_eligible_for_delivery' })
  })
})
