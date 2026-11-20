import { describe, expect, it } from 'vitest'
import { IntegrationSettings, type IntegrationSettingsProps } from '../integration-settings'

function baseProps(overrides: Partial<IntegrationSettingsProps> = {}): IntegrationSettingsProps {
  return {
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
    inboundRatePerMin: null,
    inboundBurst: null,
    inboundQueueCap: null,
    inboundSecretUpdatedAt: null,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z',
    ...overrides,
  }
}

describe('IntegrationSettings', () => {
  it('accepts default (all-off) props', () => {
    const settings = IntegrationSettings.fromProps(baseProps())
    expect(settings.snapshot.outboundEnabled).toBe(false)
  })

  it('never carries outbound_secret_enc -- no such field exists on the props type', () => {
    const props = baseProps()
    expect('outboundSecretEnc' in props).toBe(false)
  })

  it.each(['default', '11111111-1111-1111-1111-111111111111', null])(
    'accepts new_join_template_id = %s',
    (value) => {
      expect(() => IntegrationSettings.fromProps(baseProps({ newJoinTemplateId: value }))).not.toThrow()
    }
  )

  it('rejects a non-uuid, non-default new_join_template_id', () => {
    expect(() =>
      IntegrationSettings.fromProps(baseProps({ newJoinTemplateId: 'not-a-uuid' }))
    ).toThrow(/new_join_template_id/)
  })

  it('rejects outbound_enabled without outbound_url', () => {
    expect(() =>
      IntegrationSettings.fromProps(
        baseProps({
          outboundEnabled: true,
          outboundUrl: null,
          outboundPiiAckAt: '2026-09-10T00:00:00.000Z',
          outboundSecretLast4: 'abcd',
        })
      )
    ).toThrow(/outboundUrl/)
  })

  it('rejects outbound_enabled without outbound_pii_ack_at', () => {
    expect(() =>
      IntegrationSettings.fromProps(
        baseProps({
          outboundEnabled: true,
          outboundUrl: 'https://partner.example.com/hook',
          outboundPiiAckAt: null,
          outboundSecretLast4: 'abcd',
        })
      )
    ).toThrow(/outboundPiiAckAt/)
  })

  it('rejects outbound_enabled without a saved secret', () => {
    expect(() =>
      IntegrationSettings.fromProps(
        baseProps({
          outboundEnabled: true,
          outboundUrl: 'https://partner.example.com/hook',
          outboundPiiAckAt: '2026-09-10T00:00:00.000Z',
          outboundSecretLast4: null,
        })
      )
    ).toThrow(/outboundSecret/)
  })

  it('accepts outbound_enabled with all three preconditions satisfied', () => {
    expect(() =>
      IntegrationSettings.fromProps(
        baseProps({
          outboundEnabled: true,
          outboundUrl: 'https://partner.example.com/hook',
          outboundPiiAckAt: '2026-09-10T00:00:00.000Z',
          outboundSecretLast4: 'abcd',
        })
      )
    ).not.toThrow()
  })
})
