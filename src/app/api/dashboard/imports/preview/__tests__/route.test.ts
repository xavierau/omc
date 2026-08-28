import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/preview-contacts-batch', async () => {
  const actual = await vi.importActual<
    typeof import('@/application/preview-contacts-batch')
  >('@/application/preview-contacts-batch')
  return {
    ...actual,
    previewContactsBatch: vi.fn(),
  }
})

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { previewContactsBatch } from '@/application/preview-contacts-batch'
import { ImportBatchValidationError } from '@/domain/services/__errors__/import-errors'
import { POST } from '../route'

const RESTAURANT_ID = 'rest-1'

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/imports/preview', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function validBody() {
  return {
    metadata: {
      source: 'paper-list-2026-Q1',
      dateRangeStart: '2025-11-01',
      dateRangeEnd: '2026-01-31',
      consentTextShown: 'I agree to receive WhatsApp marketing.',
      consentChannel: 'whatsapp',
      proofUrl: 'rest-1/proof.jpg',
    },
    rows: [{ phoneE164: '+85291234567', name: 'A' }],
    mergeExistingMembers: false,
  }
}

describe('POST /api/dashboard/imports/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getTenantContext).mockResolvedValue({
      userId: 'u-1',
      restaurantId: RESTAURANT_ID,
      role: 'admin',
      tenantStatus: 'active',
    })
    vi.mocked(previewContactsBatch).mockResolvedValue({
      batchGrade: 'strong',
      rows: [{ phoneE164: '+85291234567', name: 'A', grade: 'strong', tags: [] }],
      gradeBreakdown: { strong: 1, medium: 0, weak: 0, none: 0 },
      rejected: [],
      lookups: { alreadyMemberPhones: [], activeConsentPhones: [], status: 'ok' },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(
      new AuthError('Unauthorized', 401)
    )
    const r = await POST(jsonRequest(validBody()))
    expect(r.status).toBe(401)
  })

  it('returns 403 when forbidden tenant', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(
      new AuthError('Forbidden', 403)
    )
    const r = await POST(jsonRequest(validBody()))
    expect(r.status).toBe(403)
  })

  it('returns 200 with preview result on happy path', async () => {
    const r = await POST(jsonRequest(validBody()))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.batchGrade).toBe('strong')
    expect(body.rows).toHaveLength(1)
    expect(body.gradeBreakdown).toEqual({
      strong: 1,
      medium: 0,
      weak: 0,
      none: 0,
    })
    expect(body.rejected).toEqual([])
  })

  it('passes parsed Date objects + restaurantId to use case', async () => {
    await POST(jsonRequest(validBody()))
    const args = vi.mocked(previewContactsBatch).mock.calls[0][0]
    expect(args.restaurantId).toBe(RESTAURANT_ID)
    expect(args.metadata.dateRangeStart).toBeInstanceOf(Date)
    expect(args.metadata.dateRangeEnd).toBeInstanceOf(Date)
  })

  it('returns 400 with reason when ImportBatchValidationError thrown', async () => {
    vi.mocked(previewContactsBatch).mockRejectedValueOnce(
      new ImportBatchValidationError('whatsapp_proof_required')
    )
    const r = await POST(jsonRequest(validBody()))
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.reason).toBe('whatsapp_proof_required')
  })

  it('returns 400 when body has malformed dates', async () => {
    const body = validBody()
    body.metadata.dateRangeEnd = 'not-a-date'
    const r = await POST(jsonRequest(body))
    expect(r.status).toBe(400)
  })

  it('returns 500 on unexpected errors', async () => {
    vi.mocked(previewContactsBatch).mockRejectedValueOnce(
      new Error('boom')
    )
    const r = await POST(jsonRequest(validBody()))
    expect(r.status).toBe(500)
  })

  it('returns 400 with reason=empty_rows when rows is empty (B2)', async () => {
    vi.mocked(previewContactsBatch).mockRejectedValueOnce(
      new ImportBatchValidationError('empty_rows')
    )
    const body = validBody()
    body.rows = []
    const r = await POST(jsonRequest(body))
    expect(r.status).toBe(400)
    const json = await r.json()
    expect(json.reason).toBe('empty_rows')
  })

  it('returns 400 with reason=invalid_consent_channel for bogus channel (B4)', async () => {
    const body = validBody()
    body.metadata.consentChannel = 'bogus'
    const r = await POST(jsonRequest(body))
    expect(r.status).toBe(400)
    const json = await r.json()
    expect(json.reason).toBe('invalid_consent_channel')
    expect(previewContactsBatch).not.toHaveBeenCalled()
  })
})
