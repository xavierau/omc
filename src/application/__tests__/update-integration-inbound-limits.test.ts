import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-settings-repository', () => ({
  findIntegrationSettingsById: vi.fn(),
  updateIntegrationInboundLimits: vi.fn(),
}))

import {
  findIntegrationSettingsById,
  updateIntegrationInboundLimits as updateRow,
} from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { IntegrationSettings } from '@/domain/entities/integration-settings'
import { updateIntegrationInboundLimits } from '../update-integration-inbound-limits'

function fakeSettings(overrides: Record<string, unknown> = {}) {
  return IntegrationSettings.fromProps({
    integrationId: 'int-1',
    restaurantId: 'r-1',
    newJoinTemplateId: null,
    consentAttestationText: null,
    consentAttestationAckAt: null,
    consentAttestationAckBy: null,
    outboundUrl: null,
    outboundSecretLast4: null,
    outboundSecretUpdatedAt: null,
    outboundSecretUpdatedBy: null,
    outboundEvents: ['member.created'],
    outboundEnabled: false,
    outboundPiiAckAt: null,
    outboundPiiAckBy: null,
    outboundStatus: 'active',
    outboundFailureStreak: 0,
    outboundPausedAt: null,
    inboundRatePerMin: 60,
    inboundBurst: 20,
    inboundQueueCap: 500,
    inboundSecretUpdatedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('updateIntegrationInboundLimits (application)', () => {
  it('returns null without writing when the integration has no settings row', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValueOnce(null)
    const result = await updateIntegrationInboundLimits('missing-int', { inboundRatePerMin: 100 })
    expect(result).toBeNull()
    expect(updateRow).not.toHaveBeenCalled()
  })

  it('writes the update then returns the refreshed entity', async () => {
    vi.mocked(findIntegrationSettingsById)
      .mockResolvedValueOnce(fakeSettings())
      .mockResolvedValueOnce(fakeSettings({ inboundRatePerMin: 120 }))
    vi.mocked(updateRow).mockResolvedValueOnce(undefined)

    const result = await updateIntegrationInboundLimits('int-1', { inboundRatePerMin: 120 })

    expect(updateRow).toHaveBeenCalledWith('int-1', { inboundRatePerMin: 120 })
    expect(result?.snapshot.inboundRatePerMin).toBe(120)
  })
})
