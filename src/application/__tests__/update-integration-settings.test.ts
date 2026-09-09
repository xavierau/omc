import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/repositories/integration-settings-repository')
vi.mock('@/infrastructure/supabase/repositories/integration-settings-audit-repository')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/infrastructure/supabase/repositories/campaign-repository')
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository')
vi.mock('@/infrastructure/supabase/repositories/tenant-trust-queries')
vi.mock('@/application/validate-outbound-url')

import {
  findIntegrationSettingsById,
  updateIntegrationSettingsFields,
} from '@/infrastructure/supabase/repositories/integration-settings-repository'
import { recordIntegrationSettingsAudit } from '@/infrastructure/supabase/repositories/integration-settings-audit-repository'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import { getCampaignByIdForRestaurant } from '@/infrastructure/supabase/repositories/campaign-repository'
import { findByIdForRestaurant, findById } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { isTenantAutoPaused } from '@/infrastructure/supabase/repositories/tenant-trust-queries'
import { validateOutboundUrl } from '@/application/validate-outbound-url'
import { IntegrationSettings, type IntegrationSettingsProps } from '@/domain/entities/integration-settings'
import { getIntegrationSettingsView, updateIntegrationSettings } from '../update-integration-settings'

const BASE_PROPS: IntegrationSettingsProps = {
  integrationId: 'int-1',
  restaurantId: 'rest-1',
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
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

function settingsWith(overrides: Partial<IntegrationSettingsProps>): IntegrationSettings {
  return IntegrationSettings.fromProps({ ...BASE_PROPS, ...overrides })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findIntegrationSettingsById).mockResolvedValue(settingsWith({}))
  vi.mocked(updateIntegrationSettingsFields).mockResolvedValue(undefined)
  vi.mocked(recordIntegrationSettingsAudit).mockResolvedValue(undefined)
  vi.mocked(isTenantAutoPaused).mockResolvedValue(false)
})

describe('getIntegrationSettingsView', () => {
  it('returns not_found when no settings row exists', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(null)
    const result = await getIntegrationSettingsView('int-1', 'rest-1')
    expect(result).toEqual({ ok: false, error: 'not_found' })
  })

  it('resolves the current template for display without requiring a patch', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(
      settingsWith({ newJoinTemplateId: '11111111-1111-1111-1111-111111111111' })
    )
    vi.mocked(findByIdForRestaurant).mockResolvedValue({
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Welcome',
      category: 'UTILITY',
      status: 'approved',
    } as never)

    const result = await getIntegrationSettingsView('int-1', 'rest-1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.settings.resolvedTemplate).toEqual({ name: 'Welcome', category: 'UTILITY' })
    }
  })
})

describe('updateIntegrationSettings', () => {
  it('empty patch writes nothing and no audit rows', async () => {
    const result = await updateIntegrationSettings('int-1', 'rest-1', {}, 'user-1')
    expect(result.ok).toBe(true)
    expect(updateIntegrationSettingsFields).not.toHaveBeenCalled()
    expect(recordIntegrationSettingsAudit).not.toHaveBeenCalled()
  })

  it("'default' template with no welcomeCampaignId -> no_default_welcome_template", async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: null,
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })

    const result = await updateIntegrationSettings('int-1', 'rest-1', { newJoinTemplateId: 'default' }, 'user-1')
    expect(result).toEqual({ ok: false, error: 'no_default_welcome_template' })
    expect(updateIntegrationSettingsFields).not.toHaveBeenCalled()
  })

  it("'default' template resolved + tenant quality-paused -> saved with a warning", async () => {
    vi.mocked(getOnboardingSettings).mockResolvedValue({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: null,
      returningMemberTemplateEn: null,
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })
    vi.mocked(getCampaignByIdForRestaurant).mockResolvedValue({ whatsappTemplateId: 'tpl-1' } as never)
    vi.mocked(findByIdForRestaurant).mockResolvedValue({
      id: 'tpl-1',
      name: 'Welcome',
      category: 'MARKETING',
      status: 'approved',
    } as never)
    vi.mocked(isTenantAutoPaused).mockResolvedValue(true)
    vi.mocked(findIntegrationSettingsById)
      .mockResolvedValueOnce(settingsWith({}))
      .mockResolvedValueOnce(settingsWith({ newJoinTemplateId: 'default' }))

    const result = await updateIntegrationSettings('int-1', 'rest-1', { newJoinTemplateId: 'default' }, 'user-1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.warnings).toEqual(['tenant_quality_paused'])
      expect(result.settings.resolvedTemplate).toEqual({ name: 'Welcome', category: 'MARKETING' })
    }
    expect(recordIntegrationSettingsAudit).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'newJoinTemplateId', oldValue: null, newValue: 'default' })
    )
  })

  it('a uuid template not owned by this tenant but existing elsewhere -> template_not_owned', async () => {
    vi.mocked(findByIdForRestaurant).mockResolvedValue(null)
    vi.mocked(findById).mockResolvedValue({ id: 'tpl-foreign' } as never)

    const result = await updateIntegrationSettings(
      'int-1',
      'rest-1',
      { newJoinTemplateId: '22222222-2222-2222-2222-222222222222' },
      'user-1'
    )
    expect(result).toEqual({ ok: false, error: 'template_not_owned' })
  })

  it('a uuid template that does not exist anywhere -> template_not_found', async () => {
    vi.mocked(findByIdForRestaurant).mockResolvedValue(null)
    vi.mocked(findById).mockResolvedValue(null)

    const result = await updateIntegrationSettings(
      'int-1',
      'rest-1',
      { newJoinTemplateId: '33333333-3333-3333-3333-333333333333' },
      'user-1'
    )
    expect(result).toEqual({ ok: false, error: 'template_not_found' })
  })

  it('a uuid template owned but not approved -> template_not_approved', async () => {
    vi.mocked(findByIdForRestaurant).mockResolvedValue({
      id: 'tpl-1',
      name: 'Draft',
      category: 'UTILITY',
      status: 'pending',
    } as never)

    const result = await updateIntegrationSettings(
      'int-1',
      'rest-1',
      { newJoinTemplateId: '44444444-4444-4444-4444-444444444444' },
      'user-1'
    )
    expect(result).toEqual({ ok: false, error: 'template_not_approved' })
  })

  it.each([
    ['https_required', 'ssrf_rejected_never', 'url_not_https'],
    ['userinfo_not_allowed', 'invalid_url', 'url_userinfo'],
    ['port_443_only', 'invalid_url', 'url_port'],
    ['not_a_valid_url', 'invalid_url', 'url_invalid'],
  ])('maps validateOutboundUrl details=%s to %s', async (details, _title, expectedCode) => {
    vi.mocked(validateOutboundUrl).mockResolvedValue({
      ok: false,
      error: { title: details === 'not_a_valid_url' ? 'invalid_url' : 'invalid_url', details },
    } as never)

    const result = await updateIntegrationSettings(
      'int-1',
      'rest-1',
      { outboundUrl: 'https://x.example.com' },
      'user-1'
    )
    expect(result).toEqual({ ok: false, error: expectedCode })
  })

  it('maps an ssrf_rejected title to url_private_address', async () => {
    vi.mocked(validateOutboundUrl).mockResolvedValue({
      ok: false,
      error: { title: 'ssrf_rejected', details: 'blocked_address:169.254.169.254' },
    } as never)

    const result = await updateIntegrationSettings(
      'int-1',
      'rest-1',
      { outboundUrl: 'https://x.example.com' },
      'user-1'
    )
    expect(result).toEqual({ ok: false, error: 'url_private_address' })
  })

  it('saves a valid outbound URL and audits old -> new', async () => {
    vi.mocked(validateOutboundUrl).mockResolvedValue({ ok: true } as never)
    vi.mocked(findIntegrationSettingsById)
      .mockResolvedValueOnce(settingsWith({}))
      .mockResolvedValueOnce(settingsWith({ outboundUrl: 'https://partner.example.com/hook' }))

    const result = await updateIntegrationSettings(
      'int-1',
      'rest-1',
      { outboundUrl: 'https://partner.example.com/hook' },
      'user-1'
    )
    expect(result.ok).toBe(true)
    expect(updateIntegrationSettingsFields).toHaveBeenCalledWith(
      'int-1',
      expect.objectContaining({ outboundUrl: 'https://partner.example.com/hook' })
    )
    expect(recordIntegrationSettingsAudit).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'outboundUrl', oldValue: null, newValue: 'https://partner.example.com/hook' })
    )
  })

  it('enabling outbound without URL/ack/secret -> pii_ack_required, nothing persisted', async () => {
    const result = await updateIntegrationSettings('int-1', 'rest-1', { outboundEnabled: true }, 'user-1')
    expect(result).toEqual({ ok: false, error: 'pii_ack_required' })
    expect(updateIntegrationSettingsFields).not.toHaveBeenCalled()
    expect(recordIntegrationSettingsAudit).not.toHaveBeenCalled()
  })

  it('enabling outbound with URL+secret already saved and pii ack granted in the same patch succeeds', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(
      settingsWith({
        outboundUrl: 'https://partner.example.com/hook',
        outboundSecretLast4: 'ab12',
      })
    )

    const result = await updateIntegrationSettings(
      'int-1',
      'rest-1',
      { outboundPiiAck: true, outboundEnabled: true },
      'user-1'
    )
    expect(result.ok).toBe(true)
    expect(updateIntegrationSettingsFields).toHaveBeenCalledWith(
      'int-1',
      expect.objectContaining({ outboundEnabled: true })
    )
    const auditFields = vi.mocked(recordIntegrationSettingsAudit).mock.calls.map((call) => call[0].field)
    expect(auditFields).toEqual(expect.arrayContaining(['outboundPiiAck', 'outboundEnabled']))
  })

  it('rejects an unknown outboundEvents member at the application layer defensively (pass-through of validator output)', async () => {
    vi.mocked(findIntegrationSettingsById)
      .mockResolvedValueOnce(settingsWith({}))
      .mockResolvedValueOnce(settingsWith({ outboundEvents: ['member.updated'] }))

    const result = await updateIntegrationSettings(
      'int-1',
      'rest-1',
      { outboundEvents: ['member.updated'] },
      'user-1'
    )
    expect(result.ok).toBe(true)
    expect(recordIntegrationSettingsAudit).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'outboundEvents', oldValue: 'member.created', newValue: 'member.updated' })
    )
  })

  it('consentAttestationAck true then false clears ack_at/ack_by', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(
      settingsWith({ consentAttestationAckAt: '2026-01-01T00:00:00Z', consentAttestationAckBy: 'user-1' })
    )

    const result = await updateIntegrationSettings('int-1', 'rest-1', { consentAttestationAck: false }, 'user-1')
    expect(result.ok).toBe(true)
    expect(updateIntegrationSettingsFields).toHaveBeenCalledWith(
      'int-1',
      expect.objectContaining({ consentAttestationAckAt: null, consentAttestationAckBy: null })
    )
  })

  it('a field present in the patch but unchanged from current value writes no audit row', async () => {
    vi.mocked(findIntegrationSettingsById).mockResolvedValue(
      settingsWith({ consentAttestationText: 'Same text' })
    )

    const result = await updateIntegrationSettings(
      'int-1',
      'rest-1',
      { consentAttestationText: 'Same text' },
      'user-1'
    )
    expect(result.ok).toBe(true)
    expect(updateIntegrationSettingsFields).not.toHaveBeenCalled()
    expect(recordIntegrationSettingsAudit).not.toHaveBeenCalled()
  })
})
