import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/infrastructure/supabase/guards/tenant-guard')
vi.mock('@/application/import-contacts-batch', () => ({
  importContactsBatch: vi.fn(),
}))
vi.mock(
  '@/infrastructure/supabase/repositories/import-batch-repository',
  () => ({
    findByRestaurant: vi.fn(),
    insertImportBatch: vi.fn(),
    importBatchRepository: {
      insertBatch: vi.fn(),
      findByRestaurant: vi.fn(),
    },
  })
)

import { getTenantContext } from '@/infrastructure/supabase/guards/tenant-guard'
import { AuthError } from '@/infrastructure/supabase/guards/auth-guard'
import { importContactsBatch } from '@/application/import-contacts-batch'
import { findByRestaurant } from '@/infrastructure/supabase/repositories/import-batch-repository'
import { ImportBatchValidationError } from '@/domain/services/__errors__/import-errors'
import { ImportBatch } from '@/domain/entities/import-batch'
import { POST, GET } from '../route'

const RESTAURANT_ID = 'rest-1'
const USER_ID = 'auth-user-1'

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/imports', {
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

function mockTenant(): void {
  vi.mocked(getTenantContext).mockResolvedValue({
    userId: USER_ID,
    restaurantId: RESTAURANT_ID,
    role: 'admin',
    tenantStatus: 'active',
  })
}

describe('POST /api/dashboard/imports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTenant()
    vi.mocked(importContactsBatch).mockResolvedValue({
      importBatchId: 'batch-1',
      inserted: 1,
      membersCreated: 1,
      rejected: [],
      gradeBreakdown: { strong: 1, medium: 0, weak: 0, none: 0 },
      tagging: { status: 'ok', taggedMembers: 0 },
    })
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(
      new AuthError('Unauthorized', 401)
    )
    const r = await POST(jsonRequest(validBody()))
    expect(r.status).toBe(401)
  })

  it('returns 200 with full ImportContactsBatchResult on happy path', async () => {
    const r = await POST(jsonRequest(validBody()))
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.importBatchId).toBe('batch-1')
    expect(body.inserted).toBe(1)
    expect(body.gradeBreakdown).toEqual({
      strong: 1,
      medium: 0,
      weak: 0,
      none: 0,
    })
  })

  it('passes restaurantId, createdBy, and parsed dates to use case', async () => {
    await POST(jsonRequest(validBody()))
    const args = vi.mocked(importContactsBatch).mock.calls[0][0]
    expect(args.restaurantId).toBe(RESTAURANT_ID)
    expect(args.createdBy).toBe(USER_ID)
    expect(args.metadata.dateRangeStart).toBeInstanceOf(Date)
    expect(args.metadata.dateRangeEnd).toBeInstanceOf(Date)
    expect(args.mergeExistingMembers).toBe(false)
  })

  it('returns 400 with reason when ImportBatchValidationError thrown', async () => {
    vi.mocked(importContactsBatch).mockRejectedValueOnce(
      new ImportBatchValidationError('short_consent_text')
    )
    const r = await POST(jsonRequest(validBody()))
    expect(r.status).toBe(400)
    const body = await r.json()
    expect(body.reason).toBe('short_consent_text')
  })

  it('returns 500 on unexpected errors', async () => {
    vi.mocked(importContactsBatch).mockRejectedValueOnce(new Error('boom'))
    const r = await POST(jsonRequest(validBody()))
    expect(r.status).toBe(500)
  })

  it('returns 400 with reason=empty_rows when rows is empty (B2)', async () => {
    vi.mocked(importContactsBatch).mockRejectedValueOnce(
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
    expect(importContactsBatch).not.toHaveBeenCalled()
  })
})

describe('GET /api/dashboard/imports', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockTenant()
    const batch = ImportBatch.create({
      id: 'b-1',
      restaurantId: RESTAURANT_ID,
      source: 'paper-list',
      dateRangeStart: new Date('2025-11-01T00:00:00.000Z'),
      dateRangeEnd: new Date('2026-01-31T00:00:00.000Z'),
      consentTextShown: 'I agree to receive WhatsApp marketing.',
      consentChannel: 'whatsapp',
      proofUrl: 'rest-1/proof.jpg',
      rowCount: 5,
      strongCount: 3,
      mediumCount: 2,
      weakCount: 0,
      noneCount: 0,
      createdBy: USER_ID,
      now: new Date('2026-04-30T12:00:00.000Z'),
    })
    vi.mocked(findByRestaurant).mockResolvedValue([batch])
  })

  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getTenantContext).mockRejectedValueOnce(
      new AuthError('Unauthorized', 401)
    )
    const r = await GET()
    expect(r.status).toBe(401)
  })

  it('returns 200 with batches list shaped as summary', async () => {
    const r = await GET()
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body.batches).toHaveLength(1)
    expect(body.batches[0]).toEqual({
      id: 'b-1',
      source: 'paper-list',
      createdAt: expect.any(String),
      rowCount: 5,
      gradeBreakdown: { strong: 3, medium: 2, weak: 0, none: 0 },
    })
  })

  it('calls findByRestaurant with current restaurantId and limit=50', async () => {
    await GET()
    expect(findByRestaurant).toHaveBeenCalledWith(RESTAURANT_ID, 50)
  })

  it('returns 500 on unexpected errors', async () => {
    vi.mocked(findByRestaurant).mockRejectedValueOnce(new Error('boom'))
    const r = await GET()
    expect(r.status).toBe(500)
  })
})
