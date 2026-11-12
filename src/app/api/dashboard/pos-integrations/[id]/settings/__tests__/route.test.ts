import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/configure-pos-integration')
vi.mock('@/application/update-integration-settings')

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { getIntegration } from '@/application/configure-pos-integration'
import { getIntegrationSettingsView, updateIntegrationSettings } from '@/application/update-integration-settings'
import type { PosIntegration } from '@/domain/entities/pos-integration'
import { GET, PATCH } from '../route'

const SETTINGS_VIEW_ALLOWED_KEYS = [
  'newJoinTemplateId',
  'resolvedTemplate',
  'consentAttestationText',
  'consentAttestationAckAt',
  'outboundUrl',
  'outboundEvents',
  'outboundEnabled',
  'outboundPiiAckAt',
  'outboundStatus',
  'outboundFailureStreak',
  'outboundPausedAt',
  'outboundSecretLast4',
  'outboundSecretUpdatedAt',
].sort()

const INTEGRATION: PosIntegration = {
  id: 'int-1',
  restaurantId: 'rest-1',
  provider: 'ichef',
  name: 'My POS',
  status: 'active',
  webhookSecret: 'a'.repeat(60) + 'beef',
  fieldMapping: null,
  credentials: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
}

const SETTINGS_VIEW = {
  newJoinTemplateId: null,
  resolvedTemplate: null,
  consentAttestationText: null,
  consentAttestationAckAt: null,
  outboundUrl: null,
  outboundEvents: ['member.created'],
  outboundEnabled: false,
  outboundPiiAckAt: null,
  outboundStatus: 'active' as const,
  outboundFailureStreak: 0,
  outboundPausedAt: null,
  outboundSecretLast4: null,
  outboundSecretUpdatedAt: null,
}

function ctxParams() {
  return { params: Promise.resolve({ id: 'int-1' }) }
}

function patchReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/pos-integrations/int-1/settings', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })
}

function mockRole(role: 'admin' | 'staff') {
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'user-1',
    restaurantId: 'rest-1',
    role,
    tenantStatus: 'active',
  } as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mockRole('admin')
  vi.mocked(getIntegration).mockResolvedValue(INTEGRATION)
})

describe('GET /api/dashboard/pos-integrations/[id]/settings', () => {
  it('rejects staff with 403', async () => {
    mockRole('staff')
    const res = await GET(new NextRequest('http://localhost/x'), ctxParams())
    expect(res.status).toBe(403)
    expect(getIntegrationSettingsView).not.toHaveBeenCalled()
  })

  it('returns exactly the allowlisted projection for admin', async () => {
    vi.mocked(getIntegrationSettingsView).mockResolvedValue({ ok: true, settings: SETTINGS_VIEW })

    const res = await GET(new NextRequest('http://localhost/x'), ctxParams())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(Object.keys(json.data).sort()).toEqual(SETTINGS_VIEW_ALLOWED_KEYS)
  })

  it('404s for a foreign-tenant id via the scoped integration lookup, before ever reading settings', async () => {
    vi.mocked(getIntegration).mockResolvedValue(null)

    const res = await GET(new NextRequest('http://localhost/x'), ctxParams())

    expect(res.status).toBe(404)
    expect(getIntegrationSettingsView).not.toHaveBeenCalled()
  })
})

describe('PATCH /api/dashboard/pos-integrations/[id]/settings', () => {
  it('rejects staff with 403 and never calls updateIntegrationSettings', async () => {
    mockRole('staff')
    const res = await PATCH(patchReq({ outboundUrl: 'https://x.example.com' }), ctxParams())
    expect(res.status).toBe(403)
    expect(updateIntegrationSettings).not.toHaveBeenCalled()
  })

  it('rejects an unknown field with 400 unknown_field', async () => {
    const res = await PATCH(patchReq({ webhookSecret: 'attacker-value' }), ctxParams())
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error).toBe('unknown_field')
    expect(updateIntegrationSettings).not.toHaveBeenCalled()
  })

  it('404s for a foreign-tenant id before any write', async () => {
    vi.mocked(getIntegration).mockResolvedValue(null)
    const res = await PATCH(patchReq({ outboundEnabled: true }), ctxParams())
    expect(res.status).toBe(404)
    expect(updateIntegrationSettings).not.toHaveBeenCalled()
  })

  it.each([
    'template_not_found',
    'template_not_approved',
    'template_not_owned',
    'no_default_welcome_template',
    'url_not_https',
    'url_private_address',
    'url_invalid',
    'url_port',
    'url_userinfo',
    'pii_ack_required',
  ] as const)('surfaces %s as 422', async (code) => {
    vi.mocked(updateIntegrationSettings).mockResolvedValue({ ok: false, error: code })

    const res = await PATCH(patchReq({ outboundUrl: 'https://x.example.com' }), ctxParams())
    const json = await res.json()

    expect(res.status).toBe(422)
    expect(json.error).toBe(code)
  })

  it('returns the updated projection + warnings on success', async () => {
    vi.mocked(updateIntegrationSettings).mockResolvedValue({
      ok: true,
      settings: { ...SETTINGS_VIEW, outboundUrl: 'https://partner.example.com/hook' },
      warnings: ['tenant_quality_paused'],
    })

    const res = await PATCH(patchReq({ outboundUrl: 'https://partner.example.com/hook' }), ctxParams())
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.outboundUrl).toBe('https://partner.example.com/hook')
    expect(json.warnings).toEqual(['tenant_quality_paused'])
  })

  it('passes the actor user id through for the audit trail', async () => {
    vi.mocked(updateIntegrationSettings).mockResolvedValue({ ok: true, settings: SETTINGS_VIEW, warnings: [] })

    await PATCH(patchReq({ outboundEvents: ['member.created', 'member.updated'] }), ctxParams())

    expect(updateIntegrationSettings).toHaveBeenCalledWith(
      'int-1',
      'rest-1',
      { outboundEvents: ['member.created', 'member.updated'] },
      'user-1'
    )
  })
})
