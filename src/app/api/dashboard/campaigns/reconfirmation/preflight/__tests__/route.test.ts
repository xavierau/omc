import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/check-reconfirmation-eligibility', () => ({
  checkReconfirmationEligibility: vi.fn(),
}))
vi.mock('@/application/resolve-reconfirmation-audience', () => ({
  resolveReconfirmationAudience: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/reconfirmation-audience-sample', () => ({
  findReconfirmationAudienceSample: vi.fn(),
}))
vi.mock('@/infrastructure/supabase/repositories/whatsapp-template-repository', () => ({
  list: vi.fn(),
}))

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { checkReconfirmationEligibility } from '@/application/check-reconfirmation-eligibility'
import { findReconfirmationAudienceSample } from '@/infrastructure/supabase/repositories/reconfirmation-audience-sample'
import { list as listTemplates } from '@/infrastructure/supabase/repositories/whatsapp-template-repository'
import { GET } from '../route'
import type { WhatsAppTemplate } from '@/domain/entities/whatsapp-template'

const RESTAURANT_ID = 'rest-1'

function utilityTemplate(overrides: Partial<WhatsAppTemplate> = {}): WhatsAppTemplate {
  return {
    id: 'tpl-utility-1',
    restaurantId: RESTAURANT_ID,
    metaTemplateId: 'meta-1',
    name: 'reconfirmation_consent_v1',
    language: 'en',
    category: 'UTILITY',
    status: 'approved',
    components: [
      { type: 'BODY', text: 'Hi, please confirm by replying YES.' },
    ],
    parameterFormat: 'NAMED',
    rejectionReason: null,
    createdAt: '2026-04-01T00:00:00Z',
    updatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: 'u-1',
    restaurantId: RESTAURANT_ID,
    role: 'admin',
    tenantStatus: 'active',
  })
  vi.mocked(checkReconfirmationEligibility).mockResolvedValue({
    allowed: true,
    violations: [],
    audienceCount: 42,
    currentDailySent: 5,
    cap: 50,
  })
  vi.mocked(findReconfirmationAudienceSample).mockResolvedValue([
    { phoneE164: '+85291111111', capturedAt: '2026-04-30T00:00:00.000Z' },
  ])
  vi.mocked(listTemplates).mockResolvedValue({
    templates: [utilityTemplate()],
    total: 1,
  })
})

describe('GET /api/dashboard/campaigns/reconfirmation/preflight', () => {
  it('returns 401 when not signed in', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(new AuthError('Unauthorized', 401))
    const r = await GET()
    expect(r.status).toBe(401)
  })

  it('returns 403 when no tenant access', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(
      new AuthError('Forbidden: no access to tenant', 403)
    )
    const r = await GET()
    expect(r.status).toBe(403)
  })

  it('returns 200 with the full preflight contract on happy path', async () => {
    const r = await GET()
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toMatchObject({
      allowed: true,
      violations: [],
      audienceCount: 42,
      currentDailySent: 5,
      cap: 50,
    })
    expect(body.templatePreview).toEqual({
      id: 'tpl-utility-1',
      name: 'reconfirmation_consent_v1',
      bodyEn: 'Hi, please confirm by replying YES.',
    })
    expect(body.audienceSample).toEqual([
      { phoneE164: '+85291111111', capturedAt: '2026-04-30T00:00:00.000Z' },
    ])
  })

  it('templatePreview includes id field for Stream D POST flow', async () => {
    const r = await GET()
    const body = await r.json()
    expect(body.templatePreview.id).toBe('tpl-utility-1')
  })

  it('templatePreview is undefined when no approved utility template exists', async () => {
    vi.mocked(listTemplates).mockResolvedValue({ templates: [], total: 0 })
    const r = await GET()
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.templatePreview).toBeUndefined()
  })

  it('audienceSample is undefined when audience is empty', async () => {
    vi.mocked(findReconfirmationAudienceSample).mockResolvedValue([])
    const r = await GET()
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.audienceSample).toBeUndefined()
  })

  it('returns 200 even when not allowed (UI uses violations to render)', async () => {
    vi.mocked(checkReconfirmationEligibility).mockResolvedValue({
      allowed: false,
      violations: [
        { key: 'quality_not_green', detail: 'YELLOW since 2026-04-30' },
      ],
      audienceCount: 0,
      currentDailySent: 0,
      cap: 50,
    })
    vi.mocked(findReconfirmationAudienceSample).mockResolvedValue([])
    const r = await GET()
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.allowed).toBe(false)
    expect(body.violations[0].detail).toBe('YELLOW since 2026-04-30')
  })

  it('queries the template repo for approved UTILITY templates', async () => {
    await GET()
    expect(listTemplates).toHaveBeenCalledWith(
      expect.objectContaining({
        restaurantId: RESTAURANT_ID,
        status: 'approved',
        category: 'UTILITY',
      })
    )
  })

  it('queries the audience sample with limit=5 (no name leakage)', async () => {
    await GET()
    expect(findReconfirmationAudienceSample).toHaveBeenCalledWith({
      restaurantId: RESTAURANT_ID,
      limit: 5,
    })
  })
})
