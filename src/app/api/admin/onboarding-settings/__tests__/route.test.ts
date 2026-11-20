import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/infrastructure/supabase/repositories/restaurant-onboarding-repository')
vi.mock('@/application/update-onboarding-settings', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/update-onboarding-settings')
  >('@/application/update-onboarding-settings')
  return {
    ...actual,
    updateOnboardingSettingsForTenant: vi.fn(),
  }
})

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { getOnboardingSettings } from '@/infrastructure/supabase/repositories/restaurant-onboarding-repository'
import {
  updateOnboardingSettingsForTenant,
  OnboardingSettingsError,
} from '@/application/update-onboarding-settings'
import { GET, PATCH } from '../route'

const RESTAURANT_ID = 'rest-1'

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/onboarding-settings', {
    method: 'PATCH',
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function defaultSettings() {
  return {
    welcomeCampaignId: null,
    returningMemberTemplate: null,
    returningMemberTemplateEn: null,
    returningMemberTemplateZhHk: null,
    defaultLanguage: 'zh_hk' as const,
  }
}

describe('GET /api/admin/onboarding-settings', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(new AuthError('Unauthorized', 401))

    const response = await GET()

    expect(response.status).toBe(401)
  })

  it('returns the full bilingual settings payload as JSON', async () => {
    vi.mocked(getTenantContext).mockResolvedValueOnce({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: 'Hi',
      returningMemberTemplateEn: 'Hi',
      returningMemberTemplateZhHk: '你好',
      defaultLanguage: 'en',
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: 'Hi',
      returningMemberTemplateEn: 'Hi',
      returningMemberTemplateZhHk: '你好',
      defaultLanguage: 'en',
    })
  })

  it('returns null fields when the tenant has no mapping yet', async () => {
    vi.mocked(getTenantContext).mockResolvedValueOnce({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(getOnboardingSettings).mockResolvedValueOnce(defaultSettings())

    const response = await GET()
    const body = await response.json()

    expect(body).toEqual(defaultSettings())
  })
})

describe('PATCH /api/admin/onboarding-settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(updateOnboardingSettingsForTenant).mockResolvedValue(defaultSettings())
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(new AuthError('Unauthorized', 401))

    const response = await PATCH(patchRequest({ welcomeCampaignId: 'camp-1' }))

    expect(response.status).toBe(401)
  })

  it('returns 400 when the body is empty', async () => {
    const response = await PATCH(patchRequest({}))
    expect(response.status).toBe(400)
  })

  it('returns 400 for malformed welcomeCampaignId (empty string)', async () => {
    const response = await PATCH(patchRequest({ welcomeCampaignId: '' }))
    expect(response.status).toBe(400)
  })

  it('returns 400 when returningMemberTemplateEn exceeds MAX_TEMPLATE_LENGTH (1024)', async () => {
    const oversize = 'a'.repeat(1025)
    const response = await PATCH(
      patchRequest({ returningMemberTemplateEn: oversize })
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('1024')
  })

  it('returns 400 when returningMemberTemplateZhHk exceeds MAX_TEMPLATE_LENGTH (1024)', async () => {
    const oversize = 'a'.repeat(1025)
    const response = await PATCH(
      patchRequest({ returningMemberTemplateZhHk: oversize })
    )
    expect(response.status).toBe(400)
  })

  it('rejects the legacy returningMemberTemplate field with 400', async () => {
    const response = await PATCH(
      patchRequest({ returningMemberTemplate: 'hi' })
    )
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('returningMemberTemplate')
  })

  it('returns 400 for invalid defaultLanguage', async () => {
    const response = await PATCH(patchRequest({ defaultLanguage: 'fr' }))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toContain('defaultLanguage')
  })

  it('accepts valid defaultLanguage "en"', async () => {
    const response = await PATCH(patchRequest({ defaultLanguage: 'en' }))
    expect(response.status).toBe(200)
    expect(updateOnboardingSettingsForTenant).toHaveBeenCalledWith(RESTAURANT_ID, {
      defaultLanguage: 'en',
    })
  })

  it('accepts valid defaultLanguage "zh_hk"', async () => {
    const response = await PATCH(patchRequest({ defaultLanguage: 'zh_hk' }))
    expect(response.status).toBe(200)
    expect(updateOnboardingSettingsForTenant).toHaveBeenCalledWith(RESTAURANT_ID, {
      defaultLanguage: 'zh_hk',
    })
  })

  it('returns 403 when the application rejects cross-tenant mapping', async () => {
    vi.mocked(updateOnboardingSettingsForTenant).mockRejectedValueOnce(
      new OnboardingSettingsError('cross-tenant', 403)
    )

    const response = await PATCH(patchRequest({ welcomeCampaignId: 'camp-x' }))

    expect(response.status).toBe(403)
  })

  it('forwards welcomeCampaignId=null (clear mapping) to the service', async () => {
    vi.mocked(updateOnboardingSettingsForTenant).mockResolvedValueOnce(defaultSettings())

    const response = await PATCH(patchRequest({ welcomeCampaignId: null }))

    expect(response.status).toBe(200)
    expect(updateOnboardingSettingsForTenant).toHaveBeenCalledWith(RESTAURANT_ID, {
      welcomeCampaignId: null,
    })
  })

  it('forwards bilingual changes and returns latest settings', async () => {
    vi.mocked(updateOnboardingSettingsForTenant).mockResolvedValueOnce({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: 'Hi {{name}}',
      returningMemberTemplateEn: 'Hi {{name}}',
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })

    const response = await PATCH(
      patchRequest({
        returningMemberTemplateEn: 'Hi {{name}}',
        defaultLanguage: 'en',
      })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      welcomeCampaignId: 'camp-1',
      returningMemberTemplate: 'Hi {{name}}',
      returningMemberTemplateEn: 'Hi {{name}}',
      returningMemberTemplateZhHk: null,
      defaultLanguage: 'en',
    })
    expect(updateOnboardingSettingsForTenant).toHaveBeenCalledWith(RESTAURANT_ID, {
      returningMemberTemplateEn: 'Hi {{name}}',
      defaultLanguage: 'en',
    })
  })
})
